import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Check } from "./check-resolver";
import { openingState, type State } from "./state-applier";

export type Save = { worldBrief: string; pc: { name: string } };

export class SaveNotFound extends Error {}
export class MessageNotFound extends Error {}
export class StaleTurn extends Error {}
export class NoteNotFound extends Error {}

// shortcut: Saves made before hidden_check, pending_notes or the ticket 06 Snapshot sections fail their next Turn, migrate them when opened in ticket 13.
const SCHEMA = `
  CREATE TABLE save (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    world_brief TEXT NOT NULL,
    pc_name TEXT NOT NULL,
    -- Director's Notes changed since the latest Message. Snapshots are immutable, so these wait for the next one.
    pending_notes TEXT
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('player', 'narrator')),
    text TEXT NOT NULL,
    hidden_check TEXT
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

function deleteAfter(db: Database, messageId: number) {
  db.run("DELETE FROM messages WHERE id > ?", [messageId]);
  db.run("DELETE FROM snapshot_sections WHERE message_id > ?", [messageId]);
  // Sweeping by what is still linked keeps every section a remaining Message shares.
  db.run("DELETE FROM sections WHERE id NOT IN (SELECT section_id FROM snapshot_sections)");
  clearPendingNotes(db);
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

export function saveStore(savesDir: string) {
  mkdirSync(savesDir, { recursive: true });
  const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);

  const connect = (path: string) => {
    const db = new Database(path, { create: true, strict: true });
    // secure_delete zeroes deleted rows, so a Reverted future cannot be read back from a shared Save file.
    db.run("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;");
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
