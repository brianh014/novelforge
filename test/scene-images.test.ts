import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ImageAdapter } from "../src/image-adapter";
import { PNG, png, scriptedImages, scriptedTextProvider, startGame, tempFolder } from "./support";

type Images = { images: { messageId: number; caption: string }[]; pending: boolean; session: number };

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;
let images: ReturnType<typeof scriptedImages>;

const play = (replies: (string | Error)[], ...imageReplies: Parameters<typeof scriptedImages>) => {
  images = scriptedImages(...imageReplies);
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider(...replies).textProvider, undefined, undefined, images.imageAdapter);
};

const enableImages = () => game.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const turn = (fields: object) => JSON.stringify({ check: null, narration: "The tide rises.", state_operations: [], ...fields });

const moveTo = (location: string, visible_cast: string[] = []) => [{ op: "set_scene", location, visible_cast }];

const newScene = (description = "A flooded street at dusk", location = "The drowned street") =>
  turn({ scene_changed: true, visual_description: description, state_operations: moveTo(location) });

const stay = (fields: object = {}) => turn({ scene_changed: false, visual_description: "A different picture entirely", ...fields });

const imagesOf = async (id: string) => (await game.get(`/saves/${id}/images`).then((r) => r.json())) as Images;

async function settled(id: string) {
  for (let tries = 0; tries < 200; tries++) {
    const state = await imagesOf(id);
    if (!state.pending) return state;
    await Bun.sleep(5);
  }
  throw new Error("The image never settled");
}

const playTurn = (id: string) => game.post(`/saves/${id}/turns`, { input: "I wade forward." });

const imageBytes = async (id: string, messageId: number) =>
  (await game.get(`/saves/${id}/messages/${messageId}/image`)).bytes();

const messageIds = async (id: string) => {
  const { messages } = (await game.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { id: number }[] };
  return messages.map((message) => message.id);
};

test("a Turn that changes the scene gets a Scene Image in its Save, served as an image", async () => {
  play([newScene()], PNG);
  await enableImages();
  const id = await game.createSave();

  await playTurn(id);

  expect(await settled(id)).toEqual({
    images: [{ messageId: 2, caption: "The drowned street" }],
    pending: false,
    session: 1,
  });
  const served = await game.get(`/saves/${id}/messages/2/image`);
  expect(served.headers.get("content-type")).toBe("image/png");
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await served.bytes()).toEqual(new Uint8Array(PNG));
  expect(images.payloads[0]).toMatchObject({ aspect_ratio: "16:9", reference_images: [] });
  expect(images.payloads[0]!.prompt).toContain("A flooded street at dusk");
});

test("scene_changed alone asks for an image, with the state as it was", async () => {
  play([newScene(), turn({ scene_changed: true, visual_description: "The same street, now at night" })], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);

  await playTurn(id);

  expect((await settled(id)).images).toHaveLength(2);
  expect(images.payloads[1]!.prompt).toBe("The same street, now at night");
});

test("the server sees a change of location or visible cast without scene_changed", async () => {
  const hesper = { op: "add_npc", name: "Hesper", appearance: "Tall, in oilskins" };
  play(
    [
      stay({ state_operations: moveTo("The street") }),
      stay({ state_operations: [hesper, ...moveTo("The street", ["Hesper"])] }),
      stay({ state_operations: moveTo("The ferry", ["Hesper"]) }),
    ],
    png(1),
    png(2),
    png(3),
    png(4),
  );
  await enableImages();
  const id = await game.createSave();

  for (const expected of [1, 2, 3]) {
    await playTurn(id);
    expect((await settled(id)).images).toHaveLength(expected);
  }
});

test("a new description alone asks for no image, and neither does reordering the same cast", async () => {
  const npcs = ["Hesper", "Orin"].map((name) => ({ op: "add_npc", name, appearance: "Wet" }));
  play(
    [
      turn({ scene_changed: true, visual_description: "Two figures", state_operations: [...npcs, ...moveTo("The ferry", ["Hesper", "Orin"])] }),
      stay(),
      stay({ visual_description: "The same ferry, but described quite differently", state_operations: moveTo("The ferry", ["Orin", "Hesper"]) }),
    ],
    png(1),
    png(2),
    PNG,
  );
  await enableImages();
  const id = await game.createSave();

  for (let index = 0; index < 3; index++) {
    await playTurn(id);
    await settled(id);
  }

  expect(images.payloads.filter(({ aspect_ratio }) => aspect_ratio === "16:9")).toHaveLength(1);
});

test("a visible cast name the state lacks is left out, and the Turn stands on its first try", async () => {
  const script = scriptedTextProvider(stay({ state_operations: moveTo("The ferry", ["Nobody"]) }), stay({ state_operations: moveTo("The ferry", ["Nobody", "Still nobody"]) }));
  images = scriptedImages(png(1));
  game = startGame(join(folder.path, "Saves"), script.textProvider, undefined, undefined, images.imageAdapter);
  await enableImages();
  const id = await game.createSave();

  expect((await playTurn(id)).status).toBe(201);
  await settled(id);
  await playTurn(id);

  expect((await settled(id)).images).toEqual([{ messageId: 2, caption: "The ferry" }]);
  expect(script.prompts).toHaveLength(2);
});

test("a move with a blank description still draws, from the location", async () => {
  play([turn({ scene_changed: false, visual_description: "", state_operations: moveTo("The ferry") })], PNG);
  await enableImages();
  const id = await game.createSave();

  await playTurn(id);

  expect((await settled(id)).images).toHaveLength(1);
  expect(images.payloads[0]!.prompt).toBe("The ferry");
});

test("a scene change with nothing to draw asks for no image", async () => {
  play([turn({ scene_changed: true, visual_description: null })]);
  await enableImages();
  const id = await game.createSave();

  await playTurn(id);

  expect(await settled(id)).toMatchObject({ images: [], session: 0 });
  expect(images.payloads).toHaveLength(0);
});

test("a Turn never waits for its image", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([newScene()], promise);
  await enableImages();
  const id = await game.createSave();

  expect((await playTurn(id)).status).toBe(201);

  expect(await imagesOf(id)).toEqual({ images: [], pending: true, session: 0 });
  expect(await messageIds(id)).toEqual([1, 2]);
  resolve(PNG);
  expect((await settled(id)).images).toHaveLength(1);
});

test("an image failure leaves the Turn alone, tells the client nothing and isn't retried", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  play([newScene(), stay()], new Error("image-api-detail"));
  await enableImages();
  const id = await game.createSave();

  expect((await playTurn(id)).status).toBe(201);
  const failed = await settled(id);
  expect((await playTurn(id)).status).toBe(201);

  expect(failed).toEqual({ images: [], pending: false, session: 0 });
  expect(images.payloads).toHaveLength(1);
  expect(logged).toHaveBeenCalled();
  logged.mockRestore();
});

test.each([
  ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
  ["HTML", new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
])("a model that returns %s stores nothing", async (_name, bytes) => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  play([newScene()], bytes);
  await enableImages();
  const id = await game.createSave();

  await playTurn(id);

  expect((await settled(id)).images).toEqual([]);
  logged.mockRestore();
});

test("new images use the current Art Style, and stored images never change", async () => {
  play([newScene(), newScene("A pier", "The pier")], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await game.patch(`/saves/${id}`, { artStyle: "Woodcut" });
  await playTurn(id);
  await settled(id);

  await game.patch(`/saves/${id}`, { artStyle: "Watercolor" });
  await playTurn(id);
  await settled(id);

  expect(images.payloads.map(({ style_preset }) => style_preset)).toEqual(["Woodcut", "Watercolor"]);
  expect(await imageBytes(id, 2)).toEqual(png(1));
  expect(await imageBytes(id, 4)).toEqual(png(2));
});

test("the previous Scene Image goes along as a role-tagged reference", async () => {
  play([newScene(), newScene("A pier", "The pier")], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);

  await playTurn(id);
  await settled(id);

  const [reference] = images.payloads[1]!.reference_images;
  expect(reference).toMatchObject({ role: "previous_scene", mediaType: "image/png" });
  expect(new Uint8Array(reference!.bytes)).toEqual(png(1));
});

test("quick Turns pay only for the image in flight and the newest scene, which builds on it", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([newScene("One", "One"), newScene("Two", "Two"), newScene("Three", "Three")], promise, png(3));
  await enableImages();
  const id = await game.createSave();

  await playTurn(id);
  await playTurn(id);
  await playTurn(id);
  resolve(png(1));

  expect(await settled(id)).toMatchObject({ images: [{ caption: "One" }, { caption: "Three" }], session: 2 });
  expect(images.payloads.map(({ prompt }) => prompt)).toEqual(["One", "Three"]);
  expect(new Uint8Array(images.payloads[1]!.reference_images[0]!.bytes)).toEqual(png(1));
});

test("the session count covers every Save, lives outside them, and starts again with the server", async () => {
  play([newScene(), newScene()], png(1), png(2));
  await enableImages();
  const first = await game.createSave();
  const second = await game.createSave();
  await playTurn(first);
  await settled(first);
  await playTurn(second);

  expect((await settled(second)).session).toBe(2);
  expect((await imagesOf(first)).session).toBe(2);

  await game.restart();
  expect((await imagesOf(first)).session).toBe(0);
  expect((await imagesOf(first)).images).toHaveLength(1);
});

test("turning images off stops new ones, keeps the old ones, and stops a waiting one", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([newScene("One", "One"), newScene("Two", "Two"), newScene("Three", "Three")], promise);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await playTurn(id);

  await game.patch("/settings", { imagesEnabled: false });
  resolve(PNG);
  await settled(id);
  await playTurn(id);

  expect(await settled(id)).toMatchObject({ images: [{ caption: "One" }], pending: false });
  expect(images.payloads).toHaveLength(1);
  expect((await game.get(`/saves/${id}/messages/2/image`)).status).toBe(200);
});

test.each([
  ["Local with no model chosen", { imageProvider: "local", imageModel: "local/model", imageApiKey: "image-key" }],
  ["no image model", { imageModel: "", imageApiKey: "image-key" }],
  ["no image key", { imageModel: "fake/image", imageApiKey: "" }],
])("%s makes no call and no noise", async (_name, change) => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  play([newScene()]);
  await game.patch("/settings", change);
  const id = await game.createSave();

  expect((await playTurn(id)).status).toBe(201);

  expect(await settled(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(images.payloads).toHaveLength(0);
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("Revert counts and deletes the images after its Message, and keeps those before", async () => {
  play([newScene("One", "One"), newScene("Two", "Two")], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);
  await playTurn(id);
  await settled(id);

  expect(await game.get(`/saves/${id}/messages/2/revert`).then((r) => r.json())).toEqual({ messages: 2, images: 1, portraits: 0 });
  expect(await game.post(`/saves/${id}/messages/2/revert`, {}).then((r) => r.json())).toEqual({ messages: 2, images: 1, portraits: 0 });

  expect((await imagesOf(id)).images).toEqual([{ messageId: 2, caption: "One" }]);
  expect((await game.get(`/saves/${id}/messages/4/image`)).status).toBe(404);
});

test("a Revert cancels a generation for a Message it deleted, which writes nothing", async () => {
  const { promise, resolve } = Promise.withResolvers<Uint8Array>();
  play([turn({}), newScene()], promise);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await playTurn(id);

  await game.post(`/saves/${id}/messages/2/revert`, {});
  resolve(PNG);

  expect((await settled(id)).images).toEqual([]);
  expect(images.aborted).toEqual([1]);
});

test("Regenerate takes the old image with the old response and draws for the new one", async () => {
  play([newScene("Old", "The pier"), newScene("New", "The pier")], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);

  const { messages } = (await game.post(`/saves/${id}/messages/2/regenerate`, {}).then((r) => r.json())) as {
    messages: { id: number }[];
  };

  expect(await settled(id)).toMatchObject({ images: [{ messageId: messages[0]!.id }] });
  expect((await game.get(`/saves/${id}/messages/2/image`)).status).toBe(404);
  expect(await imageBytes(id, messages[0]!.id)).toEqual(png(2));
  // The old picture went with its response, so it can't steer the new one.
  expect(images.payloads[1]!.reference_images).toEqual([]);
});

test("a Rewrite cancels the replaced response's generation, and a response with no change gets no image", async () => {
  play([newScene(), stay()], new Promise<Uint8Array>(() => {}));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);

  await game.post(`/saves/${id}/messages/2/rewrite`, { feedback: "Shorter." });

  expect((await settled(id)).images).toEqual([]);
  expect(images.aborted).toEqual([1]);
  expect(images.payloads).toHaveLength(1);
});

test("a generation that finishes after its response was replaced writes nothing, even if it ignores the cancel", async () => {
  const late = Promise.withResolvers<Uint8Array>();
  const adapter: ImageAdapter = () => late.promise;
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider(newScene(), stay()).textProvider, undefined, undefined, adapter);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await game.post(`/saves/${id}/messages/2/regenerate`, {});

  late.resolve(PNG);

  expect(await settled(id)).toMatchObject({ images: [], session: 1 });
});

test("deleting a Save cancels its generation and nothing brings the file back", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const late = Promise.withResolvers<Uint8Array>();
  const adapter: ImageAdapter = () => late.promise;
  game = startGame(join(folder.path, "Saves"), scriptedTextProvider(newScene()).textProvider, undefined, undefined, adapter);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);

  await game.delete(`/saves/${id}`);
  late.resolve(PNG);
  await Bun.sleep(20);

  expect(readdirSync(join(folder.path, "Saves"))).toEqual([]);
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
});

test("deleting a Save aborts the request in flight, which isn't billed", async () => {
  play([newScene()], new Promise<Uint8Array>(() => {}));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);

  await game.delete(`/saves/${id}`);
  await Bun.sleep(20);

  expect(images.aborted).toEqual([1]);
});

test("stopping the server mid-generation keeps the Turn and leaves no image and no pending work", async () => {
  play([newScene()], new Promise<Uint8Array>(() => {}));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);

  await game.restart();

  expect(await imagesOf(id)).toEqual({ images: [], pending: false, session: 0 });
  expect(await messageIds(id)).toEqual([1, 2]);
});

test("the image routes show the player nothing the image model was told", async () => {
  const secret = "SECRET-VISUAL-DESCRIPTION";
  play([newScene(secret)], PNG);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);

  for (const route of [`/saves/${id}/images`, `/saves/${id}/journal`, `/saves/${id}/messages`, `/saves/${id}`]) {
    expect(await game.get(route).then((r) => r.text())).not.toContain(secret);
  }
  const missing = await game.get(`/saves/${id}/messages/99/image`);
  expect(missing.status).toBe(404);
  expect(await missing.text()).not.toContain(secret);
});

test("the Narrator is asked to keep the scene and describe what can be seen", async () => {
  const script = scriptedTextProvider(stay());
  game = startGame(join(folder.path, "Saves"), script.textProvider);
  const id = await game.createSave();

  await playTurn(id);

  const system = script.prompts[0]![0]!.content;
  for (const term of ["scene_changed", "visual_description", "set_scene"]) expect(system).toContain(term);
});

const importSave = async (bytes: Uint8Array<ArrayBuffer>) => {
  const response = await fetch(game.url("/saves/import"), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  return ((await response.json()) as { id: string }).id;
};

test("export and import carry images, and each is served as what its bytes are", async () => {
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  play([newScene("One", "One"), newScene("Two", "Two")], jpeg, webp);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);
  await playTurn(id);
  await settled(id);

  const imported = await importSave(await (await game.get(`/saves/${id}/export`)).bytes());

  expect((await imagesOf(imported)).images).toHaveLength(2);
  expect(await imageBytes(imported, 2)).toEqual(jpeg);
  expect((await game.get(`/saves/${imported}/messages/2/image`)).headers.get("content-type")).toBe("image/jpeg");
  expect((await game.get(`/saves/${imported}/messages/4/image`)).headers.get("content-type")).toBe("image/webp");
});

test("a Save from before images opens at the new version, with an empty scene in every Snapshot", async () => {
  play([turn({}), newScene()], PNG);
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  const path = join(folder.path, "Saves", `${id}.sqlite`);
  {
    using db = new Database(path);
    db.run("DROP TABLE scene_images; DROP TABLE portraits");
    db.run("DELETE FROM snapshot_sections WHERE name = 'scene'");
    db.run("DELETE FROM sections WHERE id NOT IN (SELECT section_id FROM snapshot_sections)");
    db.run("PRAGMA user_version = 4");
  }

  await game.get(`/saves/${id}/messages/2/snapshot`);
  await playTurn(id);

  // The empty scene is the state before the change, so the old Save gets its first image as a real change.
  expect((await settled(id)).images).toEqual([{ messageId: 4, caption: "The drowned street" }]);
});

test("a Duplicate from here keeps the images up to that Message", async () => {
  play([newScene("One", "One"), newScene("Two", "Two")], png(1), png(2));
  await enableImages();
  const id = await game.createSave();
  await playTurn(id);
  await settled(id);
  await playTurn(id);
  await settled(id);

  const { id: copy } = (await game.post(`/saves/${id}/duplicate`, { fromMessage: 2 }).then((r) => r.json())) as { id: string };

  expect((await imagesOf(copy)).images).toEqual([{ messageId: 2, caption: "One" }]);
  expect(await imageBytes(copy, 2)).toEqual(png(1));
});
