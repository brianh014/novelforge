import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

const snapshotAt = (game: ReturnType<typeof startGame>, id: string, messageId: number) =>
  game.get(`/saves/${id}/messages/${messageId}/snapshot`).then((r) => r.json());

test("a finished Turn's state operations change the Snapshot of its Narrator Message", async () => {
  const { game } = play(
    narration("You find a lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
  );
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I search the crate." });

  expect(await snapshotAt(game, id, 2)).toEqual({
    inventory: { wearing: [], carrying: ["lantern"] },
    status: { health: "unhurt", injuries: [], conditions: [] },
    pcKnown: { facts: [], npcs: [] },
  });
});

test("a refused operation fails the whole Turn, including its valid operations", async () => {
  const { game } = play(
    narration(
      "You trade the lantern for a rope.",
      { op: "add_item", slot: "carrying", item: "lantern" },
      { op: "remove_item", item: "lantern" },
      { op: "remove_item", item: "lantern" },
    ),
  );
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I trade." });

  expect(response.status).toBe(502);
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("state operations update status and PC-known information across Turns", async () => {
  const { game } = play(
    narration(
      "A blade opens your arm. Mara tells you the tide gate is broken.",
      { op: "set_health", health: "hurt" },
      { op: "add_status", kind: "injuries", text: "cut forearm" },
      { op: "add_status", kind: "conditions", text: "soaked" },
      { op: "add_known_fact", fact: "The tide gate is broken" },
      { op: "add_npc", name: "Mara", appearance: "grey coat" },
      { op: "add_known_npc", name: "Mara" },
    ),
    narration("You dry off.", { op: "remove_status", kind: "conditions", text: "soaked" }),
  );
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I fight." });
  await game.post(`/saves/${id}/turns`, { input: "I rest." });

  expect(await snapshotAt(game, id, 4)).toMatchObject({
    status: { health: "hurt", injuries: ["cut forearm"], conditions: [] },
    pcKnown: { facts: ["The tide gate is broken"], npcs: ["Mara"] },
  });
});

test.each([
  ["removing a status the PC lacks", { op: "remove_status", kind: "injuries", text: "broken leg" }],
  ["repeating a status", { op: "add_status", kind: "conditions", text: "soaked" }],
  ["repeating a known fact", { op: "add_known_fact", fact: "The gate is broken" }],
  ["adding an NPC who exists", { op: "add_npc", name: "Mara", appearance: "a stranger" }],
  ["updating an NPC who does not exist", { op: "update_npc", name: "Nobody", appearance: "towering" }],
  ["knowing an NPC who does not exist", { op: "add_known_npc", name: "Nobody" }],
  ["knowing an NPC twice", { op: "add_known_npc", name: "Mara" }],
])("the server refuses %s", async (_, operation) => {
  const { game, prompts } = play(
    narration(
      "Setup.",
      { op: "add_status", kind: "conditions", text: "soaked" },
      { op: "add_known_fact", fact: "The gate is broken" },
      { op: "add_npc", name: "Mara", appearance: "grey coat" },
      { op: "add_known_npc", name: "Mara" },
    ),
    narration("Refused.", operation),
    narration("Finished."),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "One." });
  expect((await game.post(`/saves/${id}/turns`, { input: "Two." })).status).toBe(502);
  expect((await game.post(`/saves/${id}/turns`, { input: "Three." })).status).toBe(201);

  expect(await snapshotAt(game, id, 4)).toEqual(await snapshotAt(game, id, 2));
  // The next prompt shows the secret NPC section, which REST cannot.
  expect(JSON.stringify(prompts[2])).toContain("grey coat");
  expect(JSON.stringify(prompts[2])).not.toContain("a stranger");
  expect(JSON.stringify(prompts[2])).not.toContain("towering");
});

test("a Narrator can update an NPC, and the next Turn's prompt carries the state", async () => {
  const { game, prompts } = play(
    narration(
      "Mara appears.",
      { op: "add_npc", name: "Mara", appearance: "grey coat" },
      { op: "update_npc", name: "Mara", appearance: "scarred, grey coat" },
    ),
    narration("Mara nods."),
  );
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I look around." });
  await game.post(`/saves/${id}/turns`, { input: "I greet her." });

  expect(JSON.stringify(prompts[1])).toContain("scarred, grey coat");
});

test("the Snapshot the player can read never contains the NPC section", async () => {
  const { game } = play(
    narration("Someone watches.", { op: "add_npc", name: "SECRET-SPY", appearance: "SECRET-COAT" }),
  );
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(JSON.stringify(await snapshotAt(game, id, 2))).not.toContain("SECRET");
});

test.each([
  ["a replace operation", narration("Everything changes.", { op: "replace_state", state: { inventory: {} } })],
  ["a malformed operation", narration("Everything changes.", { op: "add_item", item: "lantern" })],
])("%s returns 502 and writes nothing", async (_, reply) => {
  const { game } = play(reply);
  const id = await game.createSave();

  expect((await game.post(`/saves/${id}/turns`, { input: "I wait." })).status).toBe(502);
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("a whole state in the Narrator's reply is ignored", async () => {
  const { game } = play(
    JSON.stringify({
      narration: "You are suddenly rich.",
      state: { inventory: { wearing: [], carrying: ["gold crown"] } },
      inventory: { wearing: [], carrying: ["gold crown"] },
    }),
  );
  const id = await game.createSave();

  expect((await game.post(`/saves/${id}/turns`, { input: "I wish." })).status).toBe(201);
  expect(await snapshotAt(game, id, 2)).toMatchObject({ inventory: { wearing: [], carrying: [] } });
});

test("every Message has a Snapshot, and later Turns never change earlier ones", async () => {
  const { game } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
    narration("It breaks.", { op: "remove_item", item: "lantern" }),
  );
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I search." });
  const before = await Promise.all([1, 2].map((m) => snapshotAt(game, id, m)));
  await game.post(`/saves/${id}/turns`, { input: "I drop it." });
  await game.restart();

  expect(before[0]).toMatchObject({ inventory: { carrying: [] } });
  expect(before[1]).toMatchObject({ inventory: { carrying: ["lantern"] } });
  expect(await Promise.all([1, 2].map((m) => snapshotAt(game, id, m)))).toEqual(before);
  expect(await snapshotAt(game, id, 3)).toMatchObject({ inventory: { carrying: ["lantern"] } });
  expect(await snapshotAt(game, id, 4)).toMatchObject({ inventory: { carrying: [] } });
});

test.each(["0", "99", "0.5", "lantern"])("the Snapshot of Message %s returns 404", async (messageId) => {
  const { game } = play();
  const id = await game.createSave();

  expect((await game.get(`/saves/${id}/messages/${messageId}/snapshot`)).status).toBe(404);
});

test("an unchanged section is stored once however many Messages share it", async () => {
  const size = 1_000_000;
  const { game } = play(
    narration("A huge scroll.", { op: "add_item", slot: "carrying", item: "x".repeat(size) }),
    ...Array.from({ length: 20 }, () => narration("Time passes.")),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I take it." });
  const fileSize = () => statSync(join(savesDir, `${id}.sqlite`)).size;
  const before = fileSize();

  for (let turn = 0; turn < 20; turn++) await game.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(fileSize() - before).toBeLessThan(size / 10);
  expect(await snapshotAt(game, id, 42)).toMatchObject({ inventory: { carrying: ["x".repeat(size)] } });
});

const messageTexts = async (game: ReturnType<typeof startGame>, id: string) => {
  const { messages } = (await game.get(`/saves/${id}/messages`).then((r) => r.json())) as {
    messages: { text: string }[];
  };
  return messages.map((message) => message.text);
};

test("Revert reports what it would delete, then restores that Message's Snapshot without the Text Provider", async () => {
  const { game, prompts } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
    narration("It breaks.", { op: "remove_item", item: "lantern" }),
    narration("You walk on."),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });
  await game.post(`/saves/${id}/turns`, { input: "I drop it." });

  const preview = await game.get(`/saves/${id}/messages/2/revert`).then((r) => r.json());

  expect(preview).toEqual({ messages: 2, images: 0 });
  expect(await messageTexts(game, id)).toHaveLength(4);

  const response = await game.post(`/saves/${id}/messages/2/revert`, {});

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ messages: 2, images: 0 });
  expect(prompts).toHaveLength(2);
  expect(await messageTexts(game, id)).toEqual(["I search.", "A lantern."]);
  expect((await game.get(`/saves/${id}/messages/4/snapshot`)).status).toBe(404);

  await game.post(`/saves/${id}/turns`, { input: "I walk." });

  expect(JSON.stringify(prompts[2])).toContain('\\"carrying\\":[\\"lantern\\"]');
  expect(await messageTexts(game, id)).toEqual(["I search.", "A lantern.", "I walk.", "You walk on."]);
});

test("Reverting to the latest Message deletes nothing", async () => {
  const { game } = play(narration("The tide rises."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const response = await game.post(`/saves/${id}/messages/2/revert`, {});

  expect(await response.json()).toEqual({ messages: 0, images: 0 });
  expect(await messageTexts(game, id)).toHaveLength(2);
});

test.each(["0", "99", "lantern"])("Reverting to Message %s returns 404 and deletes nothing", async (messageId) => {
  const { game } = play(narration("The tide rises."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  expect((await game.get(`/saves/${id}/messages/${messageId}/revert`)).status).toBe(404);
  expect((await game.post(`/saves/${id}/messages/${messageId}/revert`, {})).status).toBe(404);
  expect(await messageTexts(game, id)).toHaveLength(2);
});

test("a non-JSON Revert is rejected, so other websites cannot delete a story", async () => {
  const { game } = play(narration("The tide rises."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const response = await fetch(game.url(`/saves/${id}/messages/1/revert`), { method: "POST" });

  expect(response.status).toBe(400);
  expect(await messageTexts(game, id)).toHaveLength(2);
});

const saveFileText = (id: string) => readFileSync(join(savesDir, `${id}.sqlite`), "latin1");

test("Revert sweeps orphaned Snapshot sections, and sections remaining Messages share survive", async () => {
  const { game } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "SHARED-SECTION" }),
    narration("You sicken.", { op: "set_health", health: "ORPHANED-SECTION" }),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });
  const kept = await snapshotAt(game, id, 2);
  await game.post(`/saves/${id}/turns`, { input: "I wait." });
  expect(saveFileText(id)).toContain("ORPHANED-SECTION");

  // Messages 3 and 4 still share the inventory section first written for Message 2.
  await game.post(`/saves/${id}/messages/2/revert`, {});

  expect(await snapshotAt(game, id, 2)).toEqual(kept);
  expect(kept).toMatchObject({ inventory: { carrying: ["SHARED-SECTION"] } });
  expect(saveFileText(id)).not.toContain("ORPHANED-SECTION");
});

test("a Revert that fails partway deletes nothing", async () => {
  const { game } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
    narration("You sicken.", { op: "set_health", health: "sick" }),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });
  await game.post(`/saves/${id}/turns`, { input: "I wait." });
  {
    // Sweeping is the last step, so failing it proves the earlier deletes roll back.
    using db = new Database(join(savesDir, `${id}.sqlite`));
    db.run(`CREATE TRIGGER fail_sweep BEFORE DELETE ON sections BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  }

  const response = await game.post(`/saves/${id}/messages/2/revert`, {});

  expect(response.status).toBe(500);
  expect(await messageTexts(game, id)).toHaveLength(4);
  expect(await snapshotAt(game, id, 4)).toMatchObject({ status: { health: "sick" } });
});

const duplicate = async (game: ReturnType<typeof startGame>, id: string, body: object = {}) => {
  const response = await game.post(`/saves/${id}/duplicate`, body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

test("a duplicated Save is whole and independent of the original", async () => {
  const { game } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
    narration("In the copy."),
    narration("In the original."),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });

  const copy = await duplicate(game, id);

  expect(copy).not.toBe(id);
  expect(readdirSync(savesDir).toSorted()).toEqual([`${id}.sqlite`, `${copy}.sqlite`].toSorted());
  expect(await snapshotAt(game, copy, 2)).toEqual(await snapshotAt(game, id, 2));

  await game.post(`/saves/${copy}/turns`, { input: "Copy." });
  await game.post(`/saves/${id}/messages/1/revert`, {});
  await game.post(`/saves/${id}/turns`, { input: "Original." });

  expect(await messageTexts(game, copy)).toEqual(["I search.", "A lantern.", "Copy.", "In the copy."]);
  expect(await messageTexts(game, id)).toEqual(["I search.", "Original.", "In the original."]);
});

test("duplicating from a Message makes a Save that ends there and leaves the original whole", async () => {
  const { game, prompts } = play(
    narration("A lantern.", { op: "add_item", slot: "carrying", item: "lantern" }),
    narration("You sicken.", { op: "set_health", health: "LATER-SECTION" }),
    narration("You walk on."),
  );
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const copy = await duplicate(game, id, { fromMessage: 2 });

  expect(await messageTexts(game, id)).toHaveLength(4);
  expect(await messageTexts(game, copy)).toEqual(["I search.", "A lantern."]);
  expect(saveFileText(copy)).not.toContain("LATER-SECTION");

  await game.post(`/saves/${copy}/turns`, { input: "I walk." });

  expect(JSON.stringify(prompts[2])).toContain('\\"carrying\\":[\\"lantern\\"]');
  expect(JSON.stringify(prompts[2])).toContain('\\"health\\":\\"unhurt\\"');
});

test("duplicating from an unknown Message returns 404 and makes no Save", async () => {
  const { game } = play();
  const id = await game.createSave();

  expect((await game.post(`/saves/${id}/duplicate`, { fromMessage: 99 })).status).toBe(404);
  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
});

test("a non-JSON duplicate is rejected and makes no Save", async () => {
  const { game } = play();
  const id = await game.createSave();

  const response = await fetch(game.url(`/saves/${id}/duplicate`), { method: "POST" });

  expect(response.status).toBe(400);
  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
});

test("a Turn still in flight when a Revert happens is refused, so the deleted future cannot return", async () => {
  const stale = Promise.withResolvers<string>();
  const replies = [Promise.resolve(narration("A lantern.")), Promise.resolve(narration("Next.")), stale.promise];
  game = startGame(savesDir, () => replies.shift()!);
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I search." });
  await game.post(`/saves/${id}/turns`, { input: "I wait." });
  const turn = game.post(`/saves/${id}/turns`, { input: "I press on." });
  await Bun.sleep(50);

  await game.post(`/saves/${id}/messages/2/revert`, {});
  stale.resolve(narration("Written for the deleted future."));

  expect((await turn).status).toBe(409);
  expect(await messageTexts(game, id)).toEqual(["I search.", "A lantern."]);
});
