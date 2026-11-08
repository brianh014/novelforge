import type { Graph } from "../src/graph-builder";
import { PNG, png } from "./support";

type Job = { id: string; graph: Graph };
type Upload = { name: string; subfolder: string; type: string; bytes: Uint8Array };

/** The older form of a combo input in /object_info. */
const oldCombo = (options: string[]) => [options, {}];
/** The newer form. */
const newCombo = (options: string[]) => ["COMBO", { options }];

/**
 * A ComfyUI that answers the way its server.py does, including rejecting a graph that names a model it doesn't have.
 * With `hold` on, jobs stay running or queued, one running at a time, until `finish`.
 */
export function fakeComfyUI() {
  const installed = {
    checkpoints: ["dream_xl.safetensors", "dream_15.safetensors"],
    diffusionModels: ["flux2_dev_fp8mixed.safetensors"],
    textEncoders: ["mistral_3_small_flux2_bf16.safetensors"],
    vaes: ["flux2-vae.safetensors"],
    loras: ["ink.safetensors", "sub\\sea.safetensors"],
    clipTypes: ["stable_diffusion", "flux2"],
  };
  const jobs = {
    running: [] as Job[],
    pending: [] as Job[],
    done: new Map<string, unknown>(),
    prompts: [] as Graph[],
    uploads: [] as Upload[],
    interrupted: [] as unknown[],
    deleted: [] as string[],
  };
  const requests: { path: string; authorization: string | null }[] = [];
  const control = {
    hold: false,
    image: new Uint8Array(PNG) as Uint8Array<ArrayBuffer>,
    historyError: false,
    /** Stops answering anything. */
    silent: false,
    /** Forgets every job, as a restart does. */
    forgetJobs: false,
    redirectTo: "",
    /** Assigns its own job ids, ignoring the client's. */
    ownIds: false,
    /** How long /prompt takes to answer, with the job queued only at the end. */
    promptDelayMs: 0,
    /** Node classes this server doesn't have, such as a custom node that isn't installed. */
    uninstalled: [] as string[],
    failureKind: "execution_error",
    /** What a failing job reports. */
    failure: { node_id: "5", node_type: "KSampler", exception_type: "OutOfMemoryError", exception_message: "out of memory" },
  };

  /** Each preview and saved image, with saved ones in ComfyUI's output folder. */
  const outputsOf = (graph: Graph) =>
    Object.fromEntries(
      Object.entries(graph).flatMap(([id, { class_type }]) => {
        if (class_type === "PreviewImage") return [[id, { images: [{ filename: "out.png", subfolder: "", type: "temp" }] }]];
        if (class_type === "SaveImage") return [[id, { images: [{ filename: `saved-${id}.png`, subfolder: "", type: "output" }] }]];
        return [];
      }),
    );

  const finished = (job: Job) => {
    jobs.done.set(job.id, {
      prompt: [0, job.id, job.graph],
      // A failed job keeps what its earlier nodes finished.
      outputs: outputsOf(job.graph),
      status: {
        status_str: control.historyError ? "error" : "success",
        completed: !control.historyError,
        messages: control.historyError ? [[control.failureKind, control.failure]] : [],
      },
    });
  };

  const notInList = (graph: Graph) => {
    const lists: Record<string, [string, string[]]> = {
      CheckpointLoaderSimple: ["ckpt_name", installed.checkpoints],
      UNETLoader: ["unet_name", installed.diffusionModels],
      CLIPLoader: ["clip_name", installed.textEncoders],
      VAELoader: ["vae_name", installed.vaes],
      LoraLoader: ["lora_name", installed.loras],
      LoraLoaderModelOnly: ["lora_name", installed.loras],
    };
    return Object.entries(graph).find(([, { class_type, inputs }]) => {
      const list = lists[class_type];
      return list && !list[1].includes(inputs[list[0]] as string);
    });
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    routes: {
      "/object_info/:node": (req) => {
        const inputs: Record<string, Record<string, unknown>> = {
          CheckpointLoaderSimple: { ckpt_name: oldCombo(installed.checkpoints) },
          UNETLoader: { unet_name: newCombo(installed.diffusionModels), weight_dtype: oldCombo(["default"]) },
          CLIPLoader: { clip_name: oldCombo(installed.textEncoders), type: newCombo(installed.clipTypes) },
          VAELoader: { vae_name: newCombo(installed.vaes) },
          LoraLoader: { model: ["MODEL", {}], lora_name: oldCombo(installed.loras) },
          TextEncodeQwenImage21: { clip: ["CLIP", {}], prompt: ["STRING", { multiline: true }] },
          KSampler: { sampler_name: oldCombo(["euler", "dpmpp_2m"]), scheduler: oldCombo(["simple", "karras"]) },
        };
        const required = control.uninstalled.includes(req.params.node) ? undefined : inputs[req.params.node];
        return Response.json(required ? { [req.params.node]: { input: { required } } } : {});
      },
      "/upload/image": {
        POST: async (req) => {
          const form = await req.formData();
          const file = form.get("image") as unknown as File;
          const [subfolder, type] = [String(form.get("subfolder") ?? ""), String(form.get("type") ?? "input")];
          jobs.uploads.push({ name: file.name, subfolder, type, bytes: new Uint8Array(await file.arrayBuffer()) });
          return Response.json({ name: file.name, subfolder, type });
        },
      },
      "/prompt": {
        POST: async (req) => {
          const { prompt: graph, prompt_id: sent } = (await req.json()) as { prompt: Graph; prompt_id: string };
          const id = control.ownIds ? crypto.randomUUID() : sent;
          jobs.prompts.push(graph);
          await Bun.sleep(control.promptDelayMs);
          const absent = Object.values(graph).find(({ class_type }) => control.uninstalled.includes(class_type));
          if (absent) {
            const { class_type } = absent;
            const error = { type: "missing_node_type", message: `Node '${class_type}' not found`, extra_info: { class_type } };
            return Response.json({ error, node_errors: {} }, { status: 400 });
          }
          const wrong = notInList(graph);
          if (wrong) {
            const error = { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" };
            const [id, { class_type, inputs }] = wrong;
            const node_errors = { [id]: { errors: [{ type: "value_not_in_list", details: JSON.stringify(inputs) }], class_type } };
            return Response.json({ error, node_errors }, { status: 400 });
          }
          const job = { id, graph };
          if (!control.hold) finished(job);
          else (jobs.running.length === 0 ? jobs.running : jobs.pending).push(job);
          return Response.json({ prompt_id: id, number: 1, node_errors: {} });
        },
      },
      "/history/:id": (req) => {
        const entry = jobs.done.get(req.params.id);
        return Response.json(entry ? { [req.params.id]: entry } : {});
      },
      "/queue": {
        GET: () =>
          Response.json({
            queue_running: control.forgetJobs ? [] : jobs.running.map(({ id, graph }) => [1, id, graph, {}, []]),
            queue_pending: control.forgetJobs ? [] : jobs.pending.map(({ id, graph }) => [2, id, graph, {}, []]),
          }),
        POST: async (req) => {
          const { delete: ids = [] } = (await req.json()) as { delete?: string[] };
          jobs.deleted.push(...ids);
          jobs.pending = jobs.pending.filter(({ id }) => !ids.includes(id));
          return new Response(null);
        },
      },
      "/interrupt": {
        POST: async (req) => {
          jobs.interrupted.push(await req.json());
          return new Response(null);
        },
      },
      "/view": (req) => {
        const { filename, type } = Object.fromEntries(new URL(req.url).searchParams);
        const saved = /^saved-(\d+)\.png$/.exec(filename ?? "");
        if (saved && type === "output") return new Response(png(Number(saved[1])));
        return filename === "out.png" && type === "temp" ? new Response(control.image) : new Response(null, { status: 404 });
      },
    },
    fetch: () => new Response(null, { status: 404 }),
  });

  // In front of the routes, so it can record, stall or redirect any request.
  const front = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: async (req) => {
      const { pathname, search } = new URL(req.url);
      requests.push({ path: pathname, authorization: req.headers.get("authorization") });
      if (control.silent) await new Promise(() => {});
      if (control.redirectTo) return Response.redirect(control.redirectTo, 302);
      return fetch(new URL(pathname + search, server.url), { method: req.method, headers: req.headers, body: req.body });
    },
  });

  return {
    url: front.url.origin,
    installed,
    jobs,
    requests,
    control,
    /** Ends the running job, and the next queued one starts. */
    finish() {
      const job = jobs.running.shift();
      if (job) finished(job);
      const next = jobs.pending.shift();
      if (next) jobs.running.push(next);
    },
    stop: () => Promise.all([server.stop(true), front.stop(true)]),
  };
}
