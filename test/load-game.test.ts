import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_IMPORT_BYTES, type Message } from "../src/save-store";
import type { ListedSave } from "../src/web/api";
import { narration, scriptedTextProvider, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let game: ReturnType<typeof startGame>;
let prompts: ReturnType<typeof scriptedTextProvider>["prompts"];

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  game = startGame(savesDir, script.textProvider);
  prompts = script.prompts;
};

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const savePath = (id: string) => join(savesDir, `${id}.sqlite`);

const listed = async () => ((await game.get("/saves").then((r) => r.json())) as { saves: ListedSave[] }).saves;
const listedIds = async () => (await listed()).map(({ id }) => id).sort();

const messagesOf = async (id: string) =>
  ((await game.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: Message[] })
    .messages;

const exportSave = async (id: string) => (await game.get(`/saves/${id}/export`)).bytes();

const importSave = (bytes: Uint8Array<ArrayBuffer>, contentType = "application/octet-stream") =>
  fetch(game.url("/saves/import"), { method: "POST", headers: { "Content-Type": contentType }, body: bytes });

const importedId = async (bytes: Uint8Array<ArrayBuffer>) =>
  ((await (await importSave(bytes)).json()) as { id: string }).id;

test("the list shows every Save, most recently played first", async () => {
  play(narration("The tide rises."));
  const first = await game.createSave();
  const second = await game.post("/saves", { worldBrief: "A frozen moon", pc: { name: "Wren" } });
  const { id: secondId } = (await second.json()) as { id: string };
  await Bun.sleep(5);
  await game.post(`/saves/${first}/turns`, { input: "I wade forward." });

  const saves = await listed();

  expect(saves.map(({ id }) => id)).toEqual([first, secondId]);
  expect(saves[0]).toMatchObject({ worldBrief: "A drowned city", pc: { name: "Ash" } });
  expect(saves[1]).toMatchObject({ worldBrief: "A frozen moon", pc: { name: "Wren" } });
});

test("the list starts empty", async () => {
  play();

  expect(await listed()).toEqual([]);
});

test("a file in the Saves folder that can't be opened is listed as unreadable and can still be deleted", async () => {
  play();
  const good = await game.createSave();
  const bad = crypto.randomUUID();
  writeFileSync(savePath(bad), "not a database");
  writeFileSync(join(savesDir, "notes.sqlite"), "not ours");

  const saves = await listed();

  expect(saves.map(({ id }) => id).sort()).toEqual([good, bad].sort());
  expect(saves.find(({ id }) => id === bad)).toMatchObject({ unreadable: true });
  expect((await game.delete(`/saves/${bad}`)).status).toBe(204);
  expect(await listedIds()).toEqual([good]);
});

test("a whole duplicate appears in the list as its own Save", async () => {
  play();
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/duplicate`, {});

  const { id: copy } = (await response.json()) as { id: string };
  expect(await listedIds()).toEqual([id, copy].sort());
});

test("deleting a Save also removes what a crash left beside it", async () => {
  play();
  const id = await game.createSave();
  writeFileSync(`${savePath(id)}-journal`, "story text");
  writeFileSync(`${savePath(id)}-wal`, "story text");

  await game.delete(`/saves/${id}`);

  expect(readdirSync(savesDir)).toEqual([]);
});

test("deleting a Save removes its file and nothing else", async () => {
  play();
  const doomed = await game.createSave();
  const kept = await game.createSave();

  const response = await game.delete(`/saves/${doomed}`);

  expect(response.status).toBe(204);
  expect(readdirSync(savesDir)).toEqual([`${kept}.sqlite`]);
  expect((await game.get(`/saves/${doomed}`)).status).toBe(404);
  expect((await game.delete(`/saves/${doomed}`)).status).toBe(404);
});

test("a route refuses anything that isn't a Save id, so no path can reach outside the Saves folder", async () => {
  play();
  const outside = join(folder.path, "outside.sqlite");
  writeFileSync(outside, "keep me");
  const id = await game.createSave();

  for (const badId of ["not-a-uuid", "..%2Foutside", "..%5Coutside", `${id}%2F..%2F..%2Foutside`, `${id}.sqlite`]) {
    expect((await game.delete(`/saves/${badId}`)).status).toBe(404);
    expect((await game.get(`/saves/${badId}/export`)).status).toBe(404);
    expect((await game.post(`/saves/${badId}/duplicate`, {})).status).toBe(404);
  }

  expect(readFileSync(outside, "utf8")).toBe("keep me");
  expect(await listedIds()).toEqual([id]);
});

test("an exported Save imports as a new Save with the same story", async () => {
  play(narration("The tide rises."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  const exported = await game.get(`/saves/${id}/export`);
  expect(exported.headers.get("content-disposition")).toStartWith("attachment");
  const response = await importSave(await exported.bytes());

  expect(response.status).toBe(201);
  const { id: copy } = (await response.json()) as { id: string };
  expect(copy).not.toBe(id);
  expect(await listedIds()).toEqual([id, copy].sort());
  expect(await messagesOf(copy)).toEqual(await messagesOf(id));
  expect(await game.get(`/saves/${copy}`).then((r) => r.json())).toEqual({ title: "", worldBrief: "A drowned city", pc: { name: "Ash" }, artStyle: "", startingHook: "", hasCover: false, coverRedraws: 0 });
});

test("importing the same file twice gives two Saves", async () => {
  play();
  const id = await game.createSave();
  const bytes = await exportSave(id);

  const one = await importedId(bytes);
  const two = await importedId(bytes);

  expect(new Set([id, one, two]).size).toBe(3);
});

test("an export leaves no file behind and carries a Reverted future in no form", async () => {
  play(narration("A secret future."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wade forward." });
  await game.post(`/saves/${id}/messages/1/revert`, {});

  const bytes = await exportSave(id);

  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
  expect(Buffer.from(bytes).toString("latin1")).not.toContain("A secret future.");
});

test("an export holds everything even when a crash left the data in a WAL file beside the Save", async () => {
  play();
  const id = await game.createSave();
  const crashed = crypto.randomUUID();
  {
    using live = new Database(savePath(id));
    live.run("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    live.run("UPDATE save SET pc_name = 'Only in the WAL'");
    copyFileSync(savePath(id), savePath(crashed));
    copyFileSync(`${savePath(id)}-wal`, `${savePath(crashed)}-wal`);
  }

  const copy = await importedId(await exportSave(crashed));

  const save = (await game.get(`/saves/${copy}`).then((r) => r.json())) as { pc: { name: string } };
  expect(save.pc.name).toBe("Only in the WAL");
  expect(readdirSync(savesDir).filter((name) => /-(wal|shm|journal)$/.test(name))).toEqual([]);
});

/** The schema as it stood before Checks, Director's Notes and the World sections existed. */
const SCHEMA_BEFORE_CHECKS = `
  CREATE TABLE save (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    world_brief TEXT NOT NULL,
    pc_name TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('player', 'narrator')),
    text TEXT NOT NULL
  );
  CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL
  );
  CREATE TABLE snapshot_sections (
    message_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections (id),
    PRIMARY KEY (message_id, name)
  ) WITHOUT ROWID;
`;

const OLD_OPENING = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  pcKnown: { facts: [], npcs: [] },
};
const OLD_LATEST = {
  ...OLD_OPENING,
  inventory: { wearing: [], carrying: ["rope"] },
  pcKnown: { facts: ["The city is flooded."], npcs: [] },
};

/** One played Turn in the old format, written by hand as that version of the game would have. */
function writeOldSave(path: string) {
  using db = new Database(path, { create: true });
  db.run(SCHEMA_BEFORE_CHECKS);
  db.run("INSERT INTO save (id, world_brief, pc_name) VALUES (1, 'A drowned city', 'Ash')");
  db.run("INSERT INTO messages (role, text) VALUES ('player', 'I wade forward.'), ('narrator', 'You find a rope.')");
  for (const [messageId, state] of [[0, OLD_OPENING], [1, OLD_OPENING], [2, OLD_LATEST]] as const) {
    for (const [name, value] of Object.entries(state)) {
      const { id } = db
        .query<{ id: number }, [string]>("INSERT INTO sections (content) VALUES (?) RETURNING id")
        .get(JSON.stringify(value))!;
      db.run("INSERT INTO snapshot_sections VALUES (?, ?, ?)", [messageId, name, id]);
    }
  }
}

const oldSave = () => {
  const id = crypto.randomUUID();
  writeOldSave(savePath(id));
  return id;
};

test("an old Save opens with its story and Snapshots whole, and keeps playing", async () => {
  play(narration("The rope holds."));
  const id = oldSave();

  expect((await listed())[0]).toMatchObject({ id, pc: { name: "Ash" } });
  expect(await messagesOf(id)).toEqual([
    { id: 1, role: "player", text: "I wade forward." },
    { id: 2, role: "narrator", text: "You find a rope." },
  ]);
  expect(await game.get(`/saves/${id}/inventory`).then((r) => r.json())).toEqual({ wearing: [], carrying: ["rope"] });
  const snapshot = await game.get(`/saves/${id}/messages/1/snapshot`).then((r) => r.json());
  expect(snapshot).toMatchObject({ inventory: { carrying: [] } });
  expect(await game.get(`/saves/${id}/journal`).then((r) => r.json())).toMatchObject({
    summary: "",
    facts: ["The city is flooded."],
  });

  const added = await game.post(`/saves/${id}/notes`, { text: "The rope is frayed." });
  const turn = await game.post(`/saves/${id}/turns`, { input: "I climb." });

  expect(added.status).toBe(201);
  expect(turn.status).toBe(201);
  expect(JSON.stringify(prompts[0])).not.toContain("The rope is frayed.");
  expect(await messagesOf(id)).toHaveLength(4);
  const reverted = await game.post(`/saves/${id}/messages/2/revert`, {});
  expect(reverted.status).toBe(200);
  expect(await game.get(`/saves/${id}/notes`).then((r) => r.json())).toEqual({ notes: [] });
});

test("an old Turn can be Regenerated, staying without a Check", async () => {
  play(narration("A knife instead."));
  const id = oldSave();

  const response = await game.post(`/saves/${id}/messages/2/regenerate`, {});

  expect(response.status).toBe(201);
  expect((await messagesOf(id)).map(({ text }) => text)).toEqual(["I wade forward.", "A knife instead."]);
});

test("a Save from before Snapshots existed gets them, and keeps playing", async () => {
  play(narration("The tide rises."));
  const id = crypto.randomUUID();
  {
    using db = new Database(savePath(id), { create: true });
    db.run(`
      CREATE TABLE save (id INTEGER PRIMARY KEY CHECK (id = 1), world_brief TEXT NOT NULL, pc_name TEXT NOT NULL);
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('player', 'narrator')),
        text TEXT NOT NULL
      );
      INSERT INTO save VALUES (1, 'A drowned city', 'Ash');
      INSERT INTO messages (role, text) VALUES ('player', 'I wade forward.'), ('narrator', 'Rain falls.');
    `);
  }

  expect((await game.get(`/saves/${id}/messages/2/snapshot`)).status).toBe(200);
  expect((await game.post(`/saves/${id}/turns`, { input: "I climb." })).status).toBe(201);
});

test("a migration that fails leaves the old Save byte for byte as it was", async () => {
  play();
  const id = oldSave();
  {
    using db = new Database(savePath(id));
    db.run("CREATE TRIGGER stop_migration BEFORE INSERT ON sections BEGIN SELECT RAISE(ABORT, 'no'); END");
  }
  const before = readFileSync(savePath(id));

  const response = await game.get(`/saves/${id}`);

  expect(response.status).toBe(500);
  expect(readFileSync(savePath(id)).equals(before)).toBe(true);
  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
  expect((await listed())[0]).toMatchObject({ id, unreadable: true });
});

test("a migrated Save is not migrated again, so reading it leaves the file alone", async () => {
  play();
  const id = oldSave();
  await game.get(`/saves/${id}`);
  const migrated = readFileSync(savePath(id));

  await game.get(`/saves/${id}/messages`);

  expect(readFileSync(savePath(id)).equals(migrated)).toBe(true);
});

const schemaVersion = (path: string) => {
  using db = new Database(path);
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
};

function setSchemaVersion(path: string, version: number) {
  using db = new Database(path);
  db.run(`PRAGMA user_version = ${version}`);
}

test("a Save from a newer version of the game is refused and left alone", async () => {
  play();
  const id = await game.createSave();
  setSchemaVersion(savePath(id), schemaVersion(savePath(id)) + 1);
  const before = readFileSync(savePath(id));

  const response = await game.get(`/saves/${id}`);

  expect(response.status).toBe(422);
  expect(((await response.json()) as { error: string }).error).toContain("newer");
  expect(readFileSync(savePath(id)).equals(before)).toBe(true);
});

test("a Save records its schema version, and a duplicate and an export keep it", async () => {
  play();
  const id = await game.createSave();

  const { id: copy } = (await (await game.post(`/saves/${id}/duplicate`, {})).json()) as { id: string };
  const imported = await importedId(await exportSave(id));

  expect(schemaVersion(savePath(id))).toBeGreaterThan(0);
  expect(schemaVersion(savePath(copy))).toBe(schemaVersion(savePath(id)));
  expect(schemaVersion(savePath(imported))).toBe(schemaVersion(savePath(id)));
});

/** A real export, changed by `tamper` as a hostile or damaged file might be. */
async function tamperedExport(tamper: (db: Database, path: string) => void) {
  const path = join(folder.path, "tampered.sqlite");
  const id = await game.createSave();
  writeFileSync(path, await exportSave(id));
  {
    using db = new Database(path);
    tamper(db, path);
  }
  const bytes = new Uint8Array(readFileSync(path));
  await game.delete(`/saves/${id}`);
  return bytes;
}

async function expectRefused(bytes: Uint8Array<ArrayBuffer>) {
  const kept = await game.createSave();
  const before = readFileSync(savePath(kept));

  const response = await importSave(bytes);

  expect(response.status).toBe(422);
  expect(((await response.json()) as { error: string }).error).not.toContain("SQL");
  expect(readdirSync(savesDir)).toEqual([`${kept}.sqlite`]);
  expect(readFileSync(savePath(kept)).equals(before)).toBe(true);
}

const text = (content: string) => new TextEncoder().encode(content);

test.each([
  ["an empty file", new Uint8Array(0)],
  ["bytes that aren't SQLite", text("This is not a Save.".repeat(100))],
  ["a file too large to be a Save", new Uint8Array(MAX_IMPORT_BYTES + 1)],
])("import refuses %s", async (_name, bytes) => {
  play();
  await expectRefused(bytes as Uint8Array<ArrayBuffer>);
});

test("import refuses a SQLite file with some other schema", async () => {
  play();
  const path = join(folder.path, "other.sqlite");
  {
    using db = new Database(path, { create: true });
    db.run("CREATE TABLE recipes (name TEXT)");
  }
  await expectRefused(new Uint8Array(readFileSync(path)));
});

test("import refuses a SQLite file with no tables", async () => {
  play();
  const path = join(folder.path, "empty.sqlite");
  {
    using db = new Database(path, { create: true });
    db.run("PRAGMA user_version = 1; VACUUM");
  }
  await expectRefused(new Uint8Array(readFileSync(path)));
});

test("import refuses a Save cut short", async () => {
  play();
  const id = await game.createSave();
  const bytes = await exportSave(id);
  await game.delete(`/saves/${id}`);

  await expectRefused(bytes.slice(0, bytes.length - 4096));
});

const PNG_SQL = "x'89504e470d0a1a0a00'";

/** Adds a Turn and a Scene Image on `messageId`. */
const withImage = (messageId: number, bytesSql: string) => (db: Database) => {
  db.run("INSERT INTO messages (role, text) VALUES ('player', 'Hello'), ('narrator', 'Hi')");
  db.run("INSERT INTO snapshot_sections SELECT 1, name, section_id FROM snapshot_sections WHERE message_id = 0");
  db.run("INSERT INTO snapshot_sections SELECT 2, name, section_id FROM snapshot_sections WHERE message_id = 0");
  db.run(`INSERT INTO scene_images (message_id, caption, bytes) VALUES (${messageId}, 'A pier', ${bytesSql})`);
};

/** Adds a Turn and a portrait drawn by `messageId`. */
const withPortrait = (messageId: number, npc: string, bytesSql: string) => (db: Database) => {
  db.run("INSERT INTO messages (role, text) VALUES ('player', 'Hello'), ('narrator', 'Hi')");
  db.run("INSERT INTO snapshot_sections SELECT 1, name, section_id FROM snapshot_sections WHERE message_id = 0");
  db.run("INSERT INTO snapshot_sections SELECT 2, name, section_id FROM snapshot_sections WHERE message_id = 0");
  db.run(`INSERT INTO portraits (npc, message_id, bytes) VALUES (${npc}, ${messageId}, ${bytesSql})`);
};

const TAMPERED: [string, (db: Database) => void][] = [
  ["a Save with no Art Style column", (db) => db.run("ALTER TABLE save DROP COLUMN art_style")],
  ["a Save with no Starting Hook column", (db) => db.run("ALTER TABLE save DROP COLUMN starting_hook")],
  ["a Save with no PC details column", (db) => db.run("ALTER TABLE save DROP COLUMN pc_details")],
  ["malformed PC details", (db) => db.run(`UPDATE save SET pc_details = '{"background":1}'`)],
  ["PC details that try to replace the name", (db) => db.run(`UPDATE save SET pc_details = '{"name":{"x":1}}'`)],
  ["a Save from a newer version", (db) => db.run("PRAGMA user_version = 9999")],
  ["a negative version", (db) => db.run("PRAGMA user_version = -1")],
  ["an unparsable Snapshot section", (db) => db.run("UPDATE sections SET content = '{nope'")],
  ["a Snapshot section of the wrong shape", (db) => db.run(`UPDATE sections SET content = '{"wearing":1}'`)],
  ["a Snapshot section with an unknown name", (db) => db.run("UPDATE snapshot_sections SET name = 'secrets' WHERE name = 'npcs'")],
  ["a Snapshot pointing at no section", (db) => db.run("UPDATE snapshot_sections SET section_id = 999 WHERE name = 'npcs'")],
  ["a Snapshot missing a section", (db) => db.run("DELETE FROM snapshot_sections WHERE name = 'npcs'")],
  ["a Snapshot for no Message", (db) => db.run("INSERT INTO snapshot_sections SELECT 9, name, section_id FROM snapshot_sections")],
  ["a Message with no Snapshot", (db) => db.run("INSERT INTO messages (role, text) VALUES ('player', 'Hello')")],
  ["a malformed Check", (db) => {
    db.run("INSERT INTO messages (role, text) VALUES ('player', 'Hello')");
    db.run("INSERT INTO messages (role, text, hidden_check) VALUES ('narrator', 'Hi', '{\"roll\":\"six\"}')");
    db.run("INSERT INTO snapshot_sections SELECT 1, name, section_id FROM snapshot_sections WHERE message_id = 0");
    db.run("INSERT INTO snapshot_sections SELECT 2, name, section_id FROM snapshot_sections WHERE message_id = 0");
  }],
  ["a Narrator Message with no player Message before it", (db) => {
    db.run("INSERT INTO messages (role, text) VALUES ('narrator', 'Hi')");
    db.run("INSERT INTO snapshot_sections SELECT 1, name, section_id FROM snapshot_sections");
  }],
  ["no Scene Image table", (db) => db.run("DROP TABLE scene_images")],
  ["an extra Scene Image column", (db) => db.run("ALTER TABLE scene_images ADD COLUMN extra TEXT")],
  ["a Scene Image that is really HTML", withImage(2, "x'3c21646f63747970652068746d6c3e'")],
  ["a Scene Image that is really SVG", withImage(2, "cast('<svg xmlns=\"http://www.w3.org/2000/svg\"/>' AS BLOB)")],
  ["a Scene Image cut short of its signature", withImage(2, "x'89504e47'")],
  ["a Scene Image stored as text", withImage(2, "'not bytes'")],
  ["a Scene Image too large to be one", withImage(2, "x'89504e470d0a1a0a' || zeroblob(33 * 1024 * 1024)")],
  ["a Scene Image for no Message", withImage(9, PNG_SQL)],
  ["a Scene Image on a player Message", withImage(1, PNG_SQL)],
  ["a caption that isn't text", (db) => {
    withImage(2, PNG_SQL)(db);
    db.run("UPDATE scene_images SET caption = x'00ff'");
  }],
  ["no portrait table", (db) => db.run("DROP TABLE portraits")],
  ["an extra portrait column", (db) => db.run("ALTER TABLE portraits ADD COLUMN extra TEXT")],
  ["a portrait that is really HTML", withPortrait(2, "'Hesper'", "x'3c21646f63747970652068746d6c3e'")],
  ["a portrait that is really SVG", withPortrait(2, "'Hesper'", "cast('<svg xmlns=\"http://www.w3.org/2000/svg\"/>' AS BLOB)")],
  ["a portrait stored as text", withPortrait(2, "'Hesper'", "'not bytes'")],
  ["a portrait too large to be one", withPortrait(2, "'Hesper'", "x'89504e470d0a1a0a' || zeroblob(33 * 1024 * 1024)")],
  ["a portrait for no Message", withPortrait(9, "'Hesper'", PNG_SQL)],
  ["an NPC portrait on a player Message", withPortrait(1, "'Hesper'", PNG_SQL)],
  ["a PC portrait tied to a Message", withPortrait(2, "NULL", PNG_SQL)],
  ["two PC portraits", (db) => {
    db.run(`INSERT INTO portraits (npc, message_id, bytes) VALUES (NULL, 0, ${PNG_SQL}), (NULL, 0, ${PNG_SQL})`);
  }],
  ["malformed pending Notes", (db) => db.run("UPDATE save SET pending_notes = '[1]'")],
  ["a world brief that isn't text", (db) => db.run("UPDATE save SET world_brief = x'00ff'")],
  ["no save row", (db) => db.run("DELETE FROM save")],
  ["an extra table", (db) => db.run("CREATE TABLE extra (x)")],
  ["an extra column", (db) => db.run("ALTER TABLE messages ADD COLUMN extra TEXT")],
  ["a generated column", (db) => db.run("ALTER TABLE save ADD COLUMN extra GENERATED ALWAYS AS (1)")],
  ["a trigger", (db) => db.run("CREATE TRIGGER wipe AFTER INSERT ON messages BEGIN DELETE FROM messages; END")],
  ["a view", (db) => db.run("CREATE VIEW extra AS SELECT 1")],
  ["an index on an expression", (db) => db.run("CREATE INDEX extra ON messages (lower(text))")],
  ["a table swapped for a view", (db) => {
    db.run("ALTER TABLE save RENAME TO hidden");
    db.run("CREATE VIEW save AS SELECT * FROM hidden");
  }],
];

test.each(TAMPERED)("import refuses %s", async (_name, tamper) => {
  play();
  await expectRefused(await tamperedExport(tamper));
});

test("import refuses a file left in WAL mode", async () => {
  play();
  await expectRefused(await tamperedExport((db) => db.run("PRAGMA journal_mode = WAL")));
});

test("Director's Notes waiting for the next Message survive an export and import", async () => {
  play();
  const id = await game.createSave();
  await game.post(`/saves/${id}/notes`, { text: "The rope is frayed." });

  const copy = await importedId(await exportSave(id));

  expect(await game.get(`/saves/${copy}/notes`).then((r) => r.json())).toEqual({ notes: ["The rope is frayed."] });
});

test("a Message can follow a player Message that a Revert left unanswered", async () => {
  play(narration("One."), narration("Two."));
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "First." });
  await game.post(`/saves/${id}/messages/1/revert`, {});
  await game.post(`/saves/${id}/turns`, { input: "Second." });

  expect((await importSave(await exportSave(id))).status).toBe(201);
});

const TABLE_TRICKS: [string, (db: Database) => void][] = [
  ["a CHECK that stops new Messages", (db) => {
    db.run("DROP TABLE messages");
    db.run("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, text TEXT, hidden_check TEXT, CHECK (id < 1))");
  }],
  ["Message ids with no primary key", (db) => {
    db.run("DROP TABLE messages");
    db.run("CREATE TABLE messages (id INTEGER, role TEXT, text TEXT, hidden_check TEXT)");
  }],
  ["a generated column", (db) => {
    db.run("DROP TABLE messages");
    db.run("CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, hidden_check TEXT, text TEXT AS ('x'))");
  }],
  ["an exhausted id sequence", (db) => {
    db.run("INSERT INTO messages (role, text) VALUES ('player', 'Hello')");
    db.run("DELETE FROM messages");
    db.run("UPDATE sqlite_sequence SET seq = 9223372036854775807 WHERE name = 'messages'");
  }],
];

test.each(TABLE_TRICKS)("a file with %s imports into the game's own tables, and plays", async (_name, tamper) => {
  play(narration("The tide rises."));
  const id = await importedId(await tamperedExport(tamper));

  const turn = await game.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(turn.status).toBe(201);
  expect((await messagesOf(id)).map(({ id }) => id)).toEqual([1, 2]);
});

test("import takes no id or path from the file", async () => {
  play();
  const bytes = await tamperedExport((db) => db.run("UPDATE save SET world_brief = '../../evil', pc_name = '..\\evil'"));

  const id = await importedId(bytes);

  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
  expect(readdirSync(folder.path).sort()).toEqual(["Saves", "tampered.sqlite"]);
});

test("import takes an old Save and migrates it", async () => {
  play(narration("The rope holds."));
  const path = join(folder.path, "old.sqlite");
  writeOldSave(path);

  const id = await importedId(new Uint8Array(readFileSync(path)));

  expect(await messagesOf(id)).toHaveLength(2);
  expect((await game.post(`/saves/${id}/turns`, { input: "I climb." })).status).toBe(201);
  expect(schemaVersion(savePath(id))).toBeGreaterThan(0);
});

test("an old file that breaks its own migration is refused on import", async () => {
  play();
  const path = join(folder.path, "old.sqlite");
  writeOldSave(path);
  {
    using db = new Database(path);
    db.run("DROP TABLE snapshot_sections");
    db.run("CREATE TABLE snapshot_sections (message_id INTEGER, name TEXT, section_id INTEGER, CHECK (name = 'never'))");
  }

  await expectRefused(new Uint8Array(readFileSync(path)));
});

test("import only accepts the binary content type, which no form on another site can send", async () => {
  play();
  const id = await game.createSave();
  const bytes = await exportSave(id);

  const response = await importSave(bytes, "text/plain");

  expect(response.status).toBe(415);
  expect(readdirSync(savesDir)).toEqual([`${id}.sqlite`]);
});
