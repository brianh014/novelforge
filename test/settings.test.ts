import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { settingsStore } from "../src/settings-store";
import { narration, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;

beforeEach(() => {
  folder = tempFolder();
  app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
});

afterEach(async () => {
  await app.stop();
  folder.remove();
});

const settings = () => app.get("/settings").then((r) => r.json());
const change = (body: unknown) => app.patch("/settings", body);
// The app's own settings file, to see the keys a response never shows.
const store = () => settingsStore(join(folder.path, "settings.json"));

test("a fresh install has images on, Prose, medium type, blank Model Instructions and no keys", async () => {
  expect(await settings()).toEqual({
    textBaseUrl: "https://openrouter.ai/api/v1",
    textModel: "",
    textRouting: "price",
    textHost: "",
    textHostFallback: true,
    hasTextApiKey: false,
    textKeysFor: [],
    textProfiles: {
      "https://openrouter.ai/api/v1": {
        textModel: "",
        textRouting: "price",
        textHost: "",
        textHostFallback: true,
        textMaxTokens: 16_000,
        textReplyMinutes: 8,
        textRecentMessages: 80,
      },
    },
    modelInstructions: "",
    imageInstructions: "",
    textMaxTokens: 16_000,
    textReplyMinutes: 8,
    textRecentMessages: 80,
    answerRejectWords: 120,
    imageProvider: "openrouter",
    imageModel: "",
    hasImageApiKey: false,
    imageKeysFor: [],
    imageProfiles: { openrouter: { imageModel: "", imageResolution: "1k" } },
    imagesEnabled: true,
    openNewImages: true,
    drawScenes: true,
    updatePortraits: false,
    imagesReady: false,
    comfyUrl: "http://127.0.0.1:8188",
    comfyFamily: "sd",
    comfySdBase: "sdxl",
    imageResolution: "1k",
    comfyCheckpoint: "",
    comfyDiffusionModel: "",
    comfyTextEncoder: "",
    comfyVae: "",
    comfyLoras: [],
    comfySteps: null,
    comfyCfg: null,
    comfyDefaults: true,
    comfySampler: "",
    comfyScheduler: "",
    comfyFamilyPicks: {},
    comfyMode: "simple",
    comfyWorkflow: "",
    comfyFreeMemory: false,
    workflowProblem: "",
    chatStyle: "prose",
    fontSize: "medium",
    theme: "system",
    logLevel: null,
    defaultLogLevel: "warning",
    canQuit: false,
  });
});

test("a server can't be quit from a page", async () => {
  expect((await app.post("/quit", {})).status).toBe(404);
  expect((await app.get("/settings")).status).toBe(200);
});

test("every setting survives a restart, and no key comes back", async () => {
  const comfy = {
    comfyUrl: "http://localhost:8188",
    comfyFamily: "flux2",
    comfySdBase: "sd15",
    imageResolution: "2k",
    comfyCheckpoint: "dream.safetensors",
    comfyDiffusionModel: "flux2.safetensors",
    comfyTextEncoder: "mistral.safetensors",
    comfyVae: "vae.safetensors",
    comfyLoras: [{ name: "ink.safetensors", strength: 0.7, triggerWords: "inkstyle" }],
    comfySteps: 12,
    comfyCfg: 4.5,
    comfyDefaults: false,
    comfySampler: "euler",
    comfyScheduler: "karras",
    comfyFamilyPicks: {
      qwen21: {
        comfyDiffusionModel: "qwen.safetensors",
        comfyTextEncoder: "vl.safetensors",
        comfyVae: "q.safetensors",
        comfyLoras: [],
        comfySteps: null,
        comfyCfg: 1,
      },
    },
    comfyMode: "advanced",
    comfyWorkflow: JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } } }),
    comfyFreeMemory: true,
  };
  const response = await change({
    textBaseUrl: "http://localhost:1234/v1",
    textModel: "local/model",
    textRouting: "latency",
    textHost: "xiaomi",
    textHostFallback: false,
    textApiKey: "text-key-value",
    modelInstructions: "Keep it short.",
    imageInstructions: "Soft light.",
    textMaxTokens: 9000,
    textReplyMinutes: 3,
    textRecentMessages: 120,
    answerRejectWords: 200,
    imageProvider: "local",
    imageModel: "image/model",
    imageApiKey: "image-key-value",
    imagesEnabled: false,
    openNewImages: false,
    drawScenes: false,
    updatePortraits: true,
    imagesReady: false,
    ...comfy,
    chatStyle: "prose",
    fontSize: "large",
    theme: "dark",
  });
  const expected = {
    textBaseUrl: "http://localhost:1234/v1",
    textModel: "local/model",
    textRouting: "latency",
    textHost: "xiaomi",
    textHostFallback: false,
    hasTextApiKey: true,
    textKeysFor: ["http://localhost:1234/v1"],
    textProfiles: {
      "https://openrouter.ai/api/v1": {
        textModel: "",
        textRouting: "price",
        textHost: "",
        textHostFallback: true,
        textMaxTokens: 16_000,
        textReplyMinutes: 8,
        textRecentMessages: 80,
      },
      "http://localhost:1234/v1": {
        textModel: "local/model",
        textRouting: "latency",
        textHost: "xiaomi",
        textHostFallback: false,
        textMaxTokens: 9000,
        textReplyMinutes: 3,
        textRecentMessages: 120,
      },
    },
    modelInstructions: "Keep it short.",
    imageInstructions: "Soft light.",
    textMaxTokens: 9000,
    textReplyMinutes: 3,
    textRecentMessages: 120,
    answerRejectWords: 200,
    imageProvider: "local",
    imageModel: "image/model",
    hasImageApiKey: true,
    imageKeysFor: ["local"],
    imageProfiles: { openrouter: { imageModel: "", imageResolution: "1k" }, local: { imageModel: "image/model", imageResolution: "2k" } },
    imagesEnabled: false,
    openNewImages: false,
    drawScenes: false,
    updatePortraits: true,
    imagesReady: false,
    ...comfy,
    workflowProblem: "",
    chatStyle: "prose",
    fontSize: "large",
    theme: "dark",
    logLevel: null,
    defaultLogLevel: "warning",
    canQuit: false,
  };
  expect(await response.json()).toEqual(expected);

  await app.restart();

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

test("each text server keeps its own key, which comes back on a switch back and never goes to another server", async () => {
  await change({ textApiKey: "openrouter-key-value" });
  expect(await change({ textBaseUrl: "http://localhost:1234/v1", textApiKey: "local-key-value" }).then((r) => r.json())).toMatchObject({
    hasTextApiKey: true,
    textKeysFor: ["https://openrouter.ai/api/v1", "http://localhost:1234/v1"],
  });

  await change({ textBaseUrl: "https://openrouter.ai/api/v1" });
  expect(store().read().textApiKey).toBe("openrouter-key-value");
  await change({ textBaseUrl: "http://localhost:1234/v1" });
  expect(store().read().textApiKey).toBe("local-key-value");

  const elsewhere = await change({ textBaseUrl: "https://api.deepinfra.com/v1/openai" }).then((r) => r.json());
  expect(elsewhere.hasTextApiKey).toBe(false);
  expect(store().read().textApiKey).toBe("");
});

test("each image provider keeps its own key, and the keys themselves never reach a response", async () => {
  await change({ imageApiKey: "openrouter-image-key" });
  await change({ imageProvider: "wiro", imageApiKey: "wiro-image-key" });

  const back = await change({ imageProvider: "openrouter" });
  const text = await back.text();
  expect(JSON.parse(text)).toMatchObject({ hasImageApiKey: true, imageKeysFor: ["openrouter", "wiro"] });
  expect(text).not.toContain("image-key");
  expect(store().read().imageApiKey).toBe("openrouter-image-key");

  await change({ imageProvider: "google" });
  expect(store().read().imageApiKey).toBe("");
});

test("a settings file from before put-away keys files the keys in use, so switching away and back keeps them", () => {
  const old = join(folder.path, "old-keys.json");
  writeFileSync(old, JSON.stringify({ textApiKey: "openrouter-key-value", imageProvider: "wiro", imageApiKey: "wiro-image-key" }));
  const keys = settingsStore(old);

  keys.update({ textBaseUrl: "http://localhost:1234/v1", imageProvider: "openrouter" });
  keys.update({ textBaseUrl: "https://openrouter.ai/api/v1", imageProvider: "wiro" });

  expect(keys.read()).toMatchObject({ textApiKey: "openrouter-key-value", imageApiKey: "wiro-image-key" });
});

test("a switch back brings each server's and provider's model and the rest of its own settings with it", async () => {
  await change({ textModel: "xiaomi/mimo-v2.6-pro", textHost: "deepinfra", textMaxTokens: 9000, imageModel: "bytedance/seedream-5.5", imageResolution: "2k" });
  await change({ textBaseUrl: "http://localhost:1234/v1", textModel: "gemma-local", textMaxTokens: 3000, imageProvider: "wiro" });
  // A provider never used starts with no model, and the rest carries over.
  expect(store().read()).toMatchObject({ imageModel: "", imageResolution: "2k" });
  await change({ imageModel: "bytedance/seedream-5-5", imageResolution: "1k" });

  const back = await change({ textBaseUrl: "https://openrouter.ai/api/v1", imageProvider: "openrouter" }).then((r) => r.json());

  expect(back).toMatchObject({
    textModel: "xiaomi/mimo-v2.6-pro",
    textHost: "deepinfra",
    textMaxTokens: 9000,
    imageModel: "bytedance/seedream-5.5",
    imageResolution: "2k",
  });
  // The form switches before it saves, so it gets each one's settings, without the keys.
  expect(back.textProfiles["http://localhost:1234/v1"]).toMatchObject({ textModel: "gemma-local", textMaxTokens: 3000 });
  expect(back.imageProfiles.wiro).toEqual({ imageModel: "bytedance/seedream-5-5", imageResolution: "1k" });
});

test("put-away settings can't be set by a request", async () => {
  await change({ textProfiles: { "https://evil.example/v1": { textApiKey: "planted" } } } as never);
  expect(Object.keys(store().read().textProfiles)).toEqual(["https://openrouter.ai/api/v1"]);
});

test("options that don't exist are refused and change nothing", async () => {
  for (const body of [{ fontSize: "huge" }, { chatStyle: "comic" }, { imageProvider: "comfy" }, { imagesEnabled: "no" }, { theme: "sepia" }]) {
    expect((await change(body)).status).toBe(400);
  }
  expect(await settings()).toMatchObject({ fontSize: "medium", chatStyle: "prose", imageProvider: "openrouter", imagesEnabled: true, theme: "system" });
});

test("a stored Stage box Chat style, no longer offered, reads as Prose", async () => {
  expect((await change({ chatStyle: "stage" })).status).toBe(200);
  await app.restart();
  expect(await settings()).toMatchObject({ chatStyle: "prose" });
});

test("an install's settings file from before these settings gets their defaults", async () => {
  await Bun.write(join(folder.path, "settings.json"), JSON.stringify({ textModel: "old/model" }));

  expect(await settings()).toMatchObject({ textModel: "old/model", imagesEnabled: true, openNewImages: true, fontSize: "medium" });
});

test("a Steps or CFG typed before the defaults toggle keeps it off, so the number still draws", async () => {
  await Bun.write(join(folder.path, "settings.json"), JSON.stringify({ comfySteps: 12 }));
  expect(await settings()).toMatchObject({ comfyDefaults: false, comfySteps: 12 });

  await Bun.write(join(folder.path, "settings.json"), JSON.stringify({ comfySteps: null, comfyCfg: null }));
  expect(await settings()).toMatchObject({ comfyDefaults: true });
});

const artStyleOf = async (id: string) => ((await app.get(`/saves/${id}`).then((r) => r.json())) as { artStyle: string }).artStyle;
const setArtStyle = (id: string, artStyle: string) => app.patch(`/saves/${id}`, { artStyle });

test("Art Style belongs to one Save and is blank until set", async () => {
  const id = await app.createSave();
  const other = await app.createSave();
  expect(await artStyleOf(id)).toBe("");

  const response = await setArtStyle(id, "Luminous Fluid Watercolor");

  expect(await response.json()).toEqual({ artStyle: "Luminous Fluid Watercolor" });
  await app.restart();
  expect(await artStyleOf(id)).toBe("Luminous Fluid Watercolor");
  expect(await artStyleOf(other)).toBe("");
});

test("Art Style can't be set on a missing Save or to something that isn't text", async () => {
  const id = await app.createSave();

  expect((await setArtStyle(crypto.randomUUID(), "Ink")).status).toBe(404);
  expect((await app.patch(`/saves/${id}`, { artStyle: 7 })).status).toBe(400);
});

const idOf = (response: Response) => response.json().then((body) => (body as { id: string }).id);

const importBytes = (body: Uint8Array) =>
  fetch(app.url("/saves/import"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: body as BodyInit });

test("Art Style survives a Turn, a Revert, both kinds of duplicate, and export then import", async () => {
  await app.stop();
  app = startApp(join(folder.path, "Saves"), scriptedTextProvider(narration("The tide rises."), narration("The tide falls.")).textProvider);
  const id = await app.createSave();
  await setArtStyle(id, "Ukiyo-e");
  await app.post(`/saves/${id}/turns`, { input: "I wait." });
  await setArtStyle(id, "Art Deco");
  await app.post(`/saves/${id}/turns`, { input: "I wait again." });
  const { messages } = (await app.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { id: number }[] };

  const duplicate = await app.post(`/saves/${id}/duplicate`, {}).then(idOf);
  const partial = await app.post(`/saves/${id}/duplicate`, { fromMessage: messages[1]!.id }).then(idOf);
  const imported = await importBytes(await app.get(`/saves/${id}/export`).then((r) => r.bytes())).then(idOf);
  await app.post(`/saves/${id}/messages/${messages[1]!.id}/revert`, {});

  for (const save of [id, duplicate, partial, imported]) expect(await artStyleOf(save)).toBe("Art Deco");
});

test("a Save from before Art Style opens with it blank and keeps its story, and can still be imported", async () => {
  const id = await app.createSave();
  const path = join(folder.path, "Saves", `${id}.sqlite`);
  {
    using db = new Database(path);
    db.run(
      "ALTER TABLE save DROP COLUMN art_style; ALTER TABLE save DROP COLUMN starting_hook; ALTER TABLE save DROP COLUMN pc_details; PRAGMA user_version = 1",
    );
  }
  const older = await Bun.file(path).bytes();

  expect(await app.get(`/saves/${id}`).then((r) => r.json())).toMatchObject({ worldBrief: "A drowned city", artStyle: "" });
  const imported = await importBytes(older);
  expect(imported.status).toBe(201);
  expect(await artStyleOf(((await imported.json()) as { id: string }).id)).toBe("");
});

test("API keys never enter a Save, its duplicates or its export", async () => {
  await app.stop();
  app = startApp(join(folder.path, "Saves"), scriptedTextProvider(narration("The tide rises.")).textProvider);
  const textKey = `text-key-${crypto.randomUUID()}`;
  const imageKey = `image-key-${crypto.randomUUID()}`;
  await change({ textApiKey: textKey, imageApiKey: imageKey, modelInstructions: "Keep it short." });
  const id = await app.createSave();
  await setArtStyle(id, "Ink");
  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  const duplicate = await app.post(`/saves/${id}/duplicate`, {}).then(idOf);
  const partial = await app.post(`/saves/${id}/duplicate`, { fromMessage: 1 }).then(idOf);
  const files = [id, duplicate, partial].map((save) => join(folder.path, "Saves", `${save}.sqlite`));
  const rawFiles = await Promise.all(files.map((file) => Bun.file(file).bytes()));
  const exported = await app.get(`/saves/${id}/export`).then((r) => r.bytes());

  // The markers must be where keys belong, or this test would pass with no key stored at all.
  const stored = await Bun.file(join(folder.path, "settings.json")).bytes();
  expect(Buffer.from(stored).includes(textKey)).toBe(true);
  expect(Buffer.from(stored).includes(imageKey)).toBe(true);
  for (const bytes of [...rawFiles, exported]) {
    expect(Buffer.from(bytes).includes(textKey)).toBe(false);
    expect(Buffer.from(bytes).includes(imageKey)).toBe(false);
  }
  expect(await app.get("/settings").then((r) => r.text())).not.toContain("-key-");
});

test("a resolution saved by its old video name or in megapixels reads as the nearest K", () => {
  const path = join(folder.path, "old-settings.json");
  for (const [old, now] of [
    ["480p", "1k"],
    ["720p", "1k"],
    ["1080p", "1.5k"],
    ["4k", "2k"],
    ["0.5mp", "1k"],
    ["1mp", "1k"],
    ["2mp", "1.5k"],
  ]) {
    writeFileSync(path, JSON.stringify({ imageResolution: old }));
    expect(settingsStore(path).read().imageResolution).toBe(now as never);
  }
});

test("one bad setting falls back to its default and keeps the rest", () => {
  const path = join(folder.path, "bad-field.json");
  writeFileSync(path, JSON.stringify({ textModel: "kept", fontSize: "huge", textMaxTokens: 5 }));
  const read = settingsStore(path).read();
  expect(read.textModel).toBe("kept");
  expect(read.fontSize).toBe("medium");
  expect(read.textMaxTokens).toBe(16_000);
});

test("a text server that won't read takes its key with it, and a stray built-in name is ignored", () => {
  const path = join(folder.path, "bad-url.json");
  writeFileSync(path, JSON.stringify({ textBaseUrl: "ftp://my-box/v1", textApiKey: "for-my-box", constructor: 1, toString: "x" }));
  const read = settingsStore(path).read();
  expect(read.textBaseUrl).toBe("https://openrouter.ai/api/v1");
  expect(read.textApiKey).toBe("");
});
