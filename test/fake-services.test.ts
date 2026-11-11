import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fakeImages, fakeTextProvider, solidPng } from "../src/fake-services";
import { saveStore } from "../src/save-store";
import { startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;

beforeEach(() => {
  folder = tempFolder();
  app = startApp(join(folder.path, "Saves"), fakeTextProvider, () => 10, 2, fakeImages);
});

afterEach(async () => {
  await app.stop();
  folder.remove();
});

const choices = { title: "The Salt Road", theme: "Western", worldBrief: "A drowned city", startingHook: "", pc: { name: "Ash" } };

test("the fake Narrator answers world creation, the Opening and a Turn with replies the app accepts", async () => {
  expect((await app.post("/worlds/pick", { theme: "Western", title: "", worldBrief: "" })).status).toBe(200);
  const setup = { theme: "Western", title: "", worldBrief: "A drowned city", startingHook: "", characters: [] };
  expect((await app.post("/enhance", { ...setup, field: "worldBrief", text: "A city" })).status).toBe(200);

  const world = await app.post("/worlds", choices);
  expect(world.status).toBe(201);
  const begun = await app.post(`/worlds/${((await world.json()) as { id: string }).id}/begin`, { artStyle: "" });
  expect(begun.status).toBe(201);
  const { id } = (await begun.json()) as { id: string };

  const turn = await app.post(`/saves/${id}/turns`, { input: "I walk to the harbour." });
  expect(turn.status).toBe(201);
  const { messages } = (await turn.json()) as { messages: { id: number; role: string; text: string }[] };
  expect(messages.at(-1)).toEqual({ id: expect.any(Number), role: "narrator", text: expect.stringContaining(" ") });
  // One of everyone a reply lists, so the Journal has someone in it.
  expect(saveStore(join(folder.path, "Saves")).latestState(id).npcs.length).toBeGreaterThan(0);
});

test("the fake image model draws a real PNG in the shape asked for", async () => {
  const bytes = await fakeImages({ prompt: "", aspect_ratio: "16:9", reference_images: [], style_preset: "" }, new AbortController().signal);
  expect([...bytes.slice(1, 4)]).toEqual([...new TextEncoder().encode("PNG")]);
  const view = new DataView(bytes.buffer);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([64, 36]);
  expect(solidPng(2, 2, [0, 0, 0]).length).toBeGreaterThan(50);
});
