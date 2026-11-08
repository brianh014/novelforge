import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ImageAdapter } from "../src/image-adapter";
import { png, scriptedImages, scriptedTextProvider, startApp, tempFolder } from "./support";

type Journal = { npcs: string[]; portraits: { id: number; npc: string | null; redraws: number; messageId: number }[] };
type Images = { images: { messageId: number }[]; pending: boolean; session: number };

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
let images: ReturnType<typeof scriptedImages>;

const play = (replies: (string | Error)[], ...imageReplies: Parameters<typeof scriptedImages>) => {
  images = scriptedImages(...imageReplies);
  app = startApp(join(folder.path, "Saves"), scriptedTextProvider(...replies).textProvider, undefined, undefined, images.imageAdapter);
};

const enableImages = () => app.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await app.stop();
  folder.remove();
});

const turn = (...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations, scene_changed: false, visual_description: "A wet street" });

const meet = (name: string, appearance = "Tall, in oilskins") => ({ op: "add_npc", name, appearance });
const know = (name: string) => ({ op: "add_known_npc", name });
const inView = (...visible_cast: string[]) => ({ op: "set_scene", location: "The ferry", visible_cast });
const moveTo = (location: string, ...visible_cast: string[]) => ({ op: "set_scene", location, visible_cast });

const imagesOf = async (id: string) => (await app.get(`/saves/${id}/images`).then((r) => r.json())) as Images;

async function settled(id: string) {
  for (let tries = 0; tries < 200; tries++) {
    const state = await imagesOf(id);
    if (!state.pending) return state;
    await Bun.sleep(5);
  }
  throw new Error("The images never settled");
}

const journalOf = async (id: string) => (await app.get(`/saves/${id}/journal`).then((r) => r.json())) as Journal;
const playTurn = (id: string) => app.post(`/saves/${id}/turns`, { input: "I look around." });

async function playSettled(id: string) {
  await playTurn(id);
  return settled(id);
}

const portraitPrompts = () => images.payloads.filter(({ aspect_ratio }) => aspect_ratio === "1:1").map(({ prompt }) => prompt);

test("an NPC gets a portrait on entering the visible cast, not on being added, and only once", async () => {
  play(
    [turn(meet("Hesper")), turn(inView("Hesper"), know("Hesper")), turn(moveTo("The pier", "Hesper")), turn(moveTo("The bar")), turn(inView("Hesper"))],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
  );
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);
  expect(portraitPrompts()).toEqual([]);
  expect((await journalOf(id)).portraits).toEqual([]);

  for (let turns = 0; turns < 4; turns++) await playSettled(id);

  expect(portraitPrompts()).toHaveLength(1);
  expect(portraitPrompts()[0]).toContain("Tall, in oilskins");
  expect((await journalOf(id)).portraits).toEqual([{ id: expect.any(Number), npc: "Hesper", redraws: 0, messageId: expect.any(Number) }]);
});

test("a portrait is served as an image, read from its bytes", async () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0);
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper"))], jpeg, png(1));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);

  const [portrait] = (await journalOf(id)).portraits;
  const served = await app.get(`/saves/${id}/portraits/${portrait!.id}`);

  expect(served.headers.get("content-type")).toBe("image/jpeg");
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await served.bytes()).toEqual(jpeg);
});

test("a visible NPC the PC doesn't know yet has a portrait no route will show", async () => {
  play([turn(meet("MARKER-STRANGER", "MARKER-LOOKS"), inView("MARKER-STRANGER")), turn(know("MARKER-STRANGER"))], png(1), png(2));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);

  expect((await journalOf(id)).portraits).toEqual([]);
  expect((await app.get(`/saves/${id}/portraits/1`)).status).toBe(404);

  await playSettled(id);
  const { portraits } = await journalOf(id);
  expect(portraits).toEqual([{ id: 1, npc: "MARKER-STRANGER", redraws: 0, messageId: expect.any(Number) }]);
  expect(await app.get(`/saves/${id}/portraits/1`).then((r) => r.bytes())).toEqual(png(1));
});

test.each(["__proto__", "constructor", "../../secret", "Mara/mara?#", "mara"])("the name %s is only ever data", async (name) => {
  // A portrait for one spelling must never answer for another, so "Mara" stays unknown and undrawn in the Journal.
  play([turn(meet("Mara"), meet(name), know(name), inView(name))], png(1), png(2));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);

  const { portraits, npcs } = await journalOf(id);
  expect(npcs).toEqual([name]);
  expect(portraits).toEqual([{ id: 1, npc: name, redraws: 0, messageId: expect.any(Number) }]);
  expect(await app.get(`/saves/${id}/portraits/1`).then((r) => r.status)).toBe(200);
});

test.each(["abc", "1.5", "-1", "999"])("asking for portrait %s finds nothing", async (portrait) => {
  play([]);
  const id = await app.createSave();

  expect((await app.get(`/saves/${id}/portraits/${portrait}`)).status).toBe(404);
});

const createPc = async (details: object = { physicalTraits: "Grey-eyed, with a salt-white scar" }) => {
  const response = await app.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash", ...details } });
  return ((await response.json()) as { id: string }).id;
};

const allowLogged = () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  return () => logged.mockRestore();
};

test("a new PC gets a portrait from their physical traits alone, which never holds their name", async () => {
  play([], png(1));
  await enableImages();

  const id = await createPc({ physicalTraits: "Grey-eyed", background: "A lapsed ferryman" });

  expect(await settled(id)).toMatchObject({ pending: false, session: 1 });
  expect(images.payloads[0]!.prompt).toContain("Grey-eyed");
  expect(images.payloads[0]!.prompt).not.toContain("A lapsed ferryman");
  expect(images.payloads[0]!.prompt).not.toContain("Ash");
  expect((await journalOf(id)).portraits).toEqual([{ id: 1, npc: null, redraws: 0, messageId: expect.any(Number) }]);
  expect(await app.get(`/saves/${id}/portraits/1`).then((r) => r.bytes())).toEqual(png(1));
});

test("a PC with no description gets no portrait", async () => {
  play([]);
  await enableImages();

  const id = await createPc({});

  expect(await settled(id)).toMatchObject({ session: 0 });
  expect(images.payloads).toEqual([]);
});

test("neither a new Save nor its first Turn waits for the PC's portrait, and a Turn waits for no NPC's", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([turn(meet("Hesper"), inView("Hesper"))], promise, png(1), png(2));
  await enableImages();

  const id = await createPc();
  expect(await imagesOf(id)).toMatchObject({ pending: true });
  expect((await playTurn(id)).status).toBe(201);
  expect(await imagesOf(id)).toMatchObject({ pending: true, session: 0 });

  resolve(png(3));
  expect(await settled(id)).toMatchObject({ session: 3 });
});

test("a failed portrait doesn't touch play, tells the client nothing, and the next move of the Scene tries again", async () => {
  const restore = allowLogged();
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(), turn(moveTo("The pier", "Hesper"))], new Error("SECRET-API-FAILURE"), png(1), png(2), png(3));
  await enableImages();
  const id = await app.createSave();

  expect((await playTurn(id)).status).toBe(201);
  const failed = await settled(id);
  expect(JSON.stringify(failed)).not.toContain("SECRET-API-FAILURE");
  expect((await journalOf(id)).portraits).toEqual([]);

  await playSettled(id);
  expect(images.payloads).toHaveLength(2);

  await playSettled(id);
  expect((await journalOf(id)).portraits).toEqual([{ id: 1, npc: "Hesper", redraws: 0, messageId: expect.any(Number) }]);
  restore();
});

test("portraits count toward the session's images", async () => {
  play([turn(meet("Hesper"), inView("Hesper"))], png(1), png(2), png(3));
  await enableImages();
  const id = await createPc();

  await playTurn(id);

  expect(await settled(id)).toMatchObject({ session: 3 });
});

test("with images off nobody is drawn, and once they're on the next move of the Scene draws whoever was missed", async () => {
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(), turn(moveTo("The pier", "Hesper"))], png(1), png(2), png(3));
  await enableImages();
  await app.patch("/settings", { imagesEnabled: false });
  const id = await createPc();

  await playSettled(id);
  expect(images.payloads).toEqual([]);

  await app.patch("/settings", { imagesEnabled: true });
  await playSettled(id);
  expect(images.payloads).toEqual([]);

  await playSettled(id);
  expect(portraitPrompts()).toHaveLength(2);
  expect((await journalOf(id)).portraits.map(({ npc }) => npc)).toEqual([null, "Hesper"]);
});

test("turning images off stops a waiting portrait", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([turn(meet("Hesper"), inView("Hesper"))], promise);
  await enableImages();
  const id = await createPc();
  await playTurn(id);

  await app.patch("/settings", { imagesEnabled: false });
  resolve(png(1));

  expect(await settled(id)).toMatchObject({ session: 1 });
  expect(images.payloads).toHaveLength(1);
});

test("an unfinished Local setup makes no portrait calls, and the OpenRouter adapter isn't used", async () => {
  play([turn(meet("Hesper"), inView("Hesper"))]);
  await app.patch("/settings", { imageProvider: "local", imageModel: "local/model", imageApiKey: "image-key" });
  const id = await createPc();

  await playSettled(id);

  expect(images.payloads).toEqual([]);
});

test("a Scene Image gets the portraits of the PC first, then those marked in it, and their looks without names", async () => {
  const pictured = (visual_description: string, ...state_operations: object[]) =>
    JSON.stringify({ check: null, narration: "The tide rises.", state_operations, scene_changed: true, visual_description });
  play(
    [
      pictured("An empty street", moveTo("The street")),
      pictured(
        "[Orin] nods to [Hesper] while [Ash] waits",
        meet("Hesper", "Tall, in oilskins"),
        meet("Orin", "Stooped, red scarf"),
        meet("Tobin", "Unseen"),
        { op: "add_item", slot: "wearing", item: "a tin badge" },
        moveTo("The street", "Orin", "Hesper"),
      ),
      pictured("[Orin] alone on the pier", moveTo("The pier", "Orin", "Hesper")),
    ],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
    png(6),
  );
  await enableImages();
  const id = await createPc();
  await playSettled(id);
  await playSettled(id);
  await playSettled(id);

  const scenes = images.payloads.filter(({ aspect_ratio }) => aspect_ratio === "16:9");
  const second = scenes[1]!;
  expect(second.reference_images).toEqual([
    { role: "pc", bytes: png(1), mediaType: "image/png" },
    { role: "npc", bytes: png(3), mediaType: "image/png" },
    { role: "npc", bytes: png(4), mediaType: "image/png" },
  ]);
  expect(second.prompt).toContain("Stooped, red scarf nods to Tall, in oilskins while");
  expect(second.prompt).toContain("wearing a tin badge");
  expect(second.prompt).not.toContain("Orin");
  expect(second.prompt).not.toContain("Unseen");
  // Hesper is still in the cast, but only the marked portrait goes along, and the PC's stays out of a picture without them.
  expect(scenes[2]!.reference_images).toEqual([{ role: "npc", bytes: png(3), mediaType: "image/png" }]);
});

test("quick Turns keep every portrait, even though only the newest scene waits", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play(
    [turn(moveTo("One")), turn(meet("Hesper"), inView("Hesper")), turn(meet("Orin"), inView("Hesper", "Orin")), turn(moveTo("Four", "Hesper", "Orin"))],
    promise,
    png(1),
    png(2),
    png(3),
  );
  await enableImages();
  const id = await app.createSave();
  for (let turns = 0; turns < 4; turns++) await playTurn(id);

  resolve(png(4));
  await settled(id);

  expect(portraitPrompts()).toHaveLength(2);
  expect(images.payloads.map(({ aspect_ratio }) => aspect_ratio)).toEqual(["16:9", "1:1", "1:1", "16:9"]);
});

test("Revert counts and deletes a portrait from a Reverted first appearance, and the NPC gets a new one next time", async () => {
  play(
    [turn(), turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(meet("Hesper"), know("Hesper"), inView("Hesper"))],
    png(1),
    png(2),
    png(3),
    png(4),
    png(5),
  );
  await enableImages();
  const id = await createPc();
  await playSettled(id);
  await playSettled(id);
  const before = (await journalOf(id)).portraits;

  expect(await app.get(`/saves/${id}/messages/2/revert`).then((r) => r.json())).toEqual({ messages: 2, images: 1, portraits: 1 });
  expect(await app.post(`/saves/${id}/messages/2/revert`, {}).then((r) => r.json())).toEqual({ messages: 2, images: 1, portraits: 1 });

  // The PC's stays: no Message drew it.
  expect((await journalOf(id)).portraits).toEqual([{ id: before[0]!.id, npc: null, redraws: 0, messageId: expect.any(Number) }]);
  expect((await app.get(`/saves/${id}/portraits/${before[1]!.id}`)).status).toBe(404);

  await playSettled(id);
  const after = (await journalOf(id)).portraits;
  expect(after.map(({ npc }) => npc)).toEqual([null, "Hesper"]);
  // Never the old id, so a browser can't show the Reverted picture.
  expect(after[1]!.id).not.toBe(before[1]!.id);
});

test("Regenerate takes the portrait with the old response and draws one for the new response", async () => {
  play([turn(meet("Hesper", "First looks"), know("Hesper"), inView("Hesper")), turn(meet("Hesper", "Second looks"), know("Hesper"), inView("Hesper"))], png(1), png(2), png(3), png(4));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);

  await app.post(`/saves/${id}/messages/2/regenerate`, {});
  await settled(id);

  expect(portraitPrompts()).toEqual([expect.stringContaining("First looks"), expect.stringContaining("Second looks")]);
  const { portraits } = await journalOf(id);
  expect(portraits).toHaveLength(1);
  expect(await app.get(`/saves/${id}/portraits/${portraits[0]!.id}`).then((r) => r.bytes())).toEqual(png(3));
});

test("a Revert cancels a portrait in flight and drops a waiting one, and neither writes", async () => {
  play([turn(meet("Hesper"), meet("Orin"), inView("Hesper", "Orin"))], new Promise<Uint8Array>(() => {}), png(1));
  await enableImages();
  const id = await app.createSave();
  await playTurn(id);
  await app.post(`/saves/${id}/messages/1/revert`, {});

  expect(await settled(id)).toMatchObject({ session: 0 });
  expect(images.aborted).toEqual([1]);
  expect(images.payloads).toHaveLength(1);
  expect(await app.get(`/saves/${id}/messages/1/revert`).then((r) => r.json())).toEqual({ messages: 0, images: 0, portraits: 0 });
});

test("a portrait that finishes after its response was replaced writes nothing, even if it ignores the cancel", async () => {
  const late = Promise.withResolvers<Uint8Array>();
  const adapter: ImageAdapter = () => late.promise;
  app = startApp(
    join(folder.path, "Saves"),
    scriptedTextProvider(turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn()).textProvider,
    undefined,
    undefined,
    adapter,
  );
  await enableImages();
  const id = await app.createSave();
  await playTurn(id);
  await app.post(`/saves/${id}/messages/2/regenerate`, {});

  late.resolve(png(1));

  // The second is the fresh Scene Image for the new response.
  expect(await settled(id)).toMatchObject({ session: 2 });
  expect((await journalOf(id)).portraits).toEqual([]);
});

test("deleting a Save aborts its PC's portrait, and nothing brings the file back", async () => {
  const restore = allowLogged();
  play([], new Promise<Uint8Array>(() => {}));
  await enableImages();
  const id = await createPc();

  await app.delete(`/saves/${id}`);
  await Bun.sleep(20);

  expect(images.aborted).toEqual([1]);
  expect(readdirSync(join(folder.path, "Saves"))).toEqual([]);
  restore();
});

test("a Duplicate from here keeps the PC and the portraits up to that Message", async () => {
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(meet("Orin"), know("Orin"), inView("Hesper", "Orin"))], png(1), png(2), png(3), png(4), png(5));
  await enableImages();
  const id = await createPc();
  await playSettled(id);
  await playSettled(id);

  const { id: copy } = (await app.post(`/saves/${id}/duplicate`, { fromMessage: 2 }).then((r) => r.json())) as { id: string };

  expect((await journalOf(copy)).portraits.map(({ npc }) => npc)).toEqual([null, "Hesper"]);
  expect((await journalOf(id)).portraits.map(({ npc }) => npc)).toEqual([null, "Hesper", "Orin"]);
});

const importSave = async (bytes: Uint8Array<ArrayBuffer>) => {
  const response = await fetch(app.url("/saves/import"), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  return ((await response.json()) as { id: string }).id;
};

test("export and import carry portraits, and an NPC isn't drawn twice afterwards", async () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0);
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(moveTo("The pier", "Hesper"))], jpeg, png(1), png(2), png(3));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);

  const imported = await importSave(await (await app.get(`/saves/${id}/export`)).bytes());
  const { portraits } = await journalOf(imported);

  expect(portraits).toEqual([{ id: 1, npc: "Hesper", redraws: 0, messageId: expect.any(Number) }]);
  expect((await app.get(`/saves/${imported}/portraits/1`)).headers.get("content-type")).toBe("image/jpeg");
  await playSettled(imported);
  expect(portraitPrompts()).toHaveLength(1);
});

test("a Save from before portraits opens at the new version with none, and draws them from then on", async () => {
  play([turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(moveTo("The pier", "Hesper"))], png(1), png(2), png(3));
  await app.patch("/settings", { imagesEnabled: false });
  const id = await app.createSave();
  await playSettled(id);
  await app.patch("/settings", { imagesEnabled: true, imageModel: "fake/image", imageApiKey: "image-key" });
  {
    using db = new Database(join(folder.path, "Saves", `${id}.sqlite`));
    db.run("DROP TABLE portraits; PRAGMA user_version = 5");
  }

  expect((await journalOf(id)).portraits).toEqual([]);
  await playSettled(id);

  expect((await journalOf(id)).portraits).toEqual([{ id: 1, npc: "Hesper", redraws: 0, messageId: expect.any(Number) }]);
});

test("no route shows an NPC's appearance text or a PC description given to the image model", async () => {
  play([turn(meet("Hesper", "SECRET-LOOKS"), know("Hesper"), inView("Hesper"))], png(1), png(2), png(3));
  await enableImages();
  const id = await createPc({ physicalTraits: "SECRET-TRAITS" });
  await playSettled(id);

  for (const route of ["/images", "/journal", "/messages", "", "/messages/2/snapshot", "/messages/2/revert"]) {
    const body = await app.get(`/saves/${id}${route}`).then((r) => r.text());
    expect(body).not.toContain("SECRET-LOOKS");
    expect(body).not.toContain("SECRET-TRAITS");
  }
});

test("the Narrator is asked to give each NPC appearance text fit for an image prompt", async () => {
  const script = scriptedTextProvider(turn());
  app = startApp(join(folder.path, "Saves"), script.textProvider);
  const id = await app.createSave();

  await playTurn(id);

  expect(script.prompts[0]![0]!.content).toContain("appearance is used to paint them");
});

test("a portrait belongs to the first appearance, so a Revert past a later draw keeps it and pays for nothing", async () => {
  play(
    [turn(meet("Hesper"), know("Hesper"), inView("Hesper")), turn(), turn(moveTo("The pier", "Hesper")), turn(moveTo("The bar", "Hesper"))],
    png(1),
    png(2),
    png(3),
  );
  await enableImages();
  await app.patch("/settings", { imagesEnabled: false });
  const id = await app.createSave();
  await playSettled(id);
  await app.patch("/settings", { imagesEnabled: true });
  await playSettled(id);
  await playSettled(id);
  expect((await journalOf(id)).portraits.map(({ npc }) => npc)).toEqual(["Hesper"]);

  // Message 4 stands after this, drawn at 6 or not, and Hesper first appeared at 2.
  const preview = (await app.get(`/saves/${id}/messages/4/revert`).then((r) => r.json())) as { portraits: number };
  expect(preview.portraits).toBe(0);
  await app.post(`/saves/${id}/messages/4/revert`, {});
  await playSettled(id);

  expect(portraitPrompts()).toHaveLength(1);
  expect((await journalOf(id)).portraits.map(({ npc }) => npc)).toEqual(["Hesper"]);

  await app.post(`/saves/${id}/messages/1/revert`, {});
  expect((await journalOf(id)).portraits).toEqual([]);
});

test("settings that can't be read mid-queue fail that image, not the Save", async () => {
  const restore = allowLogged();
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([turn(meet("Hesper"), meet("Orin"), inView("Hesper", "Orin"))], promise);
  await enableImages();
  const id = await app.createSave();
  await playTurn(id);

  const settings = join(folder.path, "settings.json");
  const good = await Bun.file(settings).text();
  await Bun.write(settings, "{ not json");
  resolve(png(1));
  await Bun.sleep(30);
  await Bun.write(settings, good);

  expect(await settled(id)).toMatchObject({ pending: false, session: 1 });
  restore();
});

test("an NPC the PC comes to know gets a portrait without being in view, and one who is only in the state doesn't", async () => {
  play([turn(meet("Stranger")), turn(meet("Jenny"), know("Jenny"))], png(1), png(2));
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);
  expect(images.payloads).toEqual([]);

  await playSettled(id);
  expect((await journalOf(id)).portraits).toEqual([{ id: expect.any(Number), npc: "Jenny", redraws: 0, messageId: expect.any(Number) }]);
  expect(portraitPrompts()).toHaveLength(1);
});

test("a Revert past the Turn an NPC became known takes their portrait with that knowledge", async () => {
  play([turn(), turn(meet("Jenny"), know("Jenny"))], png(1), png(2));
  await enableImages();
  const id = await app.createSave();
  await playSettled(id);
  const { messages } = (await app.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { id: number }[] };
  await playSettled(id);
  expect((await journalOf(id)).portraits).toHaveLength(1);

  await app.post(`/saves/${id}/messages/${messages.at(-1)!.id}/revert`, {});

  expect((await journalOf(id)).portraits).toEqual([]);
  expect((await app.get(`/saves/${id}/gallery`).then((r) => r.json())) as object).toMatchObject({ images: [] });
});

test("someone already known with no portrait is drawn when the Scene next moves, and a failure isn't retried every Turn", async () => {
  play([turn(meet("Jenny"), know("Jenny")), turn(), turn(moveTo("The pier"))], new Error("image model down"), png(1), png(2));
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);
  await playSettled(id);
  expect(portraitPrompts()).toHaveLength(1);

  await playSettled(id);
  expect(portraitPrompts()).toHaveLength(2);
  expect((await journalOf(id)).portraits.map(({ npc }) => npc)).toEqual(["Jenny"]);
});

const naming = (people: unknown, ...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "The tide rises.", state_operations, people, scene_changed: false, visual_description: "A wet street" });
const person = (name: string, appearance = "Tall, in oilskins") => ({ name, appearance });

test("someone the response names but the Narrator never added becomes a known NPC with a portrait", async () => {
  play([naming([person("Priya", "Short, with a green scarf")])], png(1));
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);

  expect(portraitPrompts()).toEqual([expect.stringContaining("Short, with a green scarf")]);
  const { npcs, portraits } = await journalOf(id);
  expect(npcs).toEqual(["Priya"]);
  expect(portraits.map(({ npc }) => npc)).toEqual(["Priya"]);
});

test("someone with a portrait who was never made known appears once named, with no second drawing", async () => {
  play([turn(meet("Marcus"), inView("Marcus")), naming([person("Marcus")])], png(1), png(2));
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);
  expect((await journalOf(id)).portraits).toEqual([]);
  const drawn = portraitPrompts().length;
  await playSettled(id);

  expect(portraitPrompts()).toHaveLength(drawn);
  const { npcs, portraits } = await journalOf(id);
  expect(npcs).toEqual(["Marcus"]);
  expect(portraits.map(({ npc }) => npc)).toEqual(["Marcus"]);
});

test("the Narrator doing the same work in its operations costs nothing, and a summary and the cast can use the new name", async () => {
  play(
    [naming([person("Priya")], meet("Priya"), know("Priya"), { op: "set_known_npc_summary", name: "Priya", summary: "A ferry hand." }, inView("Priya"))],
    png(1),
    png(2),
  );
  await enableImages();
  const id = await app.createSave();

  const response = await playTurn(id);
  await settled(id);

  expect(response.status).toBe(201);
  expect((await journalOf(id)).npcs).toEqual(["Priya"]);
  expect((await app.get(`/saves/${id}/journal`).then((r) => r.json())).npcSummaries).toEqual({ Priya: "A ferry hand." });
  expect((await app.get(`/saves/${id}/journal`).then((r) => r.json())).recentNpcs).toEqual(["Priya"]);
});

test("the PC, someone with no looks to draw, and a repeat in the list add no NPC", async () => {
  play([naming([person("Ash"), person("Nobody", " "), person("Priya"), person("Priya", "Someone else")])], png(1));
  await enableImages();
  const id = await app.createSave();

  await playSettled(id);

  expect((await journalOf(id)).npcs).toEqual(["Priya"]);
  expect(portraitPrompts()).toEqual([expect.stringContaining("Tall, in oilskins")]);
});

test("a malformed list of people doesn't cost the Turn", async () => {
  play([naming("nobody in particular")]);
  const id = await app.createSave();

  const response = await playTurn(id);

  expect(response.status).toBe(201);
  expect((await journalOf(id)).npcs).toEqual([]);
});

test("older responses show who they named, so that the Narrator has a filled list to copy", async () => {
  const named = JSON.stringify({ check: null, narration: "Priya waves.", state_operations: [], people: [person("Priya")], scene_changed: false, visual_description: "" });
  const provider = scriptedTextProvider(named, turn());
  images = scriptedImages();
  app = startApp(join(folder.path, "Saves"), provider.textProvider, undefined, undefined, images.imageAdapter);
  const id = await app.createSave();
  await playTurn(id);
  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  const older = provider.prompts[1]!.find(({ role }) => role === "assistant")!;
  expect(JSON.parse(older.content as string).people).toEqual([person("Priya")]);
});
