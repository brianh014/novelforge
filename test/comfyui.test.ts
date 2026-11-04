import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { comfyImages } from "../src/comfyui";
import type { Graph } from "../src/graph-builder";
import { settingsStore } from "../src/settings-store";
import { fakeComfyUI } from "./fake-comfyui";
import { PNG, png, scriptedTextProvider, startGame, tempFolder } from "./support";

type Images = { images: { messageId: number; caption: string }[]; pending: boolean; session: number };

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame> | undefined;
let comfy: ReturnType<typeof fakeComfyUI>;

const play = (...replies: (string | Error)[]) => {
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider(...replies).textProvider);
  return game;
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
  await game?.stop();
  game = undefined;
  await comfy.stop();
  folder.remove();
});

const turn = (fields: object) => JSON.stringify({ check: null, narration: "The tide rises.", state_operations: [], ...fields });
const newScene = (description = "A flooded street", location = "The street") =>
  turn({ scene_changed: true, visual_description: description, state_operations: [{ op: "set_scene", location, visible_cast: [] }] });

const imagesOf = async (id: string) => (await game!.get(`/saves/${id}/images`).then((r) => r.json())) as Images;
const playTurn = (id: string) => game!.post(`/saves/${id}/turns`, { input: "I wade forward." });

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

const listModels = () => game!.get("/settings/comfy-models").then((r) => r.json()) as Promise<Record<string, unknown>>;

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
    images: [{ messageId: 2, caption: "The street" }],
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

test("the next SD scene uploads the previous Scene Image and uses it through img2img", async () => {
  const running = play(newScene("One", "One"), newScene("Two", "Two"));
  await running.patch("/settings", sdSetup());
  const id = await running.createSave();
  await playTurn(id);
  await settled(id);

  await playTurn(id);
  await settled(id);

  expect(comfy.jobs.uploads).toHaveLength(1);
  const [upload] = comfy.jobs.uploads;
  expect(upload).toMatchObject({ subfolder: "novelforge", type: "temp" });
  expect(upload!.bytes).toEqual(new Uint8Array(PNG));
  const graph = comfy.jobs.prompts.at(-1)!;
  expect(nodes(graph, "LoadImage")[0]!.inputs.image).toBe(`novelforge/${upload!.name} [temp]`);
  expect(nodes(graph, "EmptyLatentImage")).toEqual([]);
});

test("FLUX.2 sends the previous scene and the PC's portrait, each under its own name", async () => {
  const running = play(newScene("One", "One"), newScene("Two", "Two"));
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
  expect(nodes(graph, "ReferenceLatent")).toHaveLength(2);
  expect(new Set(nodes(graph, "LoadImage").map(({ inputs }) => inputs.image)).size).toBe(2);
  expect(comfy.jobs.uploads.at(-2)!.bytes).toEqual(png(1));
  expect(comfy.jobs.uploads.at(-1)!.bytes).toEqual(new Uint8Array(PNG));
  expect((await imagesOf(id)).images.map(({ caption }) => caption)).toEqual(["One", "Two"]);
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
