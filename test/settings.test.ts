import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { narration, scriptedTextProvider, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;

beforeEach(() => {
  folder = tempFolder();
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const settings = () => game.get("/settings").then((r) => r.json());
const change = (body: unknown) => game.patch("/settings", body);

test("a fresh install has images on, Prose, medium type, blank Model Instructions and no keys", async () => {
  expect(await settings()).toEqual({
    textBaseUrl: "https://openrouter.ai/api/v1",
    textModel: "",
    hasTextApiKey: false,
    modelInstructions: "",
    imageProvider: "openrouter",
    imageModel: "",
    hasImageApiKey: false,
    imagesEnabled: true,
    imagesReady: false,
    comfyUrl: "http://127.0.0.1:8188",
    comfyFamily: "sd",
    comfySdBase: "sdxl",
    imageResolution: "720p",
    comfyCheckpoint: "",
    comfyDiffusionModel: "",
    comfyTextEncoder: "",
    comfyVae: "",
    comfyLoras: [],
    comfyMode: "simple",
    comfyWorkflow: "",
    workflowProblem: "",
    chatStyle: "prose",
    fontSize: "medium",
    theme: "system",
  });
});

test("every setting survives a restart, and no key comes back", async () => {
  const comfy = {
    comfyUrl: "http://localhost:8188",
    comfyFamily: "flux2",
    comfySdBase: "sd15",
    imageResolution: "1080p",
    comfyCheckpoint: "dream.safetensors",
    comfyDiffusionModel: "flux2.safetensors",
    comfyTextEncoder: "mistral.safetensors",
    comfyVae: "vae.safetensors",
    comfyLoras: [{ name: "ink.safetensors", strength: 0.7, triggerWords: "inkstyle" }],
    comfyMode: "advanced",
    comfyWorkflow: JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } } }),
  };
  const response = await change({
    textBaseUrl: "http://localhost:1234/v1",
    textModel: "local/model",
    textApiKey: "text-key-value",
    modelInstructions: "Keep it short.",
    imageProvider: "local",
    imageModel: "image/model",
    imageApiKey: "image-key-value",
    imagesEnabled: false,
    imagesReady: false,
    ...comfy,
    chatStyle: "prose",
    fontSize: "large",
    theme: "dark",
  });
  const expected = {
    textBaseUrl: "http://localhost:1234/v1",
    textModel: "local/model",
    hasTextApiKey: true,
    modelInstructions: "Keep it short.",
    imageProvider: "local",
    imageModel: "image/model",
    hasImageApiKey: true,
    imagesEnabled: false,
    imagesReady: false,
    ...comfy,
    workflowProblem: "",
    chatStyle: "prose",
    fontSize: "large",
    theme: "dark",
  };
  expect(await response.json()).toEqual(expected);

  await game.restart();

  expect(await settings()).toEqual(expected);
});

test("text and image can use different providers, and a text server change leaves the image key alone", async () => {
  await change({ textApiKey: "text-key-value", imageApiKey: "image-key-value" });

  const local = await change({ textBaseUrl: "http://localhost:1234/v1" }).then((r) => r.json());

  expect(local).toMatchObject({
    textBaseUrl: "http://localhost:1234/v1",
    hasTextApiKey: false,
    imageProvider: "openrouter",
    hasImageApiKey: true,
  });
});

test("options that don't exist are refused and change nothing", async () => {
  for (const body of [{ fontSize: "huge" }, { chatStyle: "comic" }, { imageProvider: "comfy" }, { imagesEnabled: "no" }]) {
    expect((await change(body)).status).toBe(400);
  }
  expect(await settings()).toMatchObject({ fontSize: "medium", chatStyle: "prose", imageProvider: "openrouter", imagesEnabled: true });
});

test.each(["script", "prose", "bubbles", "stage"])("the %s Chat style persists through a restart", async (chatStyle) => {
  expect((await change({ chatStyle })).status).toBe(200);
  await game.restart();
  expect(await settings()).toMatchObject({ chatStyle });
});

test("an install's settings file from before these settings gets their defaults", async () => {
  await Bun.write(join(folder.path, "settings.json"), JSON.stringify({ textModel: "old/model" }));

  expect(await settings()).toMatchObject({ textModel: "old/model", imagesEnabled: true, fontSize: "medium" });
});

const artStyleOf = async (id: string) => ((await game.get(`/saves/${id}`).then((r) => r.json())) as { artStyle: string }).artStyle;
const setArtStyle = (id: string, artStyle: string) => game.patch(`/saves/${id}`, { artStyle });

test("Art Style belongs to one Save and is blank until set", async () => {
  const id = await game.createSave();
  const other = await game.createSave();
  expect(await artStyleOf(id)).toBe("");

  const response = await setArtStyle(id, "Luminous Fluid Watercolor");

  expect(await response.json()).toEqual({ artStyle: "Luminous Fluid Watercolor" });
  await game.restart();
  expect(await artStyleOf(id)).toBe("Luminous Fluid Watercolor");
  expect(await artStyleOf(other)).toBe("");
});

test("Art Style can't be set on a missing Save or to something that isn't text", async () => {
  const id = await game.createSave();

  expect((await setArtStyle(crypto.randomUUID(), "Ink")).status).toBe(404);
  expect((await game.patch(`/saves/${id}`, { artStyle: 7 })).status).toBe(400);
});

const idOf = (response: Response) => response.json().then((body) => (body as { id: string }).id);

const importBytes = (body: Uint8Array) =>
  fetch(game.url("/saves/import"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: body as BodyInit });

test("Art Style survives a Turn, a Revert, both kinds of duplicate, and export then import", async () => {
  await game.stop();
  game = startGame(
    join(folder.path, "Saves"),
    scriptedTextProvider(narration("The tide rises."), narration("The tide falls.")).textProvider,
  );
  const id = await game.createSave();
  await setArtStyle(id, "Ukiyo-e");
  await game.post(`/saves/${id}/turns`, { input: "I wait." });
  await setArtStyle(id, "Art Deco");
  await game.post(`/saves/${id}/turns`, { input: "I wait again." });
  const { messages } = (await game.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { id: number }[] };

  const duplicate = await game.post(`/saves/${id}/duplicate`, {}).then(idOf);
  const partial = await game.post(`/saves/${id}/duplicate`, { fromMessage: messages[1]!.id }).then(idOf);
  const imported = await importBytes(await game.get(`/saves/${id}/export`).then((r) => r.bytes())).then(idOf);
  await game.post(`/saves/${id}/messages/${messages[1]!.id}/revert`, {});

  for (const save of [id, duplicate, partial, imported]) expect(await artStyleOf(save)).toBe("Art Deco");
});

test("a Save from before Art Style opens with it blank and keeps its story, and can still be imported", async () => {
  const id = await game.createSave();
  const path = join(folder.path, "Saves", `${id}.sqlite`);
  {
    using db = new Database(path);
    db.run(
      "ALTER TABLE save DROP COLUMN art_style; ALTER TABLE save DROP COLUMN starting_hook; ALTER TABLE save DROP COLUMN pc_details; PRAGMA user_version = 1",
    );
  }
  const older = await Bun.file(path).bytes();

  expect(await game.get(`/saves/${id}`).then((r) => r.json())).toMatchObject({ worldBrief: "A drowned city", artStyle: "" });
  const imported = await importBytes(older);
  expect(imported.status).toBe(201);
  expect(await artStyleOf(((await imported.json()) as { id: string }).id)).toBe("");
});

test("API keys never enter a Save, its duplicates or its export", async () => {
  await game.stop();
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider(narration("The tide rises.")).textProvider);
  const textKey = `text-key-${crypto.randomUUID()}`;
  const imageKey = `image-key-${crypto.randomUUID()}`;
  await change({ textApiKey: textKey, imageApiKey: imageKey, modelInstructions: "Keep it short." });
  const id = await game.createSave();
  await setArtStyle(id, "Ink");
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const duplicate = await game.post(`/saves/${id}/duplicate`, {}).then(idOf);
  const partial = await game.post(`/saves/${id}/duplicate`, { fromMessage: 1 }).then(idOf);
  const files = [id, duplicate, partial].map((save) => join(folder.path, "Saves", `${save}.sqlite`));
  const rawFiles = await Promise.all(files.map((file) => Bun.file(file).bytes()));
  const exported = await game.get(`/saves/${id}/export`).then((r) => r.bytes());

  // The markers must be where keys belong, or this test would pass with no key stored at all.
  const stored = await Bun.file(join(folder.path, "settings.json")).bytes();
  expect(Buffer.from(stored).includes(textKey)).toBe(true);
  expect(Buffer.from(stored).includes(imageKey)).toBe(true);
  for (const bytes of [...rawFiles, exported]) {
    expect(Buffer.from(bytes).includes(textKey)).toBe(false);
    expect(Buffer.from(bytes).includes(imageKey)).toBe(false);
  }
  expect(await game.get("/settings").then((r) => r.text())).not.toContain("-key-");
});
