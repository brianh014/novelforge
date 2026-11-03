import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { narration, scriptedTextProvider, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let game: ReturnType<typeof startGame> | undefined;

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  game = startGame(savesDir, script.textProvider);
  return { game, prompts: script.prompts };
};

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await game?.stop();
  folder.remove();
});

test("creating a Save makes one SQLite file in the Saves folder", async () => {
  const { game } = play();

  const response = await game.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash" } });

  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
});

test("a Turn stores the player and Narrator Messages", async () => {
  const { game, prompts } = play(narration("The tide rises around you."));
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(response.status).toBe(201);
  const messages = await game.get(`/saves/${id}/messages`).then((r) => r.json());
  expect(messages).toEqual({
    messages: [
      { id: 1, role: "player", text: "I wade forward." },
      { id: 2, role: "narrator", text: "The tide rises around you." },
    ],
  });
  expect(prompts).toHaveLength(1);
  const prompt = JSON.stringify(prompts[0]);
  expect(prompt).toContain("A drowned city");
  expect(prompt).toContain("Ash");
  expect(prompt).toContain("I wade forward.");
});

test("Messages survive a server restart", async () => {
  const { game } = play(narration("The tide rises around you."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  await game.restart();

  const { messages } = (await game.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: unknown[] };
  expect(messages).toHaveLength(2);
});

test("a Save has no sidecar files and uses a rollback journal", async () => {
  const { game } = play(narration("The tide rises around you."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
  using db = new Database(join(savesDir, `${id}.sqlite`));
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
});

test("a Turn that fails while committing keeps neither Message", async () => {
  const { game } = play(narration("The tide rises around you."));
  const id = await game.createSave();
  {
    // The only way to fail between the two inserts from outside the server.
    using db = new Database(join(savesDir, `${id}.sqlite`));
    db.run(`CREATE TRIGGER fail_narrator BEFORE INSERT ON messages WHEN NEW.role = 'narrator'
            BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  }

  const response = await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(response.status).toBe(500);
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test.each([
  ["a Text Provider failure", new Error("network down")],
  ["a Narrator reply that is not JSON", "The tide rises"],
  ["a Narrator reply with the wrong shape", JSON.stringify({ text: "The tide rises" })],
])("%s returns 502 and writes nothing", async (_, reply) => {
  const { game } = play(reply);
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(response.status).toBe(502);
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("an unknown Save returns 404 without calling the Text Provider", async () => {
  const { game, prompts } = play();
  const id = crypto.randomUUID();

  expect((await game.post(`/saves/${id}/turns`, { input: "Hello" })).status).toBe(404);
  expect((await game.get(`/saves/${id}/messages`)).status).toBe(404);
  expect(prompts).toHaveLength(0);
});

test("a Save id cannot reach outside the Saves folder", async () => {
  const { game } = play();
  const id = await game.createSave();

  const response = await game.get(`/saves/..%2FSaves%2F${id}/messages`);

  expect(response.status).toBe(404);
});

test.each([
  ["a missing field", { pc: { name: "Ash" } }],
  ["an empty World Brief", { worldBrief: "", pc: { name: "Ash" } }],
  ["a PC with no name", { worldBrief: "A drowned city", pc: {} }],
])("a Save request with %s returns 400", async (_, body) => {
  const { game } = play();

  expect((await game.post("/saves", body)).status).toBe(400);
  expect(readdirSync(savesDir)).toEqual([]);
});

test("a Turn request with no input returns 400 without calling the Text Provider", async () => {
  const { game, prompts } = play();
  const id = await game.createSave();

  expect((await game.post(`/saves/${id}/turns`, {})).status).toBe(400);
  expect(prompts).toHaveLength(0);
});

test("a non-JSON POST is rejected, so other websites cannot post to the server", async () => {
  const { game } = play();

  const response = await fetch(game.url("/saves"), {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ worldBrief: "A drowned city", pc: { name: "Ash" } }),
  });

  expect(response.status).toBe(400);
  expect(readdirSync(savesDir)).toEqual([]);
});
