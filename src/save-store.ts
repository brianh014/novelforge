import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { type Check, StoredCheck } from "./check-resolver";
import { openingState, type State, StateSections } from "./state-applier";

export type Save = { worldBrief: string; pc: { name: string } };

export class SaveNotFound extends Error {}
export class MessageNotFound extends Error {}
export class StaleTurn extends Error {}
export class NoteNotFound extends Error {}
export class InvalidSave extends Error {}

// The shape at schema version 1, which later versions change through MIGRATIONS rather than here.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS save (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    world_brief TEXT NOT NULL,
    pc_name TEXT NOT NULL,
    -- Director's Notes changed since the latest Message. Snapshots are immutable, so these wait for the next one.
    pending_notes TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('player', 'narrator')),
    text TEXT NOT NULL,
    hidden_check TEXT
  );
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshot_sections (
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

/** The latest Snapshot with any pending Director's Notes applied, which is the state the next Message starts from. */
function currentState(db: Database) {
  const state = toState(latestSections(db));
  const { pending_notes } = db.query<{ pending_notes: string | null }, []>("SELECT pending_notes FROM save").get()!;
  return pending_notes ? { ...state, directorsNotes: JSON.parse(pending_notes) as string[] } : state;
}

const clearPendingNotes = (db: Database) => db.run("UPDATE save SET pending_notes = NULL");

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

const latestMessage = (db: Database) =>
  db.query<{ id: number }, []>("SELECT coalesce(max(id), 0) AS id FROM messages").get()!.id;

function requireMessage(db: Database, messageId: number) {
  const found = db.query<{ id: number }, [number]>("SELECT id FROM messages WHERE id = ?").get(messageId);
  if (!found) throw new MessageNotFound();
}

function countAfter(db: Database, messageId: number) {
  requireMessage(db, messageId);
  const { messages } = db
    .query<{ messages: number }, [number]>("SELECT count(*) AS messages FROM messages WHERE id > ?")
    .get(messageId)!;
  // shortcut: Saves hold no images yet, count and delete them here in ticket 17.
  return { messages, images: 0 };
}

// Sweeping by what is still linked keeps every section a remaining Message shares.
const sweepSections = (db: Database) =>
  db.run("DELETE FROM sections WHERE id NOT IN (SELECT section_id FROM snapshot_sections)");

function deleteAfter(db: Database, messageId: number) {
  db.run("DELETE FROM messages WHERE id > ?", [messageId]);
  db.run("DELETE FROM snapshot_sections WHERE message_id > ?", [messageId]);
  sweepSections(db);
  clearPendingNotes(db);
}

const hasColumn = (db: Database, table: string, column: string) =>
  db.query("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column) !== null;

/** Version 0 is an empty file or any Save from before versions existed, so this checks for each change in turn. */
function toVersion1(db: Database) {
  db.run(SCHEMA);
  if (!hasColumn(db, "messages", "hidden_check")) db.run("ALTER TABLE messages ADD COLUMN hidden_check TEXT");
  if (!hasColumn(db, "save", "pending_notes")) db.run("ALTER TABLE save ADD COLUMN pending_notes TEXT");
  // The one change ever made to a stored Snapshot: it gets the sections it lacks, at the values they would have held
  // anyway, because nothing could write to them yet. All of them share one row per section.
  for (const [name, value] of Object.entries(openingState)) {
    const { id } = db
      .query<{ id: number }, [string]>("INSERT INTO sections (content) VALUES (?) RETURNING id")
      .get(JSON.stringify(value))!;
    db.run(
      `INSERT OR IGNORE INTO snapshot_sections (message_id, name, section_id)
       SELECT ${OPENING_SNAPSHOT}, ?1, ?2 UNION ALL SELECT id, ?1, ?2 FROM messages`,
      [name, id],
    );
  }
  sweepSections(db);
}

/** One step per schema version, where step N takes a Save from version N to N + 1. New Saves take them too, so they can't drift from old ones. */
const MIGRATIONS = [toVersion1];

function schemaVersion(db: Database) {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version > MIGRATIONS.length) throw new InvalidSave("This Save was made by a newer version of NovelForge.");
  return version;
}

function migrate(db: Database) {
  const version = schemaVersion(db);
  if (version === MIGRATIONS.length) return;
  // All steps or none, so a failure leaves the Save as it was.
  db.transaction(() => {
    for (const step of MIGRATIONS.slice(version)) step(db);
    db.run(`PRAGMA user_version = ${MIGRATIONS.length}`);
  })();
}

const NOT_A_SAVE = "This file isn't a valid Save.";

const SAVE_TABLES = ["save", "messages", "sections", "snapshot_sections"];

/** Anything in an imported file that could act while it is migrated, so it must be refused first. */
function assertSafeToMigrate(db: Database) {
  const version = schemaVersion(db);
  const { integrity_check } = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()!;
  // Automatic indexes have no sql. A trigger, view or virtual table would run in place of the tables the game trusts.
  const stranger = db
    .query(
      `SELECT 1 FROM sqlite_schema WHERE sql IS NOT NULL AND name <> 'sqlite_sequence'
       AND (type <> 'table' OR rootpage = 0 OR name NOT IN ('${SAVE_TABLES.join("', '")}'))`,
    )
    .get();
  if (version < 0 || integrity_check !== "ok" || stranger) throw new InvalidSave(NOT_A_SAVE);
}

const jsonText = <T>(schema: z.ZodType<T>) => z.string().transform((text) => JSON.parse(text) as unknown).pipe(schema);

const rowId = z.number().int().nonnegative();

/** The rows of a table that must have exactly the columns of `shape`, even if it has no rows to show them. */
function rowsOf<T extends z.ZodRawShape>(db: Database, table: string, shape: T) {
  const query = db.query(`SELECT * FROM ${table}`);
  if (query.columnNames.toSorted().join() !== Object.keys(shape).toSorted().join()) throw new InvalidSave(NOT_A_SAVE);
  return z.array(z.object(shape)).parse(query.all());
}

/** Checks a Save at the current version, so old files need no rules of their own. Its table definitions don't matter, as `copyRows` leaves them behind. */
function assertValidSave(db: Database) {
  const save = rowsOf(db, "save", {
    id: z.literal(1),
    world_brief: z.string().min(1),
    pc_name: z.string().min(1),
    pending_notes: jsonText(StateSections.directorsNotes).nullable(),
  });
  const messages = rowsOf(db, "messages", {
    id: rowId.positive(),
    role: z.enum(["player", "narrator"]),
    text: z.string(),
    hidden_check: jsonText(StoredCheck).nullable(),
  });
  const content = new Map(
    rowsOf(db, "sections", { id: rowId, content: z.string() }).map((section) => [section.id, section.content]),
  );
  const links = rowsOf(db, "snapshot_sections", { message_id: rowId, name: z.string(), section_id: rowId });

  // Replacing a response needs the player Message before it. Two player Messages in a row are fine, after a Revert.
  const inOrder = messages.toSorted((a, b) => a.id - b.id);
  const answered = inOrder.every((message, index) => message.role === "player" || inOrder[index - 1]?.role === "player");

  const snapshots = new Set([OPENING_SNAPSHOT, ...messages.map(({ id }) => id)]);
  const schemas = new Map<string, z.ZodType>(Object.entries(StateSections));
  const linked = new Set<string>();
  const parsed = new Set<string>();
  for (const { message_id, name, section_id } of links) {
    const schema = schemas.get(name);
    if (!snapshots.has(message_id) || !schema) throw new InvalidSave(NOT_A_SAVE);
    linked.add(`${message_id}/${name}`);
    // Sections are shared, so most links would parse the same text again.
    if (parsed.has(`${name}/${section_id}`)) continue;
    jsonText(schema).parse(content.get(section_id));
    parsed.add(`${name}/${section_id}`);
  }
  const complete = linked.size === links.length && links.length === snapshots.size * schemas.size;
  if (save.length !== 1 || !answered || !complete) throw new InvalidSave(NOT_A_SAVE);
}

/** Fills a new Save with a file's rows, so its table definitions, id sequence and spare pages stay behind. */
function copyRows(from: Database, to: Database) {
  to.transaction(() => {
    to.run("DELETE FROM snapshot_sections; DELETE FROM sections");
    for (const table of SAVE_TABLES) {
      const rows = from.query<unknown, []>(`SELECT * FROM ${table}`);
      const columns = rows.columnNames;
      const insert = to.query(`INSERT INTO ${table} (${columns}) VALUES (${columns.map(() => "?")})`);
      for (const row of rows.values()) insert.run(...(row as SQLQueryBindings[]));
    }
  })();
}

export type SaveStore = ReturnType<typeof saveStore>;
export type Message = { id: number; role: "player" | "narrator"; text: string };

/** The latest Turn, if its Narrator Message is still `messageId`, so a page behind the story can't replace what it never showed. */
function latestTurn(db: Database, messageId: number) {
  const [narrator, player] = db
    .query<Message & { hidden_check: string | null }, []>(
      "SELECT id, role, text, hidden_check FROM messages ORDER BY id DESC LIMIT 2",
    )
    .all();
  // After a Revert to a player Message, the latest Message has no response to replace.
  if (narrator!.id !== messageId || narrator!.role !== "narrator") throw new StaleTurn();
  // Director's Notes changed since the player Message must carry across, or the replacement would undo them.
  const { directorsNotes } = currentState(db);
  return { narrator: narrator!, player: player!, state: { ...toState(sectionsAt(db, player!.id)), directorsNotes } };
}

// shortcut: Saves hold only text so far, raise this for Scene Images in ticket 17, keeping it under Bun's 128 MiB body limit or setting that too.
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export function saveStore(savesDir: string) {
  mkdirSync(savesDir, { recursive: true });
  const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);

  const connect = (path: string) => {
    const db = new Database(path, { create: true, strict: true });
    try {
      // secure_delete zeroes deleted rows, so a Reverted future cannot be read back from a shared Save file.
      db.run("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;");
      migrate(db);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  };

  const isSaveId = (id: string) => z.uuid().safeParse(id).success;

  /** The file of a Save that exists. The id becomes a filename, so anything but a uuid must never reach the filesystem. */
  const existingPath = (id: string) => {
    if (!isSaveId(id) || !existsSync(pathOf(id))) throw new SaveNotFound();
    return pathOf(id);
  };

  const open = (id: string) => connect(existingPath(id));

  return {
    create({ worldBrief, pc }: Save) {
      const id = crypto.randomUUID();
      const unfinishedPath = `${pathOf(id)}.unfinished`;
      {
        using db = connect(unfinishedPath);
        db.run("INSERT INTO save (id, world_brief, pc_name) VALUES (1, ?, ?)", [worldBrief, pc.name]);
      }
      // Renaming last means a crash can never leave a half-built file that looks like a Save.
      renameSync(unfinishedPath, pathOf(id));
      return id;
    },

    /** Every Save, most recently played first. A file that can't be opened is still listed, so it can be deleted. */
    list() {
      const ids = readdirSync(savesDir)
        .filter((name) => name.endsWith(".sqlite"))
        .map((name) => basename(name, ".sqlite"))
        .filter(isSaveId);
      const saves = ids.map((id) => {
        try {
          const { worldBrief, pc } = this.read(id);
          return { id, worldBrief, pc: { name: pc.name }, updatedAt: statSync(pathOf(id)).mtimeMs };
        } catch {
          return { id, unreadable: true as const, updatedAt: statSync(pathOf(id)).mtimeMs };
        }
      });
      return saves.toSorted((a, b) => b.updatedAt - a.updatedAt);
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

    latestMessageId(id: string) {
      using db = open(id);
      return latestMessage(db);
    },

    latestState(id: string) {
      using db = open(id);
      return currentState(db);
    },

    snapshot(id: string, messageId: number) {
      using db = open(id);
      const sections = sectionsAt(db, messageId);
      if (messageId === OPENING_SNAPSHOT || sections.length === 0) throw new MessageNotFound();
      return toState(sections);
    },

    revertPreview(id: string, messageId: number) {
      using db = open(id);
      return countAfter(db, messageId);
    },

    revert(id: string, messageId: number) {
      using db = open(id);
      return db.transaction(() => {
        const deleted = countAfter(db, messageId);
        deleteAfter(db, messageId);
        return deleted;
      })();
    },

    /** Copies the whole Save, or only as far as `fromMessage`. */
    duplicate(id: string, fromMessage?: number) {
      using source = open(id);
      if (fromMessage !== undefined) requireMessage(source, fromMessage);
      const copyId = crypto.randomUUID();
      const unfinishedPath = `${pathOf(copyId)}.unfinished`;
      source.run("VACUUM INTO ?", [unfinishedPath]);
      if (fromMessage !== undefined) {
        using copy = connect(unfinishedPath);
        deleteAfter(copy, fromMessage);
      }
      renameSync(unfinishedPath, pathOf(copyId));
      return copyId;
    },

    delete(id: string) {
      const path = existingPath(id);
      // The Save goes first, because a crash's leftovers hold story text but mean nothing without it.
      for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    },

    /** One self-contained file, without deleted rows, whatever journal the Save last used. */
    export(id: string) {
      using source = open(id);
      const path = `${pathOf(crypto.randomUUID())}.unfinished`;
      try {
        source.run("VACUUM INTO ?", [path]);
        return readFileSync(path);
      } finally {
        rmSync(path, { force: true });
      }
    },

    /** A Save's whole journey in from outside happens in memory, so nothing reaches the Saves folder until it is valid. */
    import(bytes: Uint8Array) {
      if (bytes.byteLength > MAX_IMPORT_BYTES) throw new InvalidSave("This file is too large to be a Save.");
      const id = crypto.randomUUID();
      const unfinishedPath = `${pathOf(id)}.unfinished`;
      try {
        {
          using file = Database.deserialize(bytes, true);
          assertSafeToMigrate(file);
          using migrated = Database.deserialize(bytes);
          migrate(migrated);
          using valid = Database.deserialize(migrated.serialize(), true);
          assertValidSave(valid);
          using save = connect(unfinishedPath);
          copyRows(valid, save);
        }
        renameSync(unfinishedPath, pathOf(id));
        return id;
      } catch (error) {
        rmSync(unfinishedPath, { force: true });
        throw error instanceof InvalidSave ? error : new InvalidSave(NOT_A_SAVE);
      }
    },

    /** `advance` runs inside the transaction, so it always sees the latest state. */
    commitTurn(
      id: string,
      basedOn: number,
      input: string,
      narration: string,
      check: Check | undefined,
      advance: (state: State) => State,
    ) {
      using db = open(id);
      const insert = db.query<Message, [Message["role"], string, string | null]>(
        "INSERT INTO messages (role, text, hidden_check) VALUES (?, ?, ?) RETURNING id, role, text",
      );
      return db.transaction(() => {
        // Message ids are never reused, so any Revert or other Turn since `basedOn` is caught here.
        if (latestMessage(db) !== basedOn) throw new StaleTurn();
        const state = currentState(db);
        const player = insert.get("player", input, null)!;
        writeSnapshot(db, player.id, state);
        clearPendingNotes(db);
        const narrator = insert.get("narrator", narration, check ? JSON.stringify(check) : null)!;
        writeSnapshot(db, narrator.id, advance(state));
        return [player, narrator];
      })();
    },

    changeNotes(id: string, change: (notes: string[]) => string[]) {
      using db = open(id);
      return db.transaction(() => {
        const notes = change(currentState(db).directorsNotes);
        db.run("UPDATE save SET pending_notes = ?", [JSON.stringify(notes)]);
        return notes;
      })();
    },

    /** What a new response to the latest Turn starts from: the state and story from before its Narrator Message. */
    turnToReplace(id: string, messageId: number) {
      using db = open(id);
      requireMessage(db, messageId);
      const { narrator, player, state } = latestTurn(db, messageId);
      return {
        input: player.text,
        narration: narrator.text,
        check: narrator.hidden_check ? (JSON.parse(narrator.hidden_check) as Check) : undefined,
        state,
        messages: db.query<Message, [number]>("SELECT id, role, text FROM messages WHERE id < ? ORDER BY id").all(player.id),
      };
    },

    /**
     * Swaps the latest Narrator Message for a new one that keeps its Check. The new Message gets a new id, so any
     * Turn or replacement in flight from the old response is caught as stale.
     */
    replaceTurn(id: string, messageId: number, narration: string, advance: (state: State) => State) {
      using db = open(id);
      return db.transaction(() => {
        const { narrator, player, state } = latestTurn(db, messageId);
        deleteAfter(db, player.id);
        const replacement = db
          .query<Message, [string, string | null]>(
            "INSERT INTO messages (role, text, hidden_check) VALUES ('narrator', ?, ?) RETURNING id, role, text",
          )
          .get(narration, narrator.hidden_check)!;
        writeSnapshot(db, replacement.id, advance(state));
        return [replacement];
      })();
    },
  };
}
