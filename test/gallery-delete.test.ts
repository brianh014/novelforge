import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { PNG, png, scriptedDice, scriptedImages, scriptedTextProvider, startApp, tempFolder } from "./support";

type Item = { kind: string; ref: number; label: string; redrawing: boolean };
type Gallery = { images: Item[]; pending: boolean };

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
let drawn: ReturnType<typeof scriptedImages>;
let savesDir: string;

const play = (replies: string[], ...imageReplies: Parameters<typeof scriptedImages>) => {
  drawn = scriptedImages(...imageReplies);
  app = startApp(savesDir, scriptedTextProvider(...replies).textProvider, scriptedDice(), 2, drawn.imageAdapter);
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
const written = (text: string) => JSON.stringify({ text });

const meet = (name: string) => ({ op: "add_npc", name, appearance: "Tall, in oilskins" });
const know = (name: string) => ({ op: "add_known_npc", name });
const scene = (location: string, ...visible_cast: string[]) => ({ op: "set_scene", location, visible_cast });

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

const send = (id: string) => app.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
const playTurn = async (id: string) => {
  await send(id);
  return settled(id);
};
const asked = async (id: string, words: string) => {
  await app.post(`/saves/${id}/requested-images`, { words });
  return settled(id);
};

const remove = (id: string, { kind, ref }: { kind: unknown; ref: unknown }) => app.post(`/saves/${id}/gallery/delete`, { kind, ref });
const redraw = (id: string, { kind, ref }: Item, prompt: string) => app.post(`/saves/${id}/gallery/redraw`, { kind, ref, prompt });
const labels = (gallery: Gallery) => gallery.images.filter(({ kind }) => kind !== "original").map(({ label }) => label);
const find = (gallery: Gallery, label: string) => gallery.images.find((item) => item.label === label)!;

test("the Gallery goes Cover, the PC, NPCs newest first, then Scenes newest first", async () => {
  await play(
    [
      turn("A wet street", meet("Bram"), know("Bram"), scene("The ferry", "Bram")),
      turn("A pier", meet("Cleo"), meet("Dov"), know("Cleo"), know("Dov"), scene("The pier", "Cleo", "Dov")),
    ],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
    png(6),
  );
  const id = await newSave();
  await playTurn(id);
  const { images } = await playTurn(id);

  // The Message each portrait goes by puts Cleo and Dov first, and a later portrait of the same Message is the newer.
  expect(images.map(({ label }) => label)).toEqual(["Ash", "Dov", "Cleo", "Bram", "The pier", "The ferry"]);
});

test("a Message's images sort newest first too, and a Redraw moves none of them", async () => {
  await play(
    [turn("A wet street", meet("Bram"), know("Bram"), scene("The ferry", "Bram")), written("One"), written("Two"), turn("A pier", scene("The pier")), written("Three")],
    ...Array.from({ length: 11 }, (_, mark) => png(mark)),
  );
  const id = await newSave();
  await playTurn(id);
  await asked(id, "first");
  await asked(id, "second");
  await playTurn(id);
  const gallery = await asked(id, "third");
  const order = ["Ash", "Bram", "third", "The pier", "second", "first", "The ferry"];
  expect(labels(gallery)).toEqual(order);

  for (const label of ["The ferry", "first", "Bram", "Ash"]) {
    expect((await redraw(id, find(await galleryOf(id), label), "Again")).status).toBe(202);
    await settled(id);
  }

  expect(labels(await galleryOf(id))).toEqual(order);
});

test("deleting a Scene Image takes only the image, and leaves its Message and Snapshot", async () => {
  await play([turn("A wet street", scene("The ferry")), turn("A pier", scene("The pier"))], png(1), png(2), png(3));
  const id = await newSave();
  const gallery = await playTurn(id);
  await playTurn(id);
  const messages = await app.get(`/saves/${id}/messages`).then((r) => r.text());
  const snapshot = await app.get(`/saves/${id}/messages/2/snapshot`).then((r) => r.text());
  const journal = (await app.get(`/saves/${id}/journal`).then((r) => r.json())) as { fullLog: unknown };

  expect((await remove(id, find(gallery, "The ferry"))).status).toBe(200);

  expect(labels(await galleryOf(id))).toEqual(["Ash", "The pier"]);
  expect(await app.get(`/saves/${id}/images`).then((r) => r.json())).toMatchObject({ images: [{ messageId: 4 }] });
  expect((await app.get(`/saves/${id}/messages/2/image`)).status).toBe(404);
  expect(await app.get(`/saves/${id}/messages`).then((r) => r.text())).toBe(messages);
  expect(await app.get(`/saves/${id}/messages/2/snapshot`).then((r) => r.text())).toBe(snapshot);
  expect(await app.get(`/saves/${id}/journal`).then((r) => r.json())).toMatchObject({ fullLog: journal.fullLog });
});

test("deleting a Requested Image leaves the other images of its Message", async () => {
  await play([turn("A wet street", scene("The ferry")), written("One"), written("Two")], png(1), png(2), png(3), png(4));
  const id = await newSave();
  await playTurn(id);
  await asked(id, "first");
  const gallery = await asked(id, "second");
  const { ref } = find(gallery, "first");

  expect((await remove(id, { kind: "requested", ref })).status).toBe(200);

  expect(labels(await galleryOf(id))).toEqual(["Ash", "second", "The ferry"]);
  expect((await app.get(`/saves/${id}/requested-images/${ref}/image`)).status).toBe(404);
  expect(await app.get(`/saves/${id}/requested-images`).then((r) => r.json())).toMatchObject({ images: [{ caption: "second" }] });
});

test("the Cover and portraits can't be deleted, whatever is sent", async () => {
  await play([turn("A wet street", meet("Bram"), know("Bram"), scene("The ferry", "Bram"))], png(1), png(2), png(3));
  const id = await newSave();
  const gallery = await playTurn(id);
  const before = labels(gallery);
  const pc = find(gallery, "Ash");
  const npc = find(gallery, "Bram");

  for (const kind of ["cover", "portrait", "PORTRAIT", "portraits", "", null, 1, ["portrait"], { kind: "scene" }]) {
    for (const ref of [1, pc.ref, npc.ref]) expect((await remove(id, { kind, ref })).status).toBe(400);
  }
  expect((await remove(id, { kind: "scene", ref: "2" })).status).toBe(400);
  expect((await remove(id, { kind: "scene", ref: -1 })).status).toBe(400);

  expect(labels(await galleryOf(id))).toEqual(before);
  expect((await app.get(`/saves/${id}/portraits/${pc.ref}`)).status).toBe(200);
  expect((await app.get(`/saves/${id}/portraits/${npc.ref}`)).status).toBe(200);
});

test("deleting what isn't there says so", async () => {
  await play([turn("A wet street", scene("The ferry"))], png(1), png(2));
  const id = await newSave();
  const item = find(await playTurn(id), "The ferry");

  expect((await remove(id, { kind: "scene", ref: 999 })).status).toBe(404);
  expect((await remove(id, { kind: "requested", ref: 1 })).status).toBe(404);
  expect((await remove("no-such-save", item)).status).toBe(404);
  await remove(id, item);
  expect((await remove(id, item)).status).toBe(404);
});

test("an image being Redrawn can't be deleted, running or queued, and can be once that's done", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("A wet street", scene("The ferry")), written("One")], png(1), png(2), png(3), slow, png(5));
  const id = await newSave();
  await playTurn(id);
  const gallery = await asked(id, "first");
  const running = find(gallery, "first");
  const queued = find(gallery, "The ferry");

  await redraw(id, running, "Running");
  await redraw(id, queued, "Queued");

  expect((await remove(id, running)).status).toBe(409);
  expect((await remove(id, queued)).status).toBe(409);
  expect(labels(await galleryOf(id))).toEqual(["Ash", "first", "The ferry"]);

  finish(png(4));
  await settled(id);
  expect((await remove(id, running)).status).toBe(200);
  expect((await remove(id, queued)).status).toBe(200);
  expect(labels(await galleryOf(id))).toEqual(["Ash"]);
});

test("a deleted image can't be Redrawn, and a later one still can", async () => {
  await play(
    [turn("One", scene("The ferry")), turn("Two", scene("The ferry")), turn("Three", scene("The ferry"))],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
  );
  const id = await newSave();
  await playTurn(id);
  await playTurn(id);
  const { images } = await playTurn(id);
  const [latest, middle] = images.filter(({ kind }) => kind === "scene");

  await remove(id, middle!);

  expect((await redraw(id, middle!, "Gone")).status).toBe(404);
  expect((await redraw(id, latest!, "Again")).status).toBe(202);
  await settled(id);
  expect(drawn.payloads.at(-1)!.prompt).toStartWith("Again");
});

test("a Scene Image being drawn lands even if the one it used is deleted", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("One", scene("The ferry")), turn("Two", scene("The ferry"))], png(1), png(2), slow);
  const id = await newSave();
  const gallery = await playTurn(id);
  await send(id);
  await Bun.sleep(5);

  expect((await remove(id, find(gallery, "The ferry"))).status).toBe(200);
  finish(png(3));

  expect((await settled(id)).images.filter(({ kind }) => kind === "scene").map(({ ref }) => ref)).toEqual([4]);
  expect(await app.get(`/saves/${id}/messages/4/image`).then((r) => r.bytes())).toEqual(png(3));
});

test("a Requested Image in the queue survives its Message's Scene Image being deleted", async () => {
  let finish = (_: Uint8Array) => {};
  const slow = new Promise<Uint8Array>((resolve) => (finish = resolve));
  await play([turn("One", scene("The ferry")), written("One")], png(1), png(2), slow, png(4));
  const id = await newSave();
  const gallery = await playTurn(id);
  const portrait = find(gallery, "Ash");
  const image = find(gallery, "The ferry");

  await redraw(id, portrait, "Holding");
  await app.post(`/saves/${id}/requested-images`, { words: "a gull" });
  await remove(id, image);
  finish(png(3));

  expect(labels(await settled(id))).toEqual(["Ash", "a gull"]);
});

test("a Revert doesn't bring a deleted image back", async () => {
  await play([turn("One", scene("The ferry")), turn("Two", scene("The pier"))], png(1), png(2), png(3));
  const id = await newSave();
  const gallery = await playTurn(id);
  await playTurn(id);
  await remove(id, find(gallery, "The ferry"));

  expect(await app.get(`/saves/${id}/messages/2/revert`).then((r) => r.json())).toEqual({ messages: 2, images: 1, portraits: 0 });
  await app.post(`/saves/${id}/messages/2/revert`, {});

  expect(labels(await galleryOf(id))).toEqual(["Ash"]);
});

test("a deleted image leaves the Save's file, exports and duplicates, and its id isn't reused", async () => {
  const mark = (text: string) => Uint8Array.of(...PNG, ...Buffer.from(text));
  await play(
    [turn("One", scene("The ferry")), written("One"), written("Two")],
    png(1),
    mark("deleted-scene-image"),
    mark("deleted-requested-image"),
    png(4),
  );
  const id = await newSave();
  await playTurn(id);
  const gallery = await asked(id, "gone");
  const requested = find(gallery, "gone");

  await remove(id, find(gallery, "The ferry"));
  await remove(id, requested);

  const exported = Buffer.from(await app.get(`/saves/${id}/export`).then((r) => r.bytes()));
  const { id: copy } = (await (await app.post(`/saves/${id}/duplicate`, {})).json()) as { id: string };
  const file = Buffer.from(await Bun.file(join(savesDir, `${id}.sqlite`)).bytes());
  for (const bytes of [exported, file]) {
    expect(bytes.includes("deleted-scene-image")).toBe(false);
    expect(bytes.includes("deleted-requested-image")).toBe(false);
  }
  expect(labels(await galleryOf(copy))).toEqual(["Ash"]);
  expect((await app.get(`/saves/${copy}/messages/2/image`)).status).toBe(404);

  const after = await asked(id, "new");
  expect(find(after, "new").ref).toBeGreaterThan(requested.ref);
});
