import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { COVER_FROM_PORTRAITS } from "../src/image-pipeline";
import { saveStore } from "../src/save-store";
import type { PictureAsk } from "../src/world-creation";
import { png, scriptedDice, scriptedImages, scriptedTextProvider, startApp, tempFolder } from "./support";

type Item = { kind: string; ref: number; label: string; prompt: string | null; redraws: number; redrawing: boolean; failure: string };
type Gallery = { images: Item[]; pending: boolean; canRedraw: boolean };

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
let drawn: ReturnType<typeof scriptedImages>;
let savesDir: string;
let asks: PictureAsk[];

const play = (replies: string[], ...imageReplies: Parameters<typeof scriptedImages>) => {
  drawn = scriptedImages(...imageReplies);
  asks = [];
  app = startApp(savesDir, scriptedTextProvider(...replies).textProvider, scriptedDice(), 2, drawn.imageAdapter, async (ask, _style, template) => (asks.push(ask), template));
  return app.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });
};

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await app.stop();
  folder.remove();
});

const turn = (visual_description: string, ...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations, scene_changed: true, visual_description });

const meet = (name: string) => ({ op: "add_npc", name, appearance: "Tall, in oilskins" });
const know = (name: string) => ({ op: "add_known_npc", name });
const scene = (location: string, ...visible_cast: string[]) => ({ op: "set_scene", location, visible_cast });

// Described, so that the PC gets a portrait, which takes the first image.
const newSave = async () => {
  const response = await app.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", physicalTraits: "Short" } });
  return ((await response.json()) as { id: string }).id;
};

const galleryOf = async (id: string) => (await app.get(`/saves/${id}/gallery`).then((r) => r.json())) as Gallery;

async function settled(id: string) {
  for (let tries = 0; tries < 200; tries++) {
    const gallery = await galleryOf(id);
    if (!gallery.pending) return gallery;
    await Bun.sleep(5);
  }
  throw new Error("The images never settled");
}

const playTurn = async (id: string) => {
  await app.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
  return settled(id);
};

const redraw = (id: string, { kind, ref }: Item, prompt: string) => app.post(`/saves/${id}/gallery/redraw`, { kind, ref, prompt });

const bytesOf = async (path: string) => new Uint8Array(await (await app.get(path)).arrayBuffer());

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

test("redrawing a Scene Image replaces only it, with its shape and references, drawing its prompt as written", async () => {
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
  const state = await app.get(`/saves/${id}/journal`).then((r) => r.text());
  await app.patch(`/saves/${id}`, { artStyle: "Ink wash" });
  const newest = find(before, "scene");

  expect((await redraw(id, newest, "A sunny street")).status).toBe(202);
  const after = await settled(id);

  const payload = drawn.payloads.at(-1)!;
  expect(payload.prompt).toStartWith("A sunny street");
  expect(payload.aspect_ratio).toBe("16:9");
  expect(payload.negative_prompt).toContain("dice");
  // A Redraw draws the prompt exactly as the player left it, as it holds its own Art Style.
  expect(payload.style_preset).toBe("");
  expect(payload.reference_images.map(({ role }) => role)).toEqual(["pc", "npc"]);
  expect(find(after, "scene")).toMatchObject({ prompt: "A sunny street", redraws: 1 });
  expect(await bytesOf(`/saves/${id}/messages/${newest.ref}/image`)).toEqual(png(5));
  expect(await app.get(`/saves/${id}/journal`).then((r) => r.text())).toBe(state);
  expect(await app.get(`/saves/${id}/images`).then((r) => r.json())).toMatchObject({
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

  await app.patch("/settings", { imagesEnabled: false });
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
  await app.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
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
  const second = find(await playTurn(id), "scene");

  await redraw(id, second, "Lost");
  await app.post(`/saves/${id}/messages/${first.ref}/revert`, {});
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
    fetch(app.url("/saves/import"), {
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
    calendar: "Days run in weeks of seven under the Tide Reckoning.",
    start_date: "3rd of Lowtide",
    start_time_of_day: "dusk",
  lore_entries: [{ title: "Magic", keywords: ["magic", "spell", "sorcery"], content: "Magic is real." }],
  world_rules: ["A rule."],
  plot_threads: ["A thread."],
});
const sheet = JSON.stringify({ wearing: [], health: "unhurt", injuries: [], conditions: [] });
const choices = { title: "The Salt Reckoning", theme: "Western", worldBrief: "A drowned city", startingHook: "", artStyle: "Ink wash", pc: { name: "Ash" } };

const newWorld = async () => ((await (await app.post("/worlds", choices)).json()) as { id: string }).id;
const coverOf = async (world: string) =>
  (await app.get(`/worlds/${world}/cover/details`).then((r) => r.json())) as { prompt: string; hasImage: boolean; failure: string; canRedraw: boolean };
const accept = async (worldId: string) => {
  const response = await app.post(`/worlds/${worldId}/begin`, { artStyle: choices.artStyle });
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
  await play([sheet, generated], png(1), png(2), png(3));
  const world = await newWorld();

  const details = await coverOf(world);
  expect(details).toMatchObject({ hasImage: true, failure: "", canRedraw: true });
  expect(details.prompt).toContain("Rain never stops in Saltmere.");

  expect((await app.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" })).status).toBe(200);
  expect(drawn.payloads[1]).toMatchObject({ prompt: "A lighthouse", aspect_ratio: "2:3", style_preset: "", reference_images: [] });
  expect(await bytesOf(`/worlds/${world}/cover`)).toEqual(png(2));

  const id = await accept(world);
  await storedCover(id);
  const gallery = await settled(id);
  expect(gallery.images[0]).toMatchObject({ kind: "cover", label: "Cover", prompt: "A lighthouse" });

  await redraw(id, gallery.images[0]!, "A storm");
  expect(await settled(id).then((after) => after.images[0])).toMatchObject({ prompt: "A storm", redraws: 1 });
  expect(saveStore(savesDir).read(id)).toMatchObject({ coverRedraws: 1 });
});

test("a Cover Redraw in the story draws the PC from their portrait, as the first Cover did", async () => {
  await play([sheet, generated], png(1), png(2), png(3));
  const world = ((await (await app.post("/worlds", { ...choices, pc: { name: "Ash", physicalTraits: "Short" } })).json()) as { id: string }).id;
  await coverOf(world);
  const id = await accept(world);
  await storedCover(id);
  const gallery = await settled(id);

  await redraw(id, gallery.images.find(({ kind }) => kind === "cover")!, "A storm");
  await settled(id);

  expect(drawn.payloads[1]!.reference_images.map(({ role, bytes }) => [role, bytes])).toEqual([["pc", png(1)]]);
  expect(drawn.payloads[2]).toMatchObject({ prompt: `${COVER_FROM_PORTRAITS}
A storm`, aspect_ratio: "2:3" });
  expect(drawn.payloads[2]!.reference_images.map(({ role, bytes }) => [role, bytes])).toEqual([["pc", png(1)]]);
});

const update = (id: string, { kind, ref }: Item) => app.post(`/saves/${id}/gallery/update`, { kind, ref });

test("Update draws a portrait again as an edit of its first image, from the person's looks now, keeping their face, and only for a Cover or portrait", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper"))], png(1), png(2), png(3), png(4));
  const id = await newSave();
  const before = await playTurn(id);
  const hesper = before.images.find(({ label }) => label === "Hesper")!;

  expect((await update(id, hesper)).status).toBe(202);
  const after = await settled(id);

  expect(drawn.payloads.at(-1)).toMatchObject({ aspect_ratio: "1:1" });
  expect(drawn.payloads.at(-1)!.prompt).toContain("Tall, in oilskins");
  expect(drawn.payloads.at(-1)!.prompt).not.toContain("The portraits show only");
  expect(asks.at(-1)).toMatchObject({ kind: "portrait", looks: "Tall, in oilskins", was: hesper.prompt });
  expect(drawn.payloads.at(-1)!.reference_images.map(({ role }) => role)).toEqual(["npc"]);
  expect(after.images.find(({ label }) => label === "Hesper")!.prompt).not.toContain("The portraits show only");
  expect(after.images.find(({ label }) => label === "Hesper")).toMatchObject({ redraws: 1 });
  expect((await update(id, find(before, "scene"))).status).toBe(400);
});

test("a replaced portrait keeps its first image as the original, which every Update takes the face from and which can be edited too", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper"))], png(1), png(2), png(3), png(4), png(5), png(6));
  const id = await newSave();
  const before = await playTurn(id);
  const hesper = before.images.find(({ kind, label }) => kind === "portrait" && label === "Hesper")!;
  const first = await bytesOf(`/saves/${id}/portraits/${hesper.ref}`);
  expect(before.images.some(({ kind }) => kind === "original")).toBe(false);
  expect((await app.get(`/saves/${id}/portraits/${hesper.ref}/original`)).status).toBe(404);

  await update(id, hesper);
  const once = await settled(id);
  await update(id, hesper);
  const twice = await settled(id);

  expect(drawn.payloads.at(-1)!.reference_images.map(({ bytes }) => bytes)).toEqual([first]);
  expect(await bytesOf(`/saves/${id}/portraits/${hesper.ref}`)).not.toEqual(first);
  expect(await bytesOf(`/saves/${id}/portraits/${hesper.ref}/original`)).toEqual(first);
  const original = twice.images.find(({ kind }) => kind === "original")!;
  expect(original).toMatchObject({ ref: hesper.ref, label: "Hesper", redraws: 0 });
  expect(once.images.filter(({ kind }) => kind === "original")).toHaveLength(1);

  expect((await redraw(id, original, "A new face")).status).toBe(202);
  await settled(id);
  const redrawn = await bytesOf(`/saves/${id}/portraits/${hesper.ref}/original`);
  expect(redrawn).not.toEqual(first);
  await update(id, hesper);
  await settled(id);
  expect(drawn.payloads.at(-1)!.reference_images.map(({ bytes }) => bytes)).toEqual([redrawn]);
});

test("Update works the player's nudge into a portrait's new prompt", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper"))], png(1), png(2), png(3), png(4));
  const id = await newSave();
  const hesper = (await playTurn(id)).images.find(({ label }) => label === "Hesper")!;

  expect((await app.post(`/saves/${id}/gallery/update`, { kind: hesper.kind, ref: hesper.ref, nudge: "smiling" })).status).toBe(202);
  await settled(id);

  expect(drawn.payloads.at(-1)!.prompt).toContain("smiling");
  expect((await app.post(`/saves/${id}/gallery/update`, { kind: hesper.kind, ref: hesper.ref, nudge: "x".repeat(201) })).status).toBe(400);
});

test("Update draws the Cover again from the title, the World Brief and the PC as they are now, with the PC's portrait", async () => {
  await play([sheet, generated], png(1), png(2), png(3));
  const world = ((await (await app.post("/worlds", { ...choices, pc: { name: "Ash", physicalTraits: "Short" } })).json()) as { id: string }).id;
  await coverOf(world);
  const id = await accept(world);
  await storedCover(id);
  const cover = (await settled(id)).images.find(({ kind }) => kind === "cover")!;

  expect((await update(id, cover)).status).toBe(202);
  await settled(id);

  const payload = drawn.payloads[2]!;
  expect(payload.prompt).toContain(JSON.stringify(choices.title));
  expect(payload.prompt).toContain("A drowned city");
  expect(payload.prompt).toContain("Short");
  expect(payload.reference_images.map(({ role }) => role)).toEqual(["pc"]);
});

test("a failed cover keeps its prompt for a retry, and a failed Redraw keeps the old cover", async () => {
  await play([sheet, generated], new Error("The model is busy"), png(1), new Error("Still busy"));
  const world = await newWorld();

  expect(await coverOf(world)).toMatchObject({ hasImage: false, failure: "The model is busy" });
  expect((await app.post(`/worlds/${world}/cover`, { prompt: (await coverOf(world)).prompt })).status).toBe(200);
  expect(await coverOf(world)).toMatchObject({ hasImage: true, failure: "" });

  const failed = await app.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "Still busy" });
  expect(await bytesOf(`/worlds/${world}/cover`)).toEqual(png(1));
  expect((await coverOf(world)).prompt).not.toBe("A lighthouse");
});

test("Accept during a Cover Redraw takes the result, or the old cover if it fails", async () => {
  let fail = (_: Error) => {};
  const failing = new Promise<never>((_, reject) => (fail = reject));
  await play([sheet, generated], png(1), failing, png(9));
  const world = await newWorld();
  const details = await coverOf(world);

  const redrawing = app.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });
  await Bun.sleep(5);
  const id = await accept(world);
  fail(new Error("Too late"));
  await redrawing;
  await storedCover(id);

  expect(await bytesOf(`/saves/${id}/cover`)).toEqual(png(1));
  expect((await settled(id)).images[0]!.prompt).toBe(details.prompt);
});

test("a cover Redraw is refused with images off, and a world with no cover drawn has nothing to retry", async () => {
  await play([sheet, generated], png(1));
  await app.patch("/settings", { imagesEnabled: false });
  const world = await newWorld();

  expect(await coverOf(world)).toMatchObject({ hasImage: false, failure: "", canRedraw: false });
  expect((await app.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" })).status).toBe(409);
  expect((await app.post(`/worlds/nowhere/cover`, { prompt: "A lighthouse" })).status).toBe(404);
});

test("regenerating a world keeps a cover's edited prompt", async () => {
  await play([sheet, generated, generated], png(1), png(2));
  const world = await newWorld();
  await app.post(`/worlds/${world}/cover`, { prompt: "A lighthouse" });

  await app.post(`/worlds/${world}/regenerate`, choices);

  expect((await coverOf(world)).prompt).toBe("A lighthouse");
});

const looksAgain = (name: string) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations: [{ op: "update_npc", name, appearance: "Tall, soaked, a fresh scar across one cheek" }], scene_changed: false, visual_description: "" });

test("with Update portraits on, a Turn that changes someone's looks draws their portrait again, keeping the face", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper")), looksAgain("Hesper")], png(1), png(2), png(3), png(4));
  await app.patch("/settings", { updatePortraits: true });
  const id = await newSave();
  const before = (await playTurn(id)).images.find(({ label }) => label === "Hesper")!;

  const after = (await playTurn(id)).images.find(({ label }) => label === "Hesper")!;

  expect(after.redraws).toBe(before.redraws + 1);
  expect(drawn.payloads.at(-1)!.prompt).toContain("a fresh scar across one cheek");
  expect(drawn.payloads.at(-1)!.reference_images.map(({ role }) => role)).toEqual(["npc"]);
});

test("Update portraits is off by default, and so is anything drawn for new looks", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper")), looksAgain("Hesper")], png(1), png(2), png(3));
  const id = await newSave();
  await playTurn(id);
  const drawnBefore = drawn.payloads.length;

  const after = (await playTurn(id)).images.find(({ label }) => label === "Hesper")!;

  expect(after.redraws).toBe(0);
  expect(drawn.payloads).toHaveLength(drawnBefore);
});

const quiet = (...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations, scene_changed: false, visual_description: "" });
const pcLooksNow = (appearance: string, ...more: object[]) => quiet({ op: "set_pc_appearance", appearance }, ...more);

test("with Update portraits on, a Turn that changes the PC's looks draws their portrait again from the new looks", async () => {
  await play([turn("A wet street", scene("The ferry")), pcLooksNow("Short, hair shorn close, a scar on the chin")], png(1), png(2), png(3));
  await app.patch("/settings", { updatePortraits: true });
  const id = await newSave();
  const before = find(await playTurn(id), "portrait");

  const after = find(await playTurn(id), "portrait");

  expect(after.redraws).toBe(before.redraws + 1);
  expect(drawn.payloads.at(-1)!.prompt).toContain("hair shorn close");
  expect(drawn.payloads.at(-1)!.reference_images.map(({ role }) => role)).toEqual(["pc"]);
});

test("a PC with no looks gets a portrait once the story gives them some and the Scene moves", async () => {
  await play([turn("A wet street", scene("The ferry")), pcLooksNow("Tall and wiry, with red hair", scene("The quay"))], png(1), png(2));
  const id = ((await (await app.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash" } })).json()) as { id: string }).id;
  expect((await playTurn(id)).images.some(({ kind }) => kind === "portrait")).toBe(false);

  const gallery = await playTurn(id);

  expect(find(gallery, "portrait")).toMatchObject({ label: "Ash" });
  expect(drawn.payloads.at(-1)!.prompt).toContain("Tall and wiry, with red hair");
});

test("a failed portrait update is tried again when the Scene next moves", async () => {
  await play(
    [turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper")), looksAgain("Hesper"), quiet(scene("The quay", "Hesper"))],
    png(1),
    png(2),
    png(3),
    new Error("The model is busy"),
    png(4),
  );
  await app.patch("/settings", { updatePortraits: true });
  const id = await newSave();
  await playTurn(id);
  const failed = (await playTurn(id)).images.find(({ kind, label }) => kind === "portrait" && label === "Hesper")!;
  expect(failed).toMatchObject({ redraws: 0 });
  expect(failed.failure).not.toBe("");

  const retried = (await playTurn(id)).images.find(({ kind, label }) => kind === "portrait" && label === "Hesper")!;

  expect(retried).toMatchObject({ redraws: 1, failure: "" });
  expect(drawn.payloads.at(-1)!.prompt).toContain("a fresh scar across one cheek");
});

test("with Update portraits on, a World Change to the PC's looks draws their portrait again", async () => {
  const worldChange = JSON.stringify({ lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [], world_brief: null, summary: null, facts: [], npc_summaries: [], pc_looks: "Short, with a tattooed neck" });
  await play([turn("A wet street", scene("The ferry")), worldChange], png(1), png(2), png(3));
  await app.patch("/settings", { updatePortraits: true });
  const id = await newSave();
  await playTurn(id);

  expect((await app.post(`/saves/${id}/world-change`, { change: "Ash has a neck tattoo" })).status).toBe(200);

  expect(find(await settled(id), "portrait")).toMatchObject({ redraws: 1 });
  expect(drawn.payloads.at(-1)!.prompt).toContain("a tattooed neck");
});

test("with Draw scene pictures off, a Turn draws portraits but no Scene Image", async () => {
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper"))], png(1), png(2), png(3));
  await app.patch("/settings", { drawScenes: false });
  const id = await newSave();

  const gallery = await playTurn(id);

  expect(gallery.images.map(({ kind }) => kind).toSorted()).toEqual(["portrait", "portrait"]);
  expect(drawn.payloads.every(({ aspect_ratio }) => aspect_ratio === "1:1")).toBe(true);
});

test("while pictures draw, the story is told what kind is drawing and how many wait, but never whose", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("[Hesper] on a wet street", meet("Hesper"), know("Hesper"), scene("The ferry", "Hesper"))], slow, png(2), png(3));
  const id = await newSave();
  await app.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());

  const drawing = await app.get(`/saves/${id}/images`).then((r) => r.json());

  // The PC's portrait, then a check for it on the move that draws nothing as it exists, Hesper's portrait and the scene.
  expect(drawing).toMatchObject({ pending: true, drawing: "portrait", more: 3 });
  expect(JSON.stringify(drawing)).not.toContain("Hesper");
  finish(png(1));
  expect(await settled(id)).not.toHaveProperty("drawing");
});
