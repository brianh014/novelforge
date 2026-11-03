import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export type Save = { worldBrief: string; pc: { name: string } };

export class SaveNotFound extends Error {}

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
`;

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

    commitTurn(id: string, input: string, narration: string) {
      using db = open(id);
      const insert = db.query<Message, [Message["role"], string]>(
        "INSERT INTO messages (role, text) VALUES (?, ?) RETURNING id, role, text",
      );
      return db.transaction(() => [insert.get("player", input)!, insert.get("narrator", narration)!])();
    },
  };
}
