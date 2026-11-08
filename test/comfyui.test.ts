import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { WORKFLOW_EXAMPLE } from "../src/comfy-workflow";
import { comfyImages } from "../src/comfyui";
import type { Graph } from "../src/graph-builder";
import { settingsStore } from "../src/settings-store";
import { fakeComfyUI } from "./fake-comfyui";
import { PNG, png, scriptedTextProvider, startApp, tempFolder } from "./support";

type Images = { images: { messageId: number; caption: string, redraws: 0 }[]; pending: boolean; session: number };

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp> | undefined;
let comfy: ReturnType<typeof fakeComfyUI>;

const play = (...replies: (string | Error)[]) => {
  app = startApp(join(folder.path, "Saves"), scriptedTextProvider(...replies).textProvider);
  return app;
};

const sdSetup = () => ({
  imageProvider: "local",
  comfyUrl: comfy.url,
  comfyFamily: "sd",
  comfyCheckpoint: "dream_xl.safetensors",
});
const flux2Setup = () => ({
  imageProvider: "local",
  comfyUrl: comfy.url,
  comfyFamily: "flux2",
  comfyDiffusionModel: "flux2_dev_fp8mixed.safetensors",
  comfyTextEncoder: "mistral_3_small_flux2_bf16.safetensors",
  comfyVae: "flux2-vae.safetensors",
});

beforeEach(() => {
  folder = tempFolder();
  comfy = fakeComfyUI();
});

afterEach(async () => {
  await app?.stop();
  app = undefined;
  await comfy.stop();
  folder.remove();
});

const turn = (fields: object) => JSON.stringify({ check: null, narration: "The tide rises.", state_operations: [], ...fields });
const newScene = (description = "A flooded street", location = "The street") =>
  turn({ scene_changed: true, visual_description: description, state_operations: [{ op: "set_scene", location, visible_cast: [] }] });

const imagesOf = async (id: string) => (await app!.get(`/saves/${id}/images`).then((r) => r.json())) as Images;
const playTurn = (id: string) => app!.post(`/saves/${id}/turns`, { input: "I wade forward." });

async function settled(id: string) {
  for (let tries = 0; tries < 800; tries++) {
    const state = await imagesOf(id);
    if (!state.pending) return state;
    await Bun.sleep(5);
  }
  throw new Error("The image never settled");
}

async function until(done: () => boolean) {
  for (let tries = 0; tries < 800 && !done(); tries++) await Bun.sleep(5);
  expect(done()).toBe(true);
}

const nodes = (graph: Graph, classType: string) => Object.values(graph).filter((node) => node.class_type === classType);

const listModels = () => app!.get("/settings/comfy-models").then((r) => r.json()) as Promise<Record<string, unknown>>;

test("Settings lists what's installed from both forms of combo input", async () => {
  await play().patch("/settings", { comfyUrl: comfy.url });

  expect(await listModels()).toEqual({
    reachable: true,
    hasFlux2: true,
    checkpoints: ["dream_xl.safetensors", "dream_15.safetensors"],
    diffusionModels: ["flux2_dev_fp8mixed.safetensors"],
    textEncoders: ["mistral_3_small_flux2_bf16.safetensors"],
    vaes: ["flux2-vae.safetensors"],
    loras: ["ink.safetensors", "sub\\sea.safetensors"],
  });
});

test("a model added to ComfyUI shows on the next listing", async () => {
  await play().patch("/settings", { comfyUrl: comfy.url });
  await listModels();
  comfy.installed.loras.push("new.safetensors");

  expect((await listModels()).loras).toContain("new.safetensors");
});

test("an install without FLUX.2 support says so", async () => {
  await play().patch("/settings", { comfyUrl: comfy.url });
  comfy.installed.clipTypes = ["stable_diffusion"];

  expect((await listModels()).hasFlux2).toBe(false);
});

const nothing = { reachable: false, hasFlux2: false, checkpoints: [], diffusionModels: [], textEncoders: [], vaes: [], loras: [] };

test("a server that isn't running lists nothing and says it can't be reached", async () => {
  await play().patch("/settings", { comfyUrl: comfy.url });
  await comfy.stop();

  expect(await listModels()).toEqual(nothing);
});

test("a redirect is not followed", async () => {
  const elsewhere = fakeComfyUI();
  await play().patch("/settings", { comfyUrl: comfy.url });
  comfy.control.redirectTo = `${elsewhere.url}/object_info/UNETLoader`;

  expect(await listModels()).toEqual(nothing);

  expect(elsewhere.requests).toEqual([]);
  await elsewhere.stop();
});

test("the ComfyUI address must be http or https", async () => {
  const running = play();

  expect((await running.patch("/settings", { comfyUrl: "file:///etc/passwd" })).status).toBe(400);
  expect((await running.patch("/settings", { comfyUrl: "not a url" })).status).toBe(400);
  expect(((await running.get("/settings").then((r) => r.json())) as { comfyUrl: string }).comfyUrl).toBe("http://127.0.0.1:8188");
});

test("SD draws a Scene Image into the Save without a key, and it counts", async () => {
  const running = play(newScene());
  await running.patch("/settings", {
    ...sdSetup(),
    comfyLoras: [{ name: "ink.safetensors", strength: 0.7, triggerWords: "inkstyle" }],
  });
  const id = await running.createSave();

  await playTurn(id);

  expect(await settled(id)).toEqual({
    images: [{ messageId: 2, caption: "The street", redraws: 0 }],
    pending: false,
    session: 1,
  });
  expect(await (await running.get(`/saves/${id}/messages/2/image`)).bytes()).toEqual(new Uint8Array(PNG));
  const graph = comfy.jobs.prompts.at(-1)!;
  expect(nodes(graph, "LoraLoader")).toHaveLength(1);
  expect(nodes(graph, "CLIPTextEncode")[0]!.inputs.text).toStartWith("inkstyle\n");
  expect(comfy.jobs.uploads).toEqual([]);
});

test("the image key never reaches ComfyUI", async () => {
  const running = play(newScene());
  await running.patch("/settings", { imageApiKey: "image-key-value" });
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();

  await playTurn(id);
  await settled(id);

  expect(comfy.requests.length).toBeGreaterThan(0);
  expect(comfy.requests.every(({ authorization }) => authorization === null)).toBe(true);
});

test("the next SD scene in the same place draws afresh, uploading no earlier picture", async () => {
  const running = play(newScene("One"), newScene("Two"));
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  await playTurn(id);
  await settled(id);

  await playTurn(id);
  await settled(id);

  expect(comfy.jobs.uploads).toEqual([]);
  const graph = comfy.jobs.prompts.at(-1)!;
  expect(nodes(graph, "LoadImage")).toEqual([]);
  expect(nodes(graph, "EmptyLatentImage")).toHaveLength(1);
});

test("FLUX.2 sends the PC's portrait and no earlier scene", async () => {
  const running = play(newScene("[Ash] on the quay"), newScene("[Ash] by the water"));
  await running.patch("/settings", flux2Setup());
  const created = await running.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", physicalTraits: "Tall" } });
  const { id } = (await created.json()) as { id: string };
  await settled(id);
  comfy.control.image = png(1);
  await playTurn(id);
  await settled(id);
  comfy.control.image = png(2);

  await playTurn(id);
  await settled(id);

  const graph = comfy.jobs.prompts.at(-1)!;
  expect(nodes(graph, "ReferenceLatent")).toHaveLength(1);
  expect(comfy.jobs.uploads.at(-1)!.bytes).toEqual(new Uint8Array(PNG));
  expect(comfy.jobs.uploads.some(({ bytes }) => bytes.at(-1) === 1)).toBe(false);
  expect((await imagesOf(id)).images.map(({ caption }) => caption)).toEqual(["The street", "The street"]);
});

test("an image generates with no references at all", async () => {
  const running = play(newScene());
  await running.patch("/settings", flux2Setup());
  const id = await running.createSave();

  await playTurn(id);

  expect(await settled(id)).toMatchObject({ images: [{ caption: "The street" }] });
  expect(nodes(comfy.jobs.prompts.at(-1)!, "ReferenceLatent")).toEqual([]);
});

test.each([
  ["no checkpoint", { comfyCheckpoint: "" }],
  ["FLUX.2 without a VAE", { comfyFamily: "flux2", comfyDiffusionModel: "a", comfyTextEncoder: "b", comfyVae: "" }],
  ["images off", { imagesEnabled: false }],
])("%s makes no call and no noise", async (_name, change) => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", { ...sdSetup(), ...change });
  const id = await running.createSave();

  expect((await playTurn(id)).status).toBe(201);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(comfy.requests).toEqual([]);
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
});

test.each<[string, () => unknown]>([
  ["ComfyUI rejects a model that's gone", () => comfy.installed.checkpoints.splice(0)],
  ["the job fails", () => (comfy.control.historyError = true)],
  ["what comes back isn't an image", () => (comfy.control.image = new TextEncoder().encode("<svg></svg>"))],
])("%s: the Turn stands, nothing is stored or counted, and the log has why", async (_name, breakIt) => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  await settled(id);
  breakIt();

  expect((await playTurn(id)).status).toBe(201);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});

test("Revert stops a running job by its own id, and its late result writes nothing", async () => {
  const running = play(newScene());
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  comfy.control.hold = true;
  await playTurn(id);
  await until(() => comfy.jobs.running.length === 1);
  const job = comfy.jobs.running[0]!.id;

  await running.post(`/saves/${id}/messages/1/revert`, {});

  await until(() => comfy.jobs.interrupted.length === 1);
  expect(comfy.jobs.interrupted).toEqual([{ prompt_id: job }]);
  comfy.finish();
  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
});

test("a job still queued comes off the queue, and the player's own running job is left alone", async () => {
  const running = play(newScene());
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  comfy.control.hold = true;
  comfy.jobs.running.push({ id: "the-players-own-job", graph: {} });
  await playTurn(id);
  await until(() => comfy.jobs.pending.length === 1);
  const job = comfy.jobs.pending[0]!.id;

  await running.delete(`/saves/${id}`);

  await until(() => comfy.jobs.deleted.length === 1);
  expect(comfy.jobs.deleted).toEqual([job]);
  expect(comfy.jobs.interrupted).toEqual([]);
});

test("a job ComfyUI has lost fails instead of waiting forever", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  comfy.control.hold = true;
  await playTurn(id);
  await until(() => comfy.jobs.running.length === 1);

  comfy.control.forgetJobs = true;

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});

const payload = { prompt: "A harbour", aspect_ratio: "1:1", reference_images: [], style_preset: "" };

function quickAdapter(limits: { pollMs: number; silenceMs: number }) {
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ comfyUrl: comfy.url, comfyCheckpoint: "dream_xl.safetensors" });
  return comfyImages(settings, limits);
}

test("a server that assigns its own job id is followed by that id", async () => {
  comfy.control.ownIds = true;

  const image = await quickAdapter({ pollMs: 5, silenceMs: 1000 })(payload, new AbortController().signal);

  expect(image).toEqual(new Uint8Array(PNG));
});

test("a job aborted while /prompt is still answering is stopped once it's queued", async () => {
  comfy.control.hold = true;
  comfy.control.promptDelayMs = 60;
  const controller = new AbortController();
  const draw = quickAdapter({ pollMs: 5, silenceMs: 1000 })(payload, controller.signal);
  await until(() => comfy.requests.some(({ path }) => path === "/prompt"));

  controller.abort();

  await expect(draw).rejects.toThrow();
  await until(() => comfy.jobs.interrupted.length === 1);
  expect(comfy.jobs.interrupted).toEqual([{ prompt_id: comfy.jobs.running[0]!.id }]);
});

test("a long job on a server that keeps answering isn't cut off, however long it takes", async () => {
  comfy.control.hold = true;
  const draw = quickAdapter({ pollMs: 5, silenceMs: 40 })(payload, new AbortController().signal);

  await Bun.sleep(150);
  comfy.finish();

  expect(await draw).toEqual(new Uint8Array(PNG));
});

test("a server that goes silent mid-job is given up on", async () => {
  comfy.control.hold = true;
  const draw = quickAdapter({ pollMs: 5, silenceMs: 40 })(payload, new AbortController().signal);
  await until(() => comfy.jobs.running.length === 1);

  comfy.control.silent = true;

  await expect(draw).rejects.toThrow("stopped responding");
});

const INSTALLED_EXAMPLE = WORKFLOW_EXAMPLE.replace("your_model.safetensors", "dream_xl.safetensors");
const advancedSetup = (comfyWorkflow = INSTALLED_EXAMPLE) => ({
  imageProvider: "local",
  comfyUrl: comfy.url,
  comfyMode: "advanced",
  comfyWorkflow,
});
const settingsNow = () => app!.get("/settings").then((r) => r.json()) as Promise<Record<string, unknown>>;
const graphWith = (nodes: object) => JSON.stringify({ "1": { class_type: "Text", inputs: { text: "{{prompt}}" } }, ...nodes });

test("an Advanced workflow draws a Scene Image into the Save, and it counts", async () => {
  const running = play(newScene());
  await running.patch("/settings", { ...advancedSetup(), comfyLoras: [{ name: "ink.safetensors", strength: 1, triggerWords: "inkstyle" }] });
  const id = await running.createSave();

  await playTurn(id);

  expect(await settled(id)).toEqual({ images: [{ messageId: 2, caption: "The street", redraws: 0 }], pending: false, session: 1 });
  const graph = comfy.jobs.prompts.at(-1)!;
  expect(nodes(graph, "CLIPTextEncode")[0]!.inputs.text).toEndWith("A flooded street");
  expect(nodes(graph, "CLIPTextEncode")[1]!.inputs.text).toBe("text, captions, letters, numbers, dice");
  expect(nodes(graph, "EmptyLatentImage")[0]!.inputs).toMatchObject({ width: 1280, height: 720 });
  expect(nodes(graph, "KSampler")[0]!.inputs.seed).toBeNumber();
  // The Simple Mode LoRA list and trigger words are the workflow's business here.
  expect(nodes(graph, "LoraLoader")).toEqual([]);
  expect(JSON.stringify(graph)).not.toContain("inkstyle");
});

test("Simple Mode ignores a stored workflow", async () => {
  const running = play(newScene(), newScene("Two", "Two"));
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await playTurn(id);
  await settled(id);
  expect(nodes(comfy.jobs.prompts.at(-1)!, "CheckpointLoaderSimple")[0]!.inputs.ckpt_name).toBe("dream_xl.safetensors");

  await running.patch("/settings", { comfyMode: "simple", comfyCheckpoint: "dream_15.safetensors" });
  await playTurn(id);
  await settled(id);

  expect(nodes(comfy.jobs.prompts.at(-1)!, "CheckpointLoaderSimple")[0]!.inputs.ckpt_name).toBe("dream_15.safetensors");
});

test("references reach a workflow by role, with a blank in an empty slot", async () => {
  const workflow = graphWith({
    "2": { class_type: "LoadImage", inputs: { image: "{{pc}}" } },
    "3": { class_type: "LoadImage", inputs: { image: "{{npc_1}}" } },
    "4": { class_type: "Weight", inputs: { pc: "{{has_pc}}", npc: "{{has_npc_1}}" } },
    "5": { class_type: "PreviewImage", inputs: {} },
  });
  const running = play(newScene("[Ash] on the quay"));
  await running.patch("/settings", advancedSetup(workflow));
  const created = await running.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", physicalTraits: "Tall" } });
  const { id } = (await created.json()) as { id: string };
  await settled(id);
  comfy.jobs.uploads.splice(0);

  await playTurn(id);
  await settled(id);

  const graph = comfy.jobs.prompts.at(-1)!;
  expect(graph["4"]!.inputs).toEqual({ pc: 1, npc: 0 });
  const portrait = comfy.jobs.uploads.find(({ bytes }) => bytes.length === PNG.length && bytes.every((byte, index) => byte === PNG[index]))!;
  const blank = comfy.jobs.uploads.find((upload) => upload !== portrait)!;
  expect(graph["2"]!.inputs.image).toBe(`novelforge/${portrait.name} [temp]`);
  expect(graph["3"]!.inputs.image).toBe(`novelforge/${blank.name} [temp]`);
  expect(blank).toMatchObject({ subfolder: "novelforge", type: "temp" });
});

test.each([
  ["a saved image beats a later preview", { "3": "SaveImage", "9": "PreviewImage" }, 3],
  ["the highest numbered saved image wins, as a number", { "9": "SaveImage", "10": "SaveImage", "2": "PreviewImage" }, 10],
])("%s", async (_name, outputs, picked) => {
  const workflow = graphWith(Object.fromEntries(Object.entries(outputs).map(([id, class_type]) => [id, { class_type, inputs: {} }])));
  const running = play(newScene());
  await running.patch("/settings", advancedSetup(workflow));
  const id = await running.createSave();

  await playTurn(id);
  await settled(id);

  expect(await (await running.get(`/saves/${id}/messages/2/image`)).bytes()).toEqual(png(picked));
});

test.each([
  ["broken JSON", "{", "isn't valid JSON"],
  ["the UI format", JSON.stringify({ nodes: [], links: [] }), "Export (API)"],
  ["an unknown placeholder", graphWith({ "2": { class_type: "Text", inputs: { text: "{{mood}}" } } }), "{{mood}}"],
  ["nothing", "", "Paste a workflow"],
])("Settings refuses %s, says why and keeps what was saved", async (_name, workflow, reason) => {
  const running = play();
  await running.patch("/settings", advancedSetup());

  const refused = await running.patch("/settings", { comfyWorkflow: workflow, fontSize: "large" });

  expect(refused.status).toBe(422);
  expect(((await refused.json()) as { error: string }).error).toContain(reason);
  expect(await settingsNow()).toMatchObject({ comfyWorkflow: INSTALLED_EXAMPLE, fontSize: "medium" });
});

test("a half-written workflow doesn't stop other settings while it isn't in use", async () => {
  const running = play();

  for (const change of [{ comfyWorkflow: "{", imageProvider: "local" }, { comfyMode: "advanced", imageProvider: "openrouter" }]) {
    expect((await running.patch("/settings", change)).status).toBe(200);
  }
  expect((await running.patch("/settings", { imageProvider: "local" })).status).toBe(422);
});

test("a stored workflow that no longer parses leaves the Turn standing and says why in Settings", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  settingsStore(join(folder.path, "settings.json")).update({ comfyWorkflow: "{" });

  expect((await playTurn(id)).status).toBe(201);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(comfy.requests.filter(({ path }) => path === "/prompt")).toEqual([]);
  expect((await settingsNow()).workflowProblem).toContain("isn't valid JSON");
  logged.mockRestore();
});

test("Advanced with no workflow stored is an unfinished setup: no call and no noise", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await settled(id);
  settingsStore(join(folder.path, "settings.json")).update({ comfyWorkflow: "" });
  comfy.requests.splice(0);

  expect((await playTurn(id)).status).toBe(201);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(comfy.requests).toEqual([]);
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("a job ComfyUI refuses shows the node in Settings and the log, and never the prompt", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const warned = spyOn(console, "warn").mockImplementation(() => {});
  const running = play(newScene("A secret door"));
  const workflow = WORKFLOW_EXAMPLE.replace('"ckpt_name": "your_model.safetensors"', '"ckpt_name": "gone.safetensors", "echo": "{{prompt}}"');
  await running.patch("/settings", advancedSetup(workflow));
  const id = await running.createSave();

  expect((await playTurn(id)).status).toBe(201);
  await settled(id);

  const { workflowProblem } = await settingsNow();
  expect(workflowProblem).toContain("value_not_in_list");
  expect(workflowProblem).toContain("node 1 (CheckpointLoaderSimple)");
  expect(workflowProblem).not.toContain("secret door");
  const log = JSON.stringify([...logged.mock.calls, ...warned.mock.calls]);
  expect(log).toContain("value_not_in_list");
  expect(log).not.toContain("secret door");
  logged.mockRestore();
  warned.mockRestore();
});

test("a custom node that isn't installed is named in Settings", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await settled(id);
  comfy.control.uninstalled = ["KSampler"];

  await playTurn(id);
  await settled(id);

  expect((await settingsNow()).workflowProblem).toBe("ComfyUI refused the job: missing_node_type (KSampler)");
  logged.mockRestore();
});

test("a job that fails shows the node in Settings, and never ComfyUI's text", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene("A secret door"));
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await settled(id);
  comfy.control.historyError = true;
  comfy.control.failure.exception_message = "bad prompt: A secret door";

  await playTurn(id);
  await settled(id);

  const { workflowProblem } = await settingsNow();
  expect(workflowProblem).toContain("node 5 (KSampler)");
  expect(workflowProblem).toContain("OutOfMemoryError");
  expect(workflowProblem).not.toContain("secret door");
  logged.mockRestore();
});

test("a preview from before a failure isn't kept as the image", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await settled(id);
  comfy.control.historyError = true;

  await playTurn(id);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  logged.mockRestore();
});

test("a job stopped in ComfyUI says so", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  await settled(id);
  comfy.control.historyError = true;
  comfy.control.failureKind = "execution_interrupted";

  await playTurn(id);
  await settled(id);

  expect((await settingsNow()).workflowProblem).toContain("stopped");
  logged.mockRestore();
});

test("a job with no image output says so", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene());
  await running.patch("/settings", advancedSetup(graphWith({})));
  const id = await running.createSave();

  await playTurn(id);
  await settled(id);

  expect((await settingsNow()).workflowProblem).toContain("SaveImage or PreviewImage");
  logged.mockRestore();
});

test("the problem clears with the next image, and with a changed workflow", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const running = play(newScene("One"), newScene("Two"), newScene("Three", "Three"));
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  comfy.control.historyError = true;
  await playTurn(id);
  await settled(id);
  expect((await settingsNow()).workflowProblem).not.toBe("");

  comfy.control.historyError = false;
  await playTurn(id);
  await settled(id);
  expect((await settingsNow()).workflowProblem).toBe("");

  comfy.control.historyError = true;
  await playTurn(id);
  await settled(id);
  expect((await settingsNow()).workflowProblem).not.toBe("");
  await running.patch("/settings", { comfyWorkflow: `${INSTALLED_EXAMPLE} ` });
  expect((await settingsNow()).workflowProblem).toBe("");
  logged.mockRestore();
});

test("a job stopped by a Revert isn't a problem with the workflow", async () => {
  const running = play(newScene());
  await running.patch("/settings", advancedSetup());
  const id = await running.createSave();
  comfy.control.hold = true;
  await playTurn(id);
  await until(() => comfy.jobs.running.length === 1);

  await running.post(`/saves/${id}/messages/1/revert`, {});

  await until(() => comfy.jobs.interrupted.length === 1);
  comfy.finish();
  await settled(id);
  expect((await settingsNow()).workflowProblem).toBe("");
});

const testImage = (prompt: string) => app!.post("/settings/comfy-test", { prompt });

test("the Settings test draws the prompt with the saved choices and returns the image, without a Save", async () => {
  await play().patch("/settings", sdSetup());

  const response = await testImage("A harbour at dusk");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(comfy.control.image);
  const [encoded] = nodes(comfy.jobs.prompts[0]!, "CLIPTextEncode");
  expect(encoded!.inputs.text).toBe("A harbour at dusk");
  expect(await (await app!.get("/saves")).json()).toEqual({ saves: [] });
});

const statsOf = (response: Response) => JSON.parse(decodeURIComponent(response.headers.get("x-draw-stats")!));

test("the Settings test reports how the image was drawn, with the seed the job really used", async () => {
  await play().patch("/settings", sdSetup());

  const stats = statsOf(await testImage("A harbour at dusk"));

  expect(stats.seconds).toBeGreaterThanOrEqual(0);
  expect(stats).toMatchObject({ model: "dream_xl.safetensors", steps: 25 });
  expect(stats.seed).toBe(nodes(comfy.jobs.prompts[0]!, "KSampler")[0]!.inputs.seed);
});

test("the Settings test reports only the time for a workflow, which picks its own model, steps and seed", async () => {
  await play().patch("/settings", {
    imageProvider: "local",
    comfyUrl: comfy.url,
    comfyMode: "advanced",
    comfyWorkflow: WORKFLOW_EXAMPLE.replace("your_model", "dream_xl"),
  });

  expect(Object.keys(statsOf(await testImage("A harbour at dusk")))).toEqual(["seconds"]);
});

test("the Settings test says why it failed", async () => {
  await play().patch("/settings", sdSetup());
  comfy.installed.checkpoints = [];

  const response = await testImage("A harbour at dusk");

  expect(response.status).toBe(502);
  expect(((await response.json()) as { error: string }).error).toContain("ComfyUI refused the job");
});

test("the Settings test says when ComfyUI can't be reached", async () => {
  await play().patch("/settings", { ...sdSetup(), comfyUrl: "http://127.0.0.1:9" });

  const response = await testImage("A harbour at dusk");

  expect(response.status).toBe(502);
  expect(((await response.json()) as { error: string }).error).toBe("ComfyUI can't be reached at this address. Make sure it's running.");
});

test("the Settings test asks for models before it draws, and refuses an empty prompt", async () => {
  await play().patch("/settings", { ...sdSetup(), comfyCheckpoint: "" });

  const unset = await testImage("A harbour at dusk");
  expect(unset.status).toBe(422);
  expect(((await unset.json()) as { error: string }).error).toBe("Choose your models and save first.");

  expect((await testImage("   ")).status).toBe(400);
  expect(comfy.jobs.prompts).toHaveLength(0);
});
