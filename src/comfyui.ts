import { createHash } from "node:crypto";
import { buildGraph, usableReferences } from "./graph-builder";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { imageType } from "./save-store";
import type { SettingsStore } from "./settings-store";

const LIMITS = {
  pollMs: 1000,
  // A job can sit behind the player's own queue or a first model load, so this limits silence, not the whole job.
  silenceMs: 10 * 60 * 1000,
};

// Folder scans on a big install can take a while, but Settings mustn't hang on a server that doesn't answer.
const LIST_MS = 30 * 1000;
const CANCEL_MS = 5 * 1000;

type HistoryEntry = {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
  status?: unknown;
};
type Queue = { queue_running?: unknown[]; queue_pending?: unknown[] };
type Inputs = Record<string, unknown>;

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Every call to ComfyUI. The address is what the player typed, so a redirect from it is an error, not a new destination. */
const ask = (url: string, path: string, signal: AbortSignal, init?: RequestInit) =>
  fetch(`${url}${path}`, { ...init, signal, redirect: "error", timeout: false });

const baseUrl = (settings: SettingsStore) => settings.read().comfyUrl.replace(/\/$/, "");

// A queue entry is [number, prompt_id, ...].
const listed = (entries: unknown[] | undefined, job: string) =>
  entries?.some((entry) => Array.isArray(entry) && entry[1] === job) ?? false;

/** A combo input's choices, from either form /object_info uses: [[...options], {}] or ["COMBO", { options }]. */
function options(input: unknown) {
  const [kind, extra] = Array.isArray(input) ? input : [];
  const list: unknown = kind === "COMBO" ? extra?.options : kind;
  return Array.isArray(list) ? list.filter((option): option is string => typeof option === "string") : [];
}

/** What the saved server has installed. It asks one node at a time, as the whole /object_info can take many seconds. */
export async function comfyModels(settings: SettingsStore, signal: AbortSignal) {
  const url = baseUrl(settings);
  const limited = AbortSignal.any([signal, AbortSignal.timeout(LIST_MS)]);
  const required = async (node: string) => {
    const response = await ask(url, `/object_info/${node}`, limited);
    if (!response.ok) return undefined;
    const info = (await response.json()) as Record<string, { input?: { required?: Inputs } }>;
    return info[node]?.input?.required;
  };
  const nodes = ["CheckpointLoaderSimple", "UNETLoader", "CLIPLoader", "VAELoader", "LoraLoader"];
  const [checkpoint, unet, clip, vae, lora] = await Promise.all(nodes.map(required)).catch(() => []);
  return {
    reachable: !![checkpoint, unet, clip, vae, lora].find(Boolean),
    // ComfyUI gained this text encoder type with its FLUX.2 nodes.
    hasFlux2: options(clip?.type).includes("flux2"),
    checkpoints: options(checkpoint?.ckpt_name),
    diffusionModels: options(unet?.unet_name),
    textEncoders: options(clip?.clip_name),
    vaes: options(vae?.vae_name),
    loras: options(lora?.lora_name),
  };
}

/** Named by its content, so jobs can't collide. ComfyUI clears its temp folder on start, so these don't pile up. */
async function upload(url: string, { bytes, mediaType }: ImagePayload["reference_images"][number], signal: AbortSignal) {
  const form = new FormData();
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${mediaType.split("/")[1]}`;
  form.set("image", new File([bytes as Uint8Array<ArrayBuffer>], name, { type: mediaType }));
  form.set("subfolder", "novelforge");
  form.set("type", "temp");
  const response = await ask(url, "/upload/image", signal, { method: "POST", body: form });
  if (!response.ok) throw new Error(`ComfyUI refused a reference image: ${response.status}`);
  const stored = (await response.json()) as { name: string; subfolder: string };
  return `${stored.subfolder}/${stored.name} [temp]`;
}

/** Best effort, as the job's result is ignored either way. */
async function cancel(url: string, job: string) {
  const limited = AbortSignal.timeout(CANCEL_MS);
  const post = (path: string, body: object) =>
    ask(url, path, limited, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  await post("/queue", { delete: [job] });
  const { queue_running } = (await (await ask(url, "/queue", limited)).json()) as Queue;
  // Only if it's ours, as an older ComfyUI ignores prompt_id and would stop the player's own job.
  if (listed(queue_running, job)) await post("/interrupt", { prompt_id: job });
}

/** The ComfyUI Image Adapter in Simple Mode, using the Settings at the time of each call. It never sends a key. */
export function comfyImages(settings: SettingsStore, { pollMs, silenceMs } = LIMITS): ImageAdapter {
  async function finished(url: string, job: string, signal: AbortSignal) {
    let heard = Date.now();
    const answer = async <T>(path: string) => {
      try {
        const response = await ask(url, path, AbortSignal.any([signal, AbortSignal.timeout(silenceMs)]));
        const body = response.ok ? ((await response.json()) as T) : undefined;
        if (body) heard = Date.now();
        return body;
      } catch {
        signal.throwIfAborted();
        return undefined;
      }
    };

    while (true) {
      // The queue first, so a job that ends between the two is still found in the history.
      const queue = await answer<Queue>("/queue");
      const history = await answer<Record<string, HistoryEntry>>(`/history/${job}`);
      const done = history?.[job];
      if (done) return done;
      if (queue && history && !listed(queue.queue_running, job) && !listed(queue.queue_pending, job)) {
        throw new Error("ComfyUI lost the job, so it may have restarted or had its queue cleared");
      }
      if (Date.now() - heard >= silenceMs) throw new Error("ComfyUI stopped responding");
      await Bun.sleep(pollMs);
    }
  }

  return async ({ reference_images, ...payload }, signal) => {
    const choices = settings.read();
    const url = baseUrl(settings);
    let job = crypto.randomUUID() as string;
    const limited = AbortSignal.any([signal, AbortSignal.timeout(silenceMs)]);

    try {
      const references = await Promise.all(
        usableReferences(choices, reference_images).map((reference) => upload(url, reference, limited)),
      );
      const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      const graph = buildGraph(choices, { ...payload, references, seed });
      // Not abortable, as a job dropped mid-request could still be queued after the cancel, with nothing to stop it.
      const submitted = await ask(url, "/prompt", AbortSignal.timeout(silenceMs), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ prompt: graph, prompt_id: job }),
      });
      if (!submitted.ok) throw new Error(`ComfyUI refused the graph: ${submitted.status} ${await submitted.text()}`);
      // Sending an id means a job is known before /prompt answers, but the one the server reports is the real one.
      job = ((await submitted.json()) as { prompt_id?: string }).prompt_id ?? job;
      signal.throwIfAborted();

      const { outputs, status } = await finished(url, job, signal);
      const image = Object.values(outputs ?? {}).flatMap(({ images }) => images ?? [])[0];
      if (!image) throw new Error(`ComfyUI's job failed: ${JSON.stringify(status)}`);

      const { filename, subfolder, type } = image;
      const view = new URLSearchParams({ filename, subfolder, type });
      const response = await ask(url, `/view?${view}`, AbortSignal.any([signal, AbortSignal.timeout(silenceMs)]));
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Checked here too, so something that isn't an image doesn't count towards the session's total.
      if (!response.ok || !imageType(bytes)) throw new Error("ComfyUI returned something that isn't a PNG, JPEG or WebP");
      signal.throwIfAborted();
      return bytes;
    } catch (error) {
      // Not awaited, so a server that has gone quiet doesn't also hold up the Save's next image.
      void cancel(url, job).catch(() => {});
      throw error;
    }
  };
}
