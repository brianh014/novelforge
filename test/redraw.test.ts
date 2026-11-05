import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { saveStore } from "../src/save-store";
import { png, scriptedDice, scriptedImages, scriptedTextProvider, startGame, tempFolder } from "./support";

type Item = { kind: string; ref: number; label: string; prompt: string | null; redraws: number; redrawing: boolean; failure: string };
type Gallery = { images: Item[]; pending: boolean; canRedraw: boolean };

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;
let drawn: ReturnType<typeof scriptedImages>;
let savesDir: string;

const play = (replies: string[], ...imageReplies: Parameters<typeof scriptedImages>) => {
  drawn = scriptedImages(...imageReplies);
  game = startGame(savesDir, scriptedTextProvider(...replies).textProvider, scriptedDice(), 2, drawn.imageAdapter);
  return game.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });
};

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const turn = (visual_description: string, ...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations, scene_changed: true, visual_description });

const meet = (name: string) => ({ op: "add_npc", name, appearance: "Tall, in oilskins" });
const know = (name: string) => ({ op: "add_known_npc", name });
const scene = (location: string, ...visible_cast: string[]) => ({ op: "set_scene", location, visible_cast });

// Described, so that the PC gets a portrait, which takes the first image.
const newSave = async () => {
  const response = await game.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", physicalTraits: "Short" } });
  return ((await response.json()) as { id: string }).id;
};

const galleryOf = async (id: string) => (await game.get(`/saves/${id}/gallery`).then((r) => r.json())) as Gallery;

async function settled(id: string) {
  for (let tries = 0; tries < 200; tries++) {
    const gallery = await galleryOf(id);
    if (!gallery.pending) return gallery;
    await Bun.sleep(5);
  }
  throw new Error("The images never settled");
}

const playTurn = async (id: string) => {
  await game.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
  return settled(id);
};

const redraw = (id: string, { kind, ref }: Item, prompt: string) => game.post(`/saves/${id}/gallery/redraw`, { kind, ref, prompt });

const bytesOf = async (path: string) => new Uint8Array(await (await game.get(path)).arrayBuffer());

const find = (gallery: Gallery, kind: string) => gallery.images.find((item) => item.kind === kind)!;

test("the Gallery lists the PC, known NPCs and Scene Images with their prompts, and hides NPCs the PC doesn't know", async () => {
  await play(
    [turn("[Hesper] on a wet street", meet("Hesper"), meet("Stranger"), know("Hesper"), scene("The ferry", "Hesper", "Stranger"))],
    png(1),
    png(2),
    png(3),
    png(4),
  );
  const id = await newSave();
  const gallery = await playTurn(id);

  expect(gallery.canRedraw).toBe(true);
  expect(gallery.images.map(({ kind, label }) => [kind, label])).toEqual([
    ["portrait", "Ash"],
    ["portrait", "Hesper"],
    ["scene", "The ferry"],
  ]);
  expect(gallery.images[1]!.prompt).toContain("A head and shoulders portrait of one person, Tall, in oilskins, facing");
  expect(gallery.images[2]!.prompt).toBe("Tall, in oilskins on a wet street");
  expect(gallery.images.every(({ redraws, redrawing, failure }) => redraws === 0 && !redrawing && failure === "")).toBe(true);
});

test("redrawing a Scene Image replaces only it, with its shape, references and the current Art Style", async () => {
  await play(
    [turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper")), turn("[Hesper] and [Ash] on a dry street", scene("The ferry", "Hesper"))],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
  );
  const id = await newSave();
  await playTurn(id);
  const before = await playTurn(id);
  const state = await game.get(`/saves/${id}/journal`).then((r) => r.text());
  await game.patch(`/saves/${id}`, { artStyle: "Ink wash" });
  const newest = before.images.at(-1)!;

  expect((await redraw(id, newest, "A sunny street")).status).toBe(202);
  const after = await settled(id);

  const payload = drawn.payloads.at(-1)!;
  expect(payload.prompt).toBe("A sunny street");
  expect(payload.aspect_ratio).toBe("16:9");
  expect(payload.negative_prompt).toContain("dice");
  expect(payload.style_preset).toBe("Ink wash");
  expect(payload.reference_images.map(({ role }) => role)).toEqual(["npc", "previous_scene", "pc"]);
  expect(after.images.at(-1)).toMatchObject({ prompt: "A sunny street", redraws: 1 });
  expect(await bytesOf(`/saves/${id}/messages/${newest.ref}/image`)).toEqual(png(5));
  expect(await game.get(`/saves/${id}/journal`).then((r) => r.text())).toBe(state);
  expect(await game.get(`/saves/${id}/images`).then((r) => r.json())).toMatchObject({
    images: [{ redraws: 0 }, { messageId: newest.ref, redraws: 1 }],
    session: 5,
  });
});

test("a redrawn portrait is what later Scene Images use, while the NPC's stored looks stay", async () => {
  await play(
    [turn("A wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper")), turn("[Hesper] on a pier", scene("The pier", "Hesper"))],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
  );
  const id = await newSave();
  const before = await playTurn(id);
  const hesper = before.images.find(({ label }) => label === "Hesper")!;

  await redraw(id, hesper, "A red-haired woman");
  const after = await settled(id);
  await playTurn(id);

  expect(after.images.find(({ label }) => label === "Hesper")).toMatchObject({ prompt: "A red-haired woman", redraws: 1 });
  expect(drawn.payloads.find(({ prompt }) => prompt === "A red-haired woman")).toMatchObject({ aspect_ratio: "1:1", reference_images: [] });
  expect(drawn.payloads.at(-1)!.reference_images[0]).toMatchObject({ role: "npc", bytes: png(4) });
  expect(drawn.payloads.at(-1)!.prompt).toContain("Tall, in oilskins");
});

test("a failed Redraw keeps the image and prompt and says why, until the next one", async () => {
  await play([turn("A wet street", scene("The ferry"))], png(1), png(2), new Error("The model is busy"), png(3));
  const id = await newSave();
  const item = find(await playTurn(id), "scene");

  await redraw(id, item, "A sunny street");
  const failed = find(await settled(id), "scene");

  expect(failed).toMatchObject({ prompt: "A wet street", redraws: 0, failure: "The model is busy" });
  expect(await bytesOf(`/saves/${id}/messages/${item.ref}/image`)).toEqual(png(2));

  await redraw(id, item, "A sunny street");
  expect(find(await settled(id), "scene")).toMatchObject({ prompt: "A sunny street", redraws: 1, failure: "" });
});

test("a Redraw is refused for a hidden NPC, an empty prompt, a second request, or images being off", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("A wet street", meet("Stranger"), scene("The ferry", "Stranger"))], png(1), png(2), png(3), slow);
  const id = await newSave();
  const gallery = await playTurn(id);
  const item = find(gallery, "scene");
  const hidden = saveStore(savesDir).portraits(id).find(({ npc }) => npc === "Stranger")!;

  expect((await redraw(id, { ...item, kind: "portrait", ref: hidden.id }, "Spy")).status).toBe(404);
  expect((await redraw(id, item, "   ")).status).toBe(400);
  expect((await redraw(id, item, "One")).status).toBe(202);
  expect(find(await galleryOf(id), "scene").redrawing).toBe(true);
  expect((await redraw(id, item, "Two")).status).toBe(409);
  finish(png(4));
  await settled(id);

  await game.patch("/settings", { imagesEnabled: false });
  expect((await galleryOf(id)).canRedraw).toBe(false);
  expect((await redraw(id, item, "Three")).status).toBe(409);
  expect(drawn.payloads.filter(({ prompt }) => prompt === "Three")).toEqual([]);
});

test("a newer Scene Image never drops a queued Redraw", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("A wet street", scene("The ferry")), turn("A pier", scene("The pier"))], png(1), png(2), slow, png(4), png(5));
  const id = await newSave();
  const item = find(await playTurn(id), "scene");
  const portrait = find(await galleryOf(id), "portrait");

  await redraw(id, portrait, "First");
  await redraw(id, item, "Second");
  await game.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
  finish(png(3));
  await settled(id);

  expect(drawn.payloads.map(({ prompt }) => prompt).slice(2)).toEqual(["First", "Second", "A pier"]);
});

test("a Revert past a Scene Image stops its Redraw, and a replaced Turn loses it", async () => {
  await play(
    [turn("A wet street", scene("The ferry")), turn("A pier", scene("The pier"))],
    png(1),
    png(2),
    png(3),
    new Promise<Uint8Array>(() => {}),
  );
  const id = await newSave();
  const first = find(await playTurn(id), "scene");
  const second = (await playTurn(id)).images.at(-1)!;

  await redraw(id, second, "Lost");
  await game.post(`/saves/${id}/messages/${first.ref}/revert`, {});
  const gallery = await settled(id);

  expect(drawn.aborted.length).toBe(1);
  expect(gallery.images.filter(({ kind }) => kind === "scene").map(({ ref }) => ref)).toEqual([first.ref]);
  expect(gallery.images.every(({ failure }) => failure === "")).toBe(true);
});

test("older images have no prompt, can be given one, and import still checks the column", async () => {
  await play([turn("A wet street", scene("The ferry"))], png(1), png(2), png(3));
  const id = await newSave();
  await playTurn(id);
  const exported = await bytesOf(`/saves/${id}/export`);
  const path = join(folder.path, "edited.sqlite");
  await Bun.write(path, exported);

  const db = new Database(path);
  db.run("UPDATE scene_images SET prompt = NULL");
  db.close();
  const send = async () =>
    fetch(game.url("/saves/import"), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await Bun.file(path).arrayBuffer(),
    });
  const { id: imported } = (await (await send()).json()) as { id: string };
  const old = find(await galleryOf(imported), "scene");
  expect(old.prompt).toBeNull();
  await redraw(imported, old, "Typed in");
  expect(find(await settled(imported), "scene").prompt).toBe("Typed in");

  const bad = new Database(path);
  bad.run("UPDATE scene_images SET prompt = x'00'");
  bad.close();
  expect((await send()).status).toBe(422);
});

const generated = JSON.stringify({
  world_overview: "Rain never stops in Saltmere.",
  lore_entries: [{ title: "Magic", keywords: ["magic", "spell", "sorcery"], content: "Magic is real." }],
  world_rules: ["A rule."],
  plot_threads: ["A thread."],
});
const sheet = JSON.stringify({ wearing: [], health: "unhurt", injuries: [], conditions: [] });
const noConflict = JSON.stringify({ world_update: null });
const choices = { title: "The Salt Reckoning", theme: "Western", worldBrief: "A drowned city", startingHook: "", artStyle: "Ink wash" };

const newWorld = async () => ((await (await game.post("/worlds", choices)).json()) as { id: string }).id;
const coverOf = async (world: string) =>
  (await game.get(`/worlds/${world}/cover/details`).then((r) => r.json())) as { prompt: string; hasCover: boolean; failure: string; canRedraw: boolean };
const accept = async (worldId: string) => {
  const response = await game.post("/saves", { worldId, worldBrief: "A drowned city", startingHook: "", pc: { name: "Ash" }, inventory: [] });
  return ((await response.json()) as { id: string }).id;
};
const storedCover = async (id: string) => {
  for (let tries = 0; tries < 50; tries++) {
    if (saveStore(savesDir).read(id).hasCover) return;
    await Bun.sleep(5);
  }
  throw new Error("The cover never landed");
};

test("a world's cover can be redrawn from an edited prompt, which goes into the Save", async () => {
  await play([generated, sheet, noConflict], png(1), png(2), png(3));
  const world = await newWorld();

  const details = await coverOf(world);
  expect(details).toMatchObject({ hasCover: true, failure: "", canRedraw: true });
  expect(details.prompt).toContain("Rain never stops in Saltmere.");

  expect((await game.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" })).status).toBe(200);
  expect(drawn.payloads[1]).toMatchObject({ prompt: "A lighthouse", aspect_ratio: "2:3", style_preset: "Ink wash", reference_images: [] });
  expect(await bytesOf(`/worlds/${world}/cover`)).toEqual(png(2));

  const id = await accept(world);
  await storedCover(id);
  const gallery = await settled(id);
  expect(gallery.images[0]).toMatchObject({ kind: "cover", label: "Cover", prompt: "A lighthouse" });

  await redraw(id, gallery.images[0]!, "A storm");
  expect(await settled(id).then((after) => after.images[0])).toMatchObject({ prompt: "A storm", redraws: 1 });
  expect(saveStore(savesDir).read(id)).toMatchObject({ coverRedraws: 1 });
});

test("a failed cover keeps its prompt for a retry, and a failed Redraw keeps the old cover", async () => {
  await play([generated], new Error("The model is busy"), png(1), new Error("Still busy"));
  const world = await newWorld();

  expect(await coverOf(world)).toMatchObject({ hasCover: false, failure: "The model is busy" });
  expect((await game.post(`/worlds/${world}/cover`, { prompt: (await coverOf(world)).prompt })).status).toBe(200);
  expect(await coverOf(world)).toMatchObject({ hasCover: true, failure: "" });

  const failed = await game.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "Still busy" });
  expect(await bytesOf(`/worlds/${world}/cover`)).toEqual(png(1));
  expect((await coverOf(world)).prompt).not.toBe("A lighthouse");
});

test("Accept during a Cover Redraw takes the result, or the old cover if it fails", async () => {
  let fail = (_: Error) => {};
  const failing = new Promise<never>((_, reject) => (fail = reject));
  await play([generated, sheet, noConflict], png(1), failing, png(9));
  const world = await newWorld();
  const details = await coverOf(world);

  const redrawing = game.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });
  await Bun.sleep(5);
  const id = await accept(world);
  fail(new Error("Too late"));
  await redrawing;
  await storedCover(id);

  expect(await bytesOf(`/saves/${id}/cover`)).toEqual(png(1));
  expect((await settled(id)).images[0]!.prompt).toBe(details.prompt);
});

test("a cover Redraw is refused with images off, and a world with no cover drawn has nothing to retry", async () => {
  await play([generated], png(1));
  await game.patch("/settings", { imagesEnabled: false });
  const world = await newWorld();

  expect(await coverOf(world)).toMatchObject({ hasCover: false, failure: "", canRedraw: false });
  expect((await game.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" })).status).toBe(409);
  expect((await game.post(`/worlds/nowhere/cover`, { prompt: "A lighthouse" })).status).toBe(404);
});

test("regenerating a world replaces a cover's edited prompt", async () => {
  await play([generated, generated], png(1), png(2), png(3));
  const world = await newWorld();
  await game.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });

  await game.post(`/worlds/${world}/regenerate`, choices);

  expect((await coverOf(world)).prompt).toContain("Rain never stops in Saltmere.");
});
