import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { openingState, type State } from "./state-applier";

export type Save = { worldBrief: string; pc: { name: string } };

export class SaveNotFound extends Error {}
export class MessageNotFound extends Error {}

const SCHEMA = `
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

// Message ids start at 1, so this Snapshot holds the state before the first Message.
const OPENING_SNAPSHOT = 0;

type SectionRow = { name: string; id: number; content: string };

const sectionsAt = (db: Database, messageId: number) =>
  db
    .query<SectionRow, [number]>(
      `SELECT name, sections.id, content FROM snapshot_sections
       JOIN sections ON sections.id = section_id WHERE message_id = ?`,
    )
    .all(messageId);

const latestSections = (db: Database) =>
  sectionsAt(
    db,
    db.query<{ id: number }, []>("SELECT coalesce(max(message_id), 0) AS id FROM snapshot_sections").get()!.id,
  );

const toState = (sections: SectionRow[]) =>
  Object.fromEntries(sections.map(({ name, content }) => [name, JSON.parse(content)])) as State;

/** Links a section the latest Snapshot already holds rather than storing it again, and never rewrites one. */
function writeSnapshot(db: Database, messageId: number, state: State) {
  const latest = latestSections(db);
  for (const [name, value] of Object.entries(state)) {
    const content = JSON.stringify(value);
    const unchanged = latest.find((section) => section.name === name && section.content === content);
    const sectionId =
      unchanged?.id ??
      db.query<{ id: number }, [string]>("INSERT INTO sections (content) VALUES (?) RETURNING id").get(content)!.id;
    db.run("INSERT INTO snapshot_sections (message_id, name, section_id) VALUES (?, ?, ?)", [
      messageId,
      name,
      sectionId,
    ]);
  }
}

export type SaveStore = ReturnType<typeof saveStore>;
export type Message = { id: number; role: "player" | "narrator"; text: string };

export function saveStore(savesDir: string) {
  mkdirSync(savesDir, { recursive: true });
  const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);

  const connect = (path: string) => {
    const db = new Database(path, { create: true, strict: true });
    db.run("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
    return db;
  };

  const open = (id: string) => {
    // The id becomes a filename, so anything but a uuid must never reach the filesystem.
    if (!z.uuid().safeParse(id).success || !existsSync(pathOf(id))) throw new SaveNotFound();
    return connect(pathOf(id));
  };

  return {
    create({ worldBrief, pc }: Save) {
      const id = crypto.randomUUID();
      const unfinishedPath = `${pathOf(id)}.unfinished`;
      {
        using db = connect(unfinishedPath);
        db.transaction(() => {
          db.run(SCHEMA);
          db.run("INSERT INTO save (id, world_brief, pc_name) VALUES (1, ?, ?)", [worldBrief, pc.name]);
          writeSnapshot(db, OPENING_SNAPSHOT, openingState);
        })();
      }
      // Renaming last means a crash can never leave a half-built file that looks like a Save.
      renameSync(unfinishedPath, pathOf(id));
      return id;
    },

    read(id: string): Save {
      using db = open(id);
      const save = db
        .query<{ world_brief: string; pc_name: string }, []>("SELECT world_brief, pc_name FROM save")
        .get()!;
      return { worldBrief: save.world_brief, pc: { name: save.pc_name } };
    },

    messages(id: string) {
      using db = open(id);
      return db.query<Message, []>("SELECT id, role, text FROM messages ORDER BY id").all();
    },

    latestState(id: string) {
      using db = open(id);
      return toState(latestSections(db));
    },

    snapshot(id: string, messageId: number) {
      using db = open(id);
      const sections = sectionsAt(db, messageId);
      if (messageId === OPENING_SNAPSHOT || sections.length === 0) throw new MessageNotFound();
      return toState(sections);
    },

    /** `advance` runs inside the transaction, so it always sees the latest state. */
    commitTurn(id: string, input: string, narration: string, advance: (state: State) => State) {
      using db = open(id);
      const insert = db.query<Message, [Message["role"], string]>(
        "INSERT INTO messages (role, text) VALUES (?, ?) RETURNING id, role, text",
      );
      return db.transaction(() => {
        const state = toState(latestSections(db));
        const player = insert.get("player", input)!;
        writeSnapshot(db, player.id, state);
        const narrator = insert.get("narrator", narration)!;
        writeSnapshot(db, narrator.id, advance(state));
        return [player, narrator];
      })();
    },
  };
}
