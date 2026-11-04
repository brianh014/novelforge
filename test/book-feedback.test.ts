import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { OPENING_INPUT } from "../src/prompt-assembler";
import { saveStore } from "../src/save-store";
import { readable } from "../src/web/chat-style";
import { narration, png, scriptedDice, scriptedImages, scriptedTextProvider, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let game: ReturnType<typeof startGame>;

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const SECRET = "ZQX-SECRET";
const generated = JSON.stringify({
  world_overview: "Rain never stops in Saltmere.",
  lore_entries: [{ title: "Magic", keywords: ["magic", "spell", "sorcery"], content: `${SECRET} magic is real.` }],
  world_rules: [`${SECRET} rule.`],
  plot_threads: [`${SECRET} the mayor is a ghost.`],
});
const sheet = JSON.stringify({ wearing: [], health: "unhurt", injuries: [], conditions: [] });
const noConflict = JSON.stringify({ world_update: null });
const choices = { theme: "Western", worldBrief: "A drowned city", startingHook: "", artStyle: "Ink wash" };

async function withImages(replies: (string | Error)[], ...images: Parameters<typeof scriptedImages>) {
  const script = scriptedTextProvider(...replies);
  const drawn = scriptedImages(...images);
  game = startGame(savesDir, script.textProvider, scriptedDice(), 2, drawn.imageAdapter);
  await game.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });
  return { ...script, ...drawn };
}

const newWorld = async () => ((await (await game.post("/worlds", choices)).json()) as { id: string }).id;

const begin = async (worldId: string) => {
  const response = await game.post("/saves", { worldId, worldBrief: "A drowned city", startingHook: "", pc: { name: "Ash" }, inventory: [] });
  return ((await response.json()) as { id: string }).id;
};

const coverIsStored = async (id: string) => {
  for (let tries = 0; tries < 50; tries++) {
    if (saveStore(savesDir).read(id).hasCover) return true;
    await Bun.sleep(5);
  }
  return false;
};

test("a new world's cover is portrait book art from what the player reads, in their Art Style, with no secrets", async () => {
  const { payloads } = await withImages([generated], png(1));

  const world = await newWorld();
  const response = await game.get(`/worlds/${world}/cover`);

  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png(1));
  const [cover] = payloads;
  expect(cover!.aspect_ratio).toBe("2:3");
  expect(cover!.style_preset).toBe("Ink wash");
  expect(cover!.prompt).toContain("Rain never stops in Saltmere.");
  expect(cover!.negative_prompt).toContain("text");
  expect(JSON.stringify(cover)).not.toContain(SECRET);
});

test("the cover goes with the world into its Save, even if it finishes after the Save is made", async () => {
  const { promise: painted, resolve: finish } = Promise.withResolvers<Uint8Array>();
  await withImages([generated, sheet, noConflict], painted, png(2));

  const id = await begin(await newWorld());
  expect((await game.get(`/saves/${id}/cover`)).status).toBe(404);
  finish(png(1));

  expect(await coverIsStored(id)).toBe(true);
  expect(new Uint8Array(await (await game.get(`/saves/${id}/cover`)).arrayBuffer())).toEqual(png(1));
});

test("a Revert leaves the cover, and a duplicate and an exported Save keep it", async () => {
  await withImages([generated, sheet, noConflict, narration("One."), narration("Two.")], png(1), png(2));
  const id = await begin(await newWorld());
  expect(await coverIsStored(id)).toBe(true);
  await game.post(`/saves/${id}/turns`, { input: "A" });
  await game.post(`/saves/${id}/turns`, { input: "B" });

  await game.post(`/saves/${id}/messages/2/revert`, {});
  const { id: copy } = (await (await game.post(`/saves/${id}/duplicate`, {})).json()) as { id: string };
  const bytes = await (await game.get(`/saves/${id}/export`)).arrayBuffer();
  const imported = saveStore(savesDir).import(new Uint8Array(bytes));

  for (const save of [id, copy, imported]) expect(saveStore(savesDir).cover(save)).toEqual(png(1));
});

test("an imported Save whose cover isn't an image is refused", async () => {
  await withImages([generated, sheet, noConflict], png(1), png(2));
  const id = await begin(await newWorld());
  expect(await coverIsStored(id)).toBe(true);
  const db = Database.deserialize(new Uint8Array(await (await game.get(`/saves/${id}/export`)).arrayBuffer()));
  db.run("UPDATE cover SET bytes = x'3c736376673e'");

  expect(() => saveStore(savesDir).import(db.serialize())).toThrow("isn't a valid Save");
});

test("regenerating a world replaces its cover and stops the unfinished one", async () => {
  const { aborted, payloads } = await withImages([generated, generated], new Promise<Uint8Array>(() => {}), png(2));
  const world = await newWorld();

  await game.post(`/worlds/${world}/regenerate`, choices);

  expect(payloads).toHaveLength(2);
  expect(aborted).toEqual([1]);
  expect(new Uint8Array(await (await game.get(`/worlds/${world}/cover`)).arrayBuffer())).toEqual(png(2));
});

test("a failed cover or images being off leaves a world and its Save with no cover", async () => {
  const { payloads } = await withImages([generated, generated], new Error("image model down"));

  const failed = await newWorld();
  expect((await game.get(`/worlds/${failed}/cover`)).status).toBe(404);

  await game.patch("/settings", { imagesEnabled: false });
  const off = await newWorld();
  expect((await game.get(`/worlds/${off}/cover`)).status).toBe(404);
  expect(payloads).toHaveLength(1);
});

test("the opening is a first Turn that asks for the whole picture, without showing the player a stored input", async () => {
  const script = scriptedTextProvider(narration("The rain never stops."));
  game = startGame(savesDir, script.textProvider);
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/opening`, {});

  expect(response.status).toBe(201);
  const { messages } = (await response.json()) as { messages: Parameters<typeof readable>[0] };
  expect(messages.map(({ role }) => role)).toEqual(["player", "narrator"]);
  expect(readable(messages).map(({ text }) => text)).toEqual(["The rain never stops."]);
  expect(script.prompts[0]![0]!.content).toContain("fully up to speed");
});

test("the opening rolls no Check, and can't overwrite a story already under way", async () => {
  const check = JSON.stringify({ check: { action: "Leap", difficulty: "Hard" }, narration: null, state_operations: [] });
  const script = scriptedTextProvider(check, narration("It begins."), narration("Next."));
  game = startGame(savesDir, script.textProvider, scriptedDice());
  const id = await game.createSave();

  expect((await game.post(`/saves/${id}/opening`, {})).status).toBe(201);
  expect(script.prompts).toHaveLength(2);
  expect((await game.post(`/saves/${id}/opening`, {})).status).toBe(409);
  expect(script.prompts).toHaveLength(2);
});

test("the opening can be Regenerated like any response, and a player's words are never hidden", async () => {
  const script = scriptedTextProvider(narration("First."), narration("Second."));
  game = startGame(savesDir, script.textProvider);
  const id = await game.createSave();
  await game.post(`/saves/${id}/opening`, {});

  const response = await game.post(`/saves/${id}/messages/2/regenerate`, {});

  expect(response.status).toBe(201);
  const all = saveStore(savesDir).messages(id);
  expect(readable(all).map(({ text }) => text)).toEqual(["Second."]);
  const later = [...all, { id: 9, role: "player" as const, text: OPENING_INPUT }];
  expect(readable(later).at(-1)!.text).toBe(OPENING_INPUT);
  expect(readable([{ id: 1, role: "player", text: "Hello." }])).toHaveLength(1);
});

test("Decide for me writes the PC's next move from what the player can read, and plays nothing", async () => {
  const script = scriptedTextProvider(generated, sheet, noConflict, narration("A boat drifts near."), JSON.stringify({ text: "I hail the boat." }));
  game = startGame(savesDir, script.textProvider);
  const world = await newWorld();
  const id = await begin(world);
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const response = await game.post(`/saves/${id}/decide`, {});

  expect(await response.json()).toEqual({ text: "I hail the boat." });
  const prompt = JSON.stringify(script.prompts.at(-1));
  expect(prompt).toContain("A boat drifts near.");
  expect(prompt).not.toContain(SECRET);
  expect(saveStore(savesDir).messages(id)).toHaveLength(2);
});

test("the theme is a stored setting that follows the device until the player picks one", async () => {
  game = startGame(savesDir, scriptedTextProvider().textProvider);
  const read = async () => ((await (await game.get("/settings")).json()) as { theme: string }).theme;

  expect(await read()).toBe("system");
  expect((await game.patch("/settings", { theme: "dark" })).status).toBe(200);
  await game.restart();
  expect(await read()).toBe("dark");
  expect((await game.patch("/settings", { theme: "sepia" })).status).toBe(400);
});

test("a Save from before the personality field went keeps it, and a new PC can't ask for one", async () => {
  const script = scriptedTextProvider(JSON.stringify({ name: "Ash", background: "B", physicalTraits: "T", skills: "S", other: "O", inventory: "I" }));
  game = startGame(savesDir, script.textProvider);
  const created = await game.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", personality: "Dry." } });
  const { id } = (await created.json()) as { id: string };
  expect(saveStore(savesDir).read(id).pc.personality).toBe("Dry.");

  const pc = { name: "", background: "", physicalTraits: "", skills: "", other: "", inventory: "" };
  expect((await game.post("/pc/pick", { ...choices, pc })).status).toBe(200);
  expect(JSON.stringify(script.prompts[0])).not.toContain("personality");
});
