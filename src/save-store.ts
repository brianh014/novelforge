import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { type Check, StoredCheck } from "./check-resolver";
import { errorFields, log } from "./logger";
import { applyEdit, openingState, type State, StateSections, WorldEdit } from "./state-applier";

/**
 * The PC as the player wrote them, apart from the name. Each field is optional, as Saves from before these fields have
 * none. New PCs have no personality, but older Saves do, and this strict shape must still accept them.
 */
export const PcDetails = z
  .object({
    background: z.string(),
    physicalTraits: z.string(),
    skills: z.string(),
    personality: z.string(),
    other: z.string(),
  })
  .partial()
  // A strict shape, because these keys are spread over the PC's name when a Save is read.
  .strict();
export type PcDetails = z.infer<typeof PcDetails>;

export type Save = { worldBrief: string; pc: { name: string } & PcDetails };

/** One of the Important Characters as the New Story form had them at Begin. */
export type ImportantCharacter = { name: string; description: string; onCover: boolean };

export class SaveNotFound extends Error {}
export class MessageNotFound extends Error {}
export class StaleTurn extends Error {}
export class NoteNotFound extends Error {}
export class PortraitNotFound extends Error {}
export class EditNotFound extends Error {}
export class InvalidSave extends Error {}
export class NameTaken extends Error {}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

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
export const OPENING_SNAPSHOT = 0;

/** Who a Scene Image shows, by name, with null for the PC as in the portraits table. */
const Pictured = z.array(z.string().nullable());
export type Pictured = z.infer<typeof Pictured>;

/** One image of a Save: `ref` is the Cover's row, a portrait's id, a Scene Image's Message, or a requested image's id. */
/** An "original" is the first image of the portrait with the same `ref`, kept once that portrait is replaced. */
export type ImageTarget = { kind: "cover" | "portrait" | "original" | "scene" | "requested"; ref: number };

const REDRAWABLE = {
  cover: ["cover", "id"],
  portrait: ["portraits", "id"],
  original: ["portrait_originals", "id"],
  scene: ["scene_images", "message_id"],
  requested: ["requested_images", "id"],
} as const;

type SectionRow = { name: string; id: number; content: string };

const sectionsAt = (db: Database, messageId: number) =>
  db
    .query<SectionRow, [number]>(
      `SELECT name, sections.id, content FROM snapshot_sections
       JOIN sections ON sections.id = section_id WHERE message_id = ?`,
    )
    .all(messageId);

const latestSections = (db: Database) =>
  sectionsAt(db, db.query<{ id: number }, []>("SELECT coalesce(max(message_id), 0) AS id FROM snapshot_sections").get()!.id);

const toState = (sections: SectionRow[]) => Object.fromEntries(sections.map(({ name, content }) => [name, JSON.parse(content)])) as State;

const parseEdits = (edits: string | null) => (edits ? (JSON.parse(edits) as WorldEdit[]) : []);

const pendingEdits = (db: Database) => parseEdits(db.query<{ pending_edits: string | null }, []>("SELECT pending_edits FROM save").get()!.pending_edits);

/** The latest Snapshot with any pending Director's Notes and edits applied, which is the state the next Message starts from. */
function currentState(db: Database) {
  const state = toState(latestSections(db));
  const { pending_notes } = db.query<{ pending_notes: string | null }, []>("SELECT pending_notes FROM save").get()!;
  const noted = pending_notes ? { ...state, directorsNotes: JSON.parse(pending_notes) as string[] } : state;
  return pendingEdits(db).reduce(applyEdit, noted);
}

/** A Chapter closed after the latest Message ends there, so that a Regenerate of that Message keeps the new one in it. */
const sealChapter = (state: State, latest: number): State => ({
  ...state,
  chapters: state.chapters.map((chapter) => (chapter.lastMessage === null ? { ...chapter, lastMessage: latest } : chapter)),
});

const clearPending = (db: Database) => db.run("UPDATE save SET pending_notes = NULL, pending_edits = NULL");

/** Links a section the latest Snapshot already holds rather than storing it again, and never rewrites one. */
function writeSnapshot(db: Database, messageId: number, state: State) {
  const latest = latestSections(db);
  for (const [name, value] of Object.entries(state)) {
    const content = JSON.stringify(value);
    const unchanged = latest.find((section) => section.name === name && section.content === content);
    const sectionId = unchanged?.id ?? db.query<{ id: number }, [string]>("INSERT INTO sections (content) VALUES (?) RETURNING id").get(content)!.id;
    db.run("INSERT INTO snapshot_sections (message_id, name, section_id) VALUES (?, ?, ?)", [messageId, name, sectionId]);
  }
}

const latestMessage = (db: Database) => db.query<{ id: number }, []>("SELECT coalesce(max(id), 0) AS id FROM messages").get()!.id;

function requireMessage(db: Database, messageId: number) {
  const found = db.query<{ id: number }, [number]>("SELECT id FROM messages WHERE id = ?").get(messageId);
  if (!found) throw new MessageNotFound();
}

function countAfter(db: Database, messageId: number) {
  requireMessage(db, messageId);
  const { messages } = db.query<{ messages: number }, [number]>("SELECT count(*) AS messages FROM messages WHERE id > ?").get(messageId)!;
  const { images } = db
    .query<{ images: number }, [number]>(
      `SELECT (SELECT count(*) FROM scene_images WHERE message_id > ?1)
       + (SELECT count(*) FROM requested_images WHERE message_id > ?1) AS images`,
    )
    .get(messageId)!;
  const { portraits } = db.query<{ portraits: number }, [number]>("SELECT count(*) AS portraits FROM portraits WHERE message_id > ?").get(messageId)!;
  return { messages, images, portraits };
}

// Sweeping by what is still linked keeps every section a remaining Message shares.
const sweepSections = (db: Database) => db.run("DELETE FROM sections WHERE id NOT IN (SELECT section_id FROM snapshot_sections)");

function deleteAfter(db: Database, messageId: number) {
  db.run("DELETE FROM messages WHERE id > ?", [messageId]);
  db.run("DELETE FROM snapshot_sections WHERE message_id > ?", [messageId]);
  db.run("DELETE FROM scene_images WHERE message_id > ?", [messageId]);
  db.run("DELETE FROM requested_images WHERE message_id > ?", [messageId]);
  db.run("DELETE FROM portraits WHERE message_id > ?", [messageId]);
  db.run("DELETE FROM portrait_originals WHERE id NOT IN (SELECT id FROM portraits)");
  sweepSections(db);
  clearPending(db);
}

const hasColumn = (db: Database, table: string, column: string) => db.query("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column) !== null;

// The only kind of change ever made to a stored Snapshot: it gets the sections it lacks, at the values they would have held
// anyway, because nothing could write to them yet. All of them share one row per section.
function addMissingSections(db: Database) {
  for (const [name, value] of Object.entries(openingState)) {
    const { id } = db.query<{ id: number }, [string]>("INSERT INTO sections (content) VALUES (?) RETURNING id").get(JSON.stringify(value))!;
    db.run(
      `INSERT OR IGNORE INTO snapshot_sections (message_id, name, section_id)
       SELECT ${OPENING_SNAPSHOT}, ?1, ?2 UNION ALL SELECT id, ?1, ?2 FROM messages`,
      [name, id],
    );
  }
  sweepSections(db);
}

/** Version 0 is an empty file or any Save from before versions existed, so this checks for each change in turn. */
function toVersion1(db: Database) {
  db.run(SCHEMA);
  if (!hasColumn(db, "messages", "hidden_check")) db.run("ALTER TABLE messages ADD COLUMN hidden_check TEXT");
  if (!hasColumn(db, "save", "pending_notes")) db.run("ALTER TABLE save ADD COLUMN pending_notes TEXT");
  addMissingSections(db);
}

/** A column rather than a Snapshot section, because a Revert must not undo a choice about future images. */
const toVersion2 = (db: Database) => db.run("ALTER TABLE save ADD COLUMN art_style TEXT NOT NULL DEFAULT ''");

/** A column for the same reason: it belongs to the Save, not to any Message. */
const toVersion3 = (db: Database) => db.run("ALTER TABLE save ADD COLUMN starting_hook TEXT NOT NULL DEFAULT ''");

/** A column for the same reason, and JSON because nothing ever queries inside it. */
const toVersion4 = (db: Database) => db.run("ALTER TABLE save ADD COLUMN pc_details TEXT NOT NULL DEFAULT '{}'");

/** Images are kept apart from Snapshots, which hold no bytes, and keyed by their Message because Message ids are never reused. */
function toVersion5(db: Database) {
  db.run("CREATE TABLE IF NOT EXISTS scene_images (message_id INTEGER PRIMARY KEY, caption TEXT NOT NULL, bytes BLOB NOT NULL)");
  addMissingSections(db);
}

/**
 * One row per person, by the Message of their first appearance or of the Turn that asked, so a Revert past it takes the portrait too, and one
 * that leaves it standing costs no second image. The PC has a null `npc` and message 0, which no Revert reaches. Ids are what the client sees, as a name is no use in a URL, and are never reused
 * so that a browser can't show a Reverted portrait for a new one.
 */
const toVersion6 = (db: Database) =>
  db.run("CREATE TABLE IF NOT EXISTS portraits (id INTEGER PRIMARY KEY AUTOINCREMENT, npc TEXT UNIQUE, message_id INTEGER NOT NULL, bytes BLOB NOT NULL)");

/** Its own table because it holds bytes, and no Message owns it, so no Revert reaches it. */
const toVersion7 = (db: Database) => db.run("CREATE TABLE IF NOT EXISTS cover (id INTEGER PRIMARY KEY CHECK (id = 1), bytes BLOB NOT NULL)");

/** Empty for a Save from before titles, whose list row shows its PC. */
const toVersion8 = (db: Database) => {
  if (!hasColumn(db, "save", "title")) db.run("ALTER TABLE save ADD COLUMN title TEXT NOT NULL DEFAULT ''");
};

/** Null for an image from before this, whose prompt was never kept. `redraws` gives a redrawn image a new address, so no browser keeps showing the old one. */
function toVersion9(db: Database) {
  for (const table of ["scene_images", "portraits", "cover"]) {
    if (hasColumn(db, table, "prompt")) continue;
    db.run(`ALTER TABLE ${table} ADD COLUMN prompt TEXT`);
    db.run(`ALTER TABLE ${table} ADD COLUMN redraws INTEGER NOT NULL DEFAULT 0`);
  }
}

/** Null for a Message from before this, whose time was never kept. */
const toVersion10 = (db: Database) => {
  if (!hasColumn(db, "messages", "created_at")) db.run("ALTER TABLE messages ADD COLUMN created_at TEXT");
};

/** Null for an image from before this, whose references went by the Scene's cast. */
const toVersion11 = (db: Database) => {
  if (!hasColumn(db, "scene_images", "pictured")) db.run("ALTER TABLE scene_images ADD COLUMN pictured TEXT");
};

/**
 * `pending_edits` are edits since the latest Message. A replacement can't store those in the player Message's Snapshot, which is older than
 * they are, so `edits` carries them on the Narrator Message for the next replacement, as `hidden_check` does its Check.
 * `world_brief` stays as the World Brief the Save began with: a Snapshot now holds it, one row shared by all, so that a Revert undoes an edit.
 */
function toVersion12(db: Database) {
  if (!hasColumn(db, "save", "pending_edits")) db.run("ALTER TABLE save ADD COLUMN pending_edits TEXT");
  if (!hasColumn(db, "messages", "edits")) db.run("ALTER TABLE messages ADD COLUMN edits TEXT");
  addMissingSections(db);
  db.run(
    `UPDATE sections SET content = (SELECT json_quote(world_brief) FROM save)
     WHERE EXISTS (SELECT 1 FROM save) AND id IN (SELECT section_id FROM snapshot_sections WHERE name = 'worldBrief')`,
  );
}

/**
 * Apart from `scene_images`, as a Message can have several and they never stand in for its Scene Image. Ids are what
 * the client sees and are never reused, as with portraits, and `caption` is the player's own words.
 */
const toVersion13 = (db: Database) =>
  db.run(
    `CREATE TABLE IF NOT EXISTS requested_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      caption TEXT NOT NULL,
      bytes BLOB NOT NULL,
      prompt TEXT NOT NULL,
      pictured TEXT NOT NULL,
      redraws INTEGER NOT NULL DEFAULT 0
    )`,
  );

/** Loose Ends, which start empty, as nothing could write to them yet. */
const toVersion14 = addMissingSections;

/**
 * Scene Memories, which start empty, and where they start from. A column rather than a Snapshot section, because
 * Reverting or replacing a Turn must not lose it. It's the oldest of the latest 100 Messages, as the older ones stay with
 * the summary, and 0 in a shorter Save, where no Message has left the prompt. A number here, as an upgrade must never change.
 */
function toVersion15(db: Database) {
  addMissingSections(db);
  if (!hasColumn(db, "save", "memory_start")) db.run("ALTER TABLE save ADD COLUMN memory_start INTEGER NOT NULL DEFAULT 0");
  db.run("UPDATE save SET memory_start = coalesce((SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET 99), 0)");
}

/** Chapters, which start with none closed, as nothing could close one yet. */
const toVersion16 = addMissingSections;

/** Story Time, which a Save from before it has none of. */
const toVersion17 = addMissingSections;

/** The story's theme, which pictures are drawn in. Empty for a Save from before it, whose pictures go by the World Brief alone. */
const toVersion18 = (db: Database) => {
  if (!hasColumn(db, "save", "theme")) db.run("ALTER TABLE save ADD COLUMN theme TEXT NOT NULL DEFAULT ''");
};

/** A Rewrite's direction, kept on the response it made so that later Turns still follow it. */
const toVersion19 = (db: Database) => {
  if (!hasColumn(db, "messages", "direction")) db.run("ALTER TABLE messages ADD COLUMN direction TEXT");
};

/** The recent summary, empty until the next Turn writes one. */
const toVersion20 = addMissingSections;

/**
 * A portrait's first image, kept when it's first replaced, so every Update draws the face from it rather than from a copy
 * of a copy. `id` is the portrait's. A Save from before this has none, so its current portraits become the originals.
 */
const toVersion21 = (db: Database) =>
  db.run("CREATE TABLE IF NOT EXISTS portrait_originals (id INTEGER PRIMARY KEY, bytes BLOB NOT NULL, prompt TEXT, redraws INTEGER NOT NULL DEFAULT 0)");

/** The PC's appearance as the story changes it, which starts empty, as nothing could change it yet. */
const toVersion22 = addMissingSections;

/** The Important Characters from the New Story form, and whether the PC was on the Cover. NULL in a Save from before, which has none on record. */
const toVersion23 = (db: Database) => {
  if (!hasColumn(db, "save", "important_characters")) db.run("ALTER TABLE save ADD COLUMN important_characters TEXT");
  if (!hasColumn(db, "save", "pc_on_cover")) db.run("ALTER TABLE save ADD COLUMN pc_on_cover INTEGER NOT NULL DEFAULT 1");
};

/**
 * The Play Mode, a column like the Art Style, as a Revert must not undo a choice about how the player goes on, and each
 * Narrator Message's Choices, NULL for one written in Free Text.
 */
const toVersion24 = (db: Database) => {
  if (!hasColumn(db, "save", "play_mode")) db.run("ALTER TABLE save ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'free'");
  if (!hasColumn(db, "messages", "choices")) db.run("ALTER TABLE messages ADD COLUMN choices TEXT");
};

/** One step per schema version, where step N takes a Save from version N to N + 1. New Saves take them too, so they can't drift from old ones. */
const MIGRATIONS = [
  toVersion1,
  toVersion2,
  toVersion3,
  toVersion4,
  toVersion5,
  toVersion6,
  toVersion7,
  toVersion8,
  toVersion9,
  toVersion10,
  toVersion11,
  toVersion12,
  toVersion13,
  toVersion14,
  toVersion15,
  toVersion16,
  toVersion17,
  toVersion18,
  toVersion19,
  toVersion20,
  toVersion21,
  toVersion22,
  toVersion23,
  toVersion24,
];

function schemaVersion(db: Database) {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version > MIGRATIONS.length) throw new InvalidSave("This Save was made by a newer version of NovelForge.");
  return version;
}

function migrate(db: Database, save?: string) {
  const version = schemaVersion(db);
  if (version === MIGRATIONS.length) return;
  // All steps or none, so a failure leaves the Save as it was.
  db.transaction(() => {
    for (const step of MIGRATIONS.slice(version)) step(db);
    db.run(`PRAGMA user_version = ${MIGRATIONS.length}`);
  })();
  // Not a brand new Save, which takes every step too.
  if (version > 0) log.info("saves", "Save upgraded", { save, from: version, to: MIGRATIONS.length });
}

const NOT_A_SAVE = "This file isn't a valid Save.";

/** Every column that can hold a name, which a rename rewrites. The PC's name is left alone, as only NPCs are renamed. */
const RENAMED: [string, string[]][] = [
  ["save", ["world_brief", "starting_hook", "title", "pc_details", "pending_notes", "pending_edits", "important_characters"]],
  ["messages", ["text", "edits", "direction", "choices"]],
  ["sections", ["content"]],
  ["scene_images", ["caption", "prompt", "pictured"]],
  ["requested_images", ["caption", "prompt", "pictured"]],
  ["portraits", ["npc", "prompt"]],
  ["portrait_originals", ["prompt"]],
  ["cover", ["prompt"]],
];

const SAVE_TABLES = ["save", "messages", "sections", "snapshot_sections", "scene_images", "requested_images", "portraits", "portrait_originals", "cover"];

/** Anything in an imported file that could act while it is migrated, so it must be refused first. */
function assertSafeToMigrate(db: Database) {
  const version = schemaVersion(db);
  const { integrity_check } = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()!;
  // Automatic indexes have no sql. A trigger, view or virtual table would run in place of the tables the app trusts.
  const stranger = db
    .query(
      `SELECT 1 FROM sqlite_schema WHERE sql IS NOT NULL AND name <> 'sqlite_sequence'
       AND (type <> 'table' OR rootpage = 0 OR name NOT IN ('${SAVE_TABLES.join("', '")}'))`,
    )
    .get();
  if (version < 0 || integrity_check !== "ok" || stranger) throw new InvalidSave(NOT_A_SAVE);
}

const jsonText = <T>(schema: z.ZodType<T>) =>
  z
    .string()
    .transform((text) => JSON.parse(text) as unknown)
    .pipe(schema);

const rowId = z.number().int().nonnegative();

// Far past any model's output at the sizes asked for, but a Save from outside can claim anything.
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** How many responses a Rewrite's direction lasts, counting the one it made. */
export const RESPONSES_KEEPING_DIRECTIONS = 5;

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);

/** The type of an image the app can show, read from the bytes themselves. Everything else, SVG and HTML above all, is undefined. */
export function imageType(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) return undefined;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF", a four-byte size, then "WEBP".
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return undefined;
}

const storedImage = z.instanceof(Uint8Array).refine((bytes) => imageType(bytes) !== undefined);
const redrawable = { prompt: z.string().nullable(), redraws: z.number().int().nonnegative() };

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
    pending_edits: jsonText(z.array(WorldEdit)).nullable(),
    art_style: z.string(),
    starting_hook: z.string(),
    pc_details: jsonText(PcDetails),
    title: z.string(),
    theme: z.string(),
    memory_start: rowId,
    important_characters: jsonText(z.array(z.object({ name: z.string(), description: z.string(), onCover: z.boolean() })).max(10)).nullable(),
    pc_on_cover: z.union([z.literal(0), z.literal(1)]),
    play_mode: PlayMode,
  });
  const messages = rowsOf(db, "messages", {
    id: rowId.positive(),
    role: z.enum(["player", "narrator"]),
    text: z.string(),
    hidden_check: jsonText(StoredCheck).nullable(),
    edits: jsonText(z.array(WorldEdit)).nullable(),
    direction: z.string().nullable(),
    created_at: z.iso.datetime().nullable(),
    choices: jsonText(Choices).nullable(),
  });
  const content = new Map(rowsOf(db, "sections", { id: rowId, content: z.string() }).map((section) => [section.id, section.content]));
  const links = rowsOf(db, "snapshot_sections", { message_id: rowId, name: z.string(), section_id: rowId });
  const images = rowsOf(db, "scene_images", {
    message_id: rowId,
    caption: z.string(),
    bytes: storedImage,
    pictured: jsonText(Pictured).nullable(),
    ...redrawable,
  });
  const requested = rowsOf(db, "requested_images", {
    id: rowId.positive(),
    message_id: rowId,
    caption: z.string(),
    bytes: storedImage,
    pictured: jsonText(Pictured),
    ...redrawable,
    prompt: z.string(),
  });
  const portraits = rowsOf(db, "portraits", {
    id: rowId.positive(),
    npc: z.string().nullable(),
    message_id: rowId,
    bytes: storedImage,
    ...redrawable,
  });
  rowsOf(db, "portrait_originals", { id: rowId.positive(), bytes: storedImage, ...redrawable });
  rowsOf(db, "cover", { id: z.literal(1), bytes: storedImage, ...redrawable });

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
  const narrators = new Set(messages.filter(({ role }) => role === "narrator").map(({ id }) => id));
  const imagesPlaced = images.every(({ message_id }) => narrators.has(message_id));
  // Any Message, as a Revert can leave a player Message latest.
  const requestedPlaced = requested.every(({ message_id }) => message_id !== OPENING_SNAPSHOT && snapshots.has(message_id));
  const portraitsPlaced =
    new Set(portraits.map(({ npc }) => npc)).size === portraits.length &&
    portraits.every(({ npc, message_id }) => (npc === null ? message_id === OPENING_SNAPSHOT : narrators.has(message_id)));
  if (save.length !== 1 || !answered || !complete || !imagesPlaced || !requestedPlaced || !portraitsPlaced) throw new InvalidSave(NOT_A_SAVE);
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
    // The id sequence stays behind, so new ids restart here, and a window starting past them would never see them.
    to.run("UPDATE save SET memory_start = min(memory_start, (SELECT coalesce(max(id), 0) + 1 FROM messages))");
  })();
}

export type SaveStore = ReturnType<typeof saveStore>;
export type Message = { id: number; role: "player" | "narrator"; text: string };
export const PlayMode = z.enum(["free", "choices"]);
export type PlayMode = z.infer<typeof PlayMode>;
export const Choices = z.array(z.string()).length(3);
/** A Message as a Turn returns it, with the Choices a response offers in Choices mode. */
export type Reply = Message & { choices?: string[] };
type ChoicesRow = Message & { choices: string | null };
const withChoices = ({ choices, ...message }: ChoicesRow): Reply => ({ ...message, ...(choices !== null && { choices: JSON.parse(choices) as string[] }) });
const choicesText = (choices?: string[]) => (choices ? JSON.stringify(choices) : null);

/** The latest Turn, if its Narrator Message is still `messageId`, so a page behind the story can't replace what it never showed. */
function latestTurn(db: Database, messageId: number) {
  const [narrator, player] = db
    .query<Message & { hidden_check: string | null; edits: string | null; direction: string | null }, []>(
      "SELECT id, role, text, hidden_check, edits, direction FROM messages ORDER BY id DESC LIMIT 2",
    )
    .all();
  // After a Revert to a player Message, the latest Message has no response to replace.
  if (narrator!.id !== messageId || narrator!.role !== "narrator") throw new StaleTurn();
  // Director's Notes changed since the player Message must carry across, or the replacement would undo them. So must edits.
  const { directorsNotes } = currentState(db);
  const edits = [...parseEdits(narrator!.edits), ...pendingEdits(db)];
  const state = edits.reduce(applyEdit, { ...toState(sectionsAt(db, player!.id)), directorsNotes });
  return { narrator: narrator!, player: player!, state, edits };
}

// shortcut: room for a few hundred images, and import holds several copies in memory, so a longer story can export but not import until import streams.
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

function connect(path: string) {
  const db = new Database(path, { create: true, strict: true });
  try {
    // secure_delete zeroes deleted rows, so a Reverted future cannot be read back from a shared Save file.
    // Tests skip the flush to disk, which only guards against power loss and makes up most of the suite's run time.
    const sync = process.env.NODE_ENV === "test" ? "OFF" : "FULL";
    db.run(`PRAGMA journal_mode = DELETE; PRAGMA synchronous = ${sync}; PRAGMA secure_delete = ON;`);
    migrate(db, basename(path, ".sqlite"));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function saveStore(savesDir: string) {
  mkdirSync(savesDir, { recursive: true });
  const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);

  const isSaveId = (id: string) => z.uuid().safeParse(id).success;

  /** The file of a Save that exists. The id becomes a filename, so anything but a uuid must never reach the filesystem. */
  const existingPath = (id: string) => {
    if (!isSaveId(id) || !existsSync(pathOf(id))) throw new SaveNotFound();
    return pathOf(id);
  };

  const open = (id: string) => connect(existingPath(id));

  return {
    create({
      worldBrief,
      pc,
      artStyle = "",
      startingHook = "",
      title = "",
      theme = "",
      importantCharacters,
      pcOnCover = true,
      playMode = "free",
      opening,
    }: Save & {
      artStyle?: string;
      startingHook?: string;
      title?: string;
      theme?: string;
      importantCharacters?: ImportantCharacter[];
      pcOnCover?: boolean;
      playMode?: PlayMode;
      opening?: Partial<State>;
    }) {
      const id = crypto.randomUUID();
      const unfinishedPath = `${pathOf(id)}.unfinished`;
      try {
        using db = connect(unfinishedPath);
        const { name, ...details } = pc;
        db.run(
          "INSERT INTO save (id, world_brief, pc_name, art_style, starting_hook, pc_details, title, theme, important_characters, pc_on_cover, play_mode) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            worldBrief,
            name,
            artStyle,
            startingHook,
            JSON.stringify(details),
            title,
            theme,
            importantCharacters ? JSON.stringify(importantCharacters) : null,
            pcOnCover ? 1 : 0,
            playMode,
          ],
        );
        // No Message has this Snapshot yet, and the file isn't a Save until the rename below.
        for (const [name, value] of Object.entries({ ...opening, worldBrief })) {
          db.run(
            `UPDATE sections SET content = ? WHERE id =
             (SELECT section_id FROM snapshot_sections WHERE message_id = ${OPENING_SNAPSHOT} AND name = ?)`,
            [JSON.stringify(value), name],
          );
        }
      } catch (error) {
        // Else a hidden file holding the world stays in Saves, where nothing lists or deletes it.
        rmSync(unfinishedPath, { force: true });
        throw error;
      }
      // Renaming last means a crash can never leave a half-built file that looks like a Save.
      renameSync(unfinishedPath, pathOf(id));
      log.info("saves", "Save created", { save: id });
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
          const { worldBrief, pc, hasCover, coverRedraws, title } = this.read(id);
          return { id, title, worldBrief, pc: { name: pc.name }, hasCover, coverRedraws, updatedAt: statSync(pathOf(id)).mtimeMs };
        } catch (error) {
          log.error("saves", "A Save won't open", { save: id, ...errorFields(error) });
          return { id, unreadable: true as const, updatedAt: statSync(pathOf(id)).mtimeMs };
        }
      });
      return saves.toSorted((a, b) => b.updatedAt - a.updatedAt);
    },

    read(id: string): Save & {
      artStyle: string;
      startingHook: string;
      title: string;
      theme: string;
      hasCover: boolean;
      coverRedraws: number;
      importantCharacters?: ImportantCharacter[];
      pcOnCover: boolean;
      playMode: PlayMode;
    } {
      using db = open(id);
      const save = db
        .query<
          {
            pc_name: string;
            art_style: string;
            starting_hook: string;
            pc_details: string;
            title: string;
            theme: string;
            important_characters: string | null;
            pc_on_cover: number;
            play_mode: PlayMode;
          },
          []
        >("SELECT pc_name, art_style, starting_hook, pc_details, title, theme, important_characters, pc_on_cover, play_mode FROM save")
        .get()!;
      return {
        worldBrief: currentState(db).worldBrief,
        pc: { ...(JSON.parse(save.pc_details) as PcDetails), name: save.pc_name },
        artStyle: save.art_style,
        startingHook: save.starting_hook,
        title: save.title,
        theme: save.theme,
        ...(save.important_characters !== null && { importantCharacters: JSON.parse(save.important_characters) as ImportantCharacter[] }),
        pcOnCover: save.pc_on_cover === 1,
        playMode: save.play_mode,
        hasCover: db.query("SELECT 1 FROM cover").get() !== null,
        coverRedraws: db.query<{ redraws: number }, []>("SELECT redraws FROM cover").get()?.redraws ?? 0,
      };
    },

    cover(id: string) {
      using db = open(id);
      return db.query<{ bytes: Uint8Array<ArrayBuffer> }, []>("SELECT bytes FROM cover").get()?.bytes;
    },

    setCover(id: string, bytes: Uint8Array, prompt: string | null = null) {
      if (!imageType(bytes)) throw new Error("The image model returned something that isn't a PNG, JPEG or WebP");
      using db = open(id);
      db.run("INSERT OR REPLACE INTO cover (id, bytes, prompt) VALUES (1, ?, ?)", [bytes, prompt]);
    },

    setTheme(id: string, theme: string) {
      using db = open(id);
      db.run("UPDATE save SET theme = ?", [theme]);
    },

    setArtStyle(id: string, artStyle: string) {
      using db = open(id);
      db.run("UPDATE save SET art_style = ?", [artStyle]);
    },

    setPlayMode(id: string, playMode: PlayMode) {
      using db = open(id);
      db.run("UPDATE save SET play_mode = ?", [playMode]);
    },

    /** The latest Message's Choices, if it is a response that has some. */
    latestChoices(id: string) {
      using db = open(id);
      const latest = db.query<ChoicesRow, []>("SELECT id, role, text, choices FROM messages ORDER BY id DESC LIMIT 1").get();
      return latest ? withChoices(latest).choices : undefined;
    },

    messages(id: string) {
      using db = open(id);
      return db.query<Message, []>("SELECT id, role, text FROM messages ORDER BY id").all();
    },

    latestMessageId(id: string) {
      using db = open(id);
      return latestMessage(db);
    },

    /** Rewrite directions on the latest responses up to `upTo`, oldest first, as they still hold for a while. */
    directions(id: string, upTo: number) {
      using db = open(id);
      return db
        .query<{ direction: string }, [number, number]>(
          `SELECT direction FROM (SELECT id, direction FROM messages WHERE role = 'narrator' AND id <= ? ORDER BY id DESC LIMIT ?)
           WHERE direction IS NOT NULL ORDER BY id`,
        )
        .all(upTo, RESPONSES_KEEPING_DIRECTIONS)
        .map(({ direction }) => direction);
    },

    /** Without the bytes, so a page can list every image cheaply. */
    sceneImages(id: string) {
      using db = open(id);
      return db
        .query<{ messageId: number; caption: string; redraws: number }, []>(
          "SELECT message_id AS messageId, caption, redraws FROM scene_images ORDER BY message_id",
        )
        .all();
    },

    /** Without the bytes, like `sceneImages`. */
    requestedImages(id: string) {
      using db = open(id);
      return db
        .query<{ ref: number; messageId: number; caption: string; redraws: number }, []>(
          "SELECT id AS ref, message_id AS messageId, caption, redraws FROM requested_images ORDER BY id",
        )
        .all();
    },

    /**
     * Every image without its bytes, in Gallery order, including those of NPCs the player must not see yet: the Cover, the PC, NPCs by name,
     * then images of moments newest first by their Message, which a Redraw leaves alone. On one Message a Scene Image is drawn before any Requested Image.
     */
    gallery(id: string) {
      using db = open(id);
      return db
        .query<ImageTarget & { npc: string | null; messageId: number; caption: string; prompt: string | null; redraws: number }, []>(
          // A subquery, so the order can put each original after its portrait.
          `SELECT * FROM (SELECT 'cover' AS kind, id AS ref, NULL AS npc, 0 AS messageId, '' AS caption, prompt, redraws, 0 AS place FROM cover
           UNION ALL SELECT 'portrait', id, npc, message_id, '', prompt, redraws, 1 + (npc IS NOT NULL) FROM portraits
           UNION ALL SELECT 'original', o.id, p.npc, p.message_id, '', o.prompt, o.redraws, 1 + (p.npc IS NOT NULL)
             FROM portrait_originals o JOIN portraits p ON p.id = o.id
           UNION ALL SELECT 'scene', message_id, NULL, message_id, caption, prompt, redraws, 3 FROM scene_images
           UNION ALL SELECT 'requested', id, NULL, message_id, caption, prompt, redraws, 3 FROM requested_images)
           ORDER BY place, CASE WHEN place = 2 THEN npc END COLLATE NOCASE, messageId DESC, kind = 'original', kind, ref DESC`,
        )
        .all();
    },

    /** Changes nothing if the image has gone, like `addSceneImage`. */
    replaceImage(id: string, { kind, ref }: ImageTarget, prompt: string | null, bytes: Uint8Array) {
      if (!imageType(bytes)) throw new Error("The image model returned something that isn't a PNG, JPEG or WebP");
      const [table, key] = REDRAWABLE[kind];
      using db = open(id);
      // Whatever replaces a portrait, its first image stays as the original.
      if (kind === "portrait")
        db.run("INSERT OR IGNORE INTO portrait_originals (id, bytes, prompt) SELECT id, bytes, prompt FROM portraits WHERE id = ?", [ref]);
      db.run(`UPDATE ${table} SET bytes = ?, prompt = ?, redraws = redraws + 1 WHERE ${key} = ?`, [bytes, prompt, ref]);
    },

    /** Only an image of a moment, as the Cover and portraits stay. Its Message and Snapshot hold no image, so they are untouched. */
    deleteImage(id: string, { kind, ref }: ImageTarget & { kind: "scene" | "requested" }) {
      const [table, key] = REDRAWABLE[kind];
      using db = open(id);
      db.run(`DELETE FROM ${table} WHERE ${key} = ?`, [ref]);
    },

    sceneImage(id: string, messageId: number) {
      using db = open(id);
      const image = db.query<{ bytes: Uint8Array<ArrayBuffer> }, [number]>("SELECT bytes FROM scene_images WHERE message_id = ?").get(messageId);
      if (!image) throw new MessageNotFound();
      return image.bytes;
    },

    requestedImage(id: string, ref: number) {
      using db = open(id);
      const image = db.query<{ bytes: Uint8Array<ArrayBuffer> }, [number]>("SELECT bytes FROM requested_images WHERE id = ?").get(ref);
      if (!image) throw new MessageNotFound();
      return image.bytes;
    },

    /** Stores nothing if the Message has gone, so a generation can't outlive a Revert or a replaced response. */
    addSceneImage(id: string, messageId: number, caption: string, bytes: Uint8Array, prompt: string | null = null, pictured: Pictured = []) {
      if (!imageType(bytes)) throw new Error("The image model returned something that isn't a PNG, JPEG or WebP");
      using db = open(id);
      db.run("INSERT INTO scene_images (message_id, caption, bytes, prompt, pictured) SELECT id, ?, ?, ?, ? FROM messages WHERE id = ?", [
        caption,
        bytes,
        prompt,
        JSON.stringify(pictured),
        messageId,
      ]);
    },

    /** Stores nothing if the Message has gone, like `addSceneImage`. */
    addRequestedImage(id: string, messageId: number, caption: string, bytes: Uint8Array, prompt: string, pictured: Pictured) {
      if (!imageType(bytes)) throw new Error("The image model returned something that isn't a PNG, JPEG or WebP");
      using db = open(id);
      db.run("INSERT INTO requested_images (message_id, caption, bytes, prompt, pictured) SELECT id, ?, ?, ?, ? FROM messages WHERE id = ?", [
        caption,
        bytes,
        prompt,
        JSON.stringify(pictured),
        messageId,
      ]);
    },

    /** Who an image of a moment shows, or null for a Scene Image from before that was kept. */
    pictured(id: string, { kind, ref }: ImageTarget & { kind: "scene" | "requested" }) {
      const [table, key] = REDRAWABLE[kind];
      using db = open(id);
      const row = db.query<{ pictured: string | null }, [number]>(`SELECT pictured FROM ${table} WHERE ${key} = ?`).get(ref);
      return row?.pictured ? (JSON.parse(row.pictured) as Pictured) : null;
    },

    /** Every portrait without its bytes, including those of NPCs the player must not see yet. */
    portraits(id: string) {
      using db = open(id);
      return db
        .query<{ id: number; npc: string | null; redraws: number; messageId: number }, []>(
          "SELECT id, npc, redraws, message_id AS messageId FROM portraits ORDER BY id",
        )
        .all();
    },

    portrait(id: string, portraitId: number) {
      using db = open(id);
      const portrait = db.query<{ bytes: Uint8Array<ArrayBuffer> }, [number]>("SELECT bytes FROM portraits WHERE id = ?").get(portraitId);
      if (!portrait) throw new PortraitNotFound();
      return portrait.bytes;
    },

    /** A portrait's first image, or undefined while the portrait has never been replaced. */
    original(id: string, portraitId: number) {
      using db = open(id);
      return db.query<{ bytes: Uint8Array<ArrayBuffer> }, [number]>("SELECT bytes FROM portrait_originals WHERE id = ?").get(portraitId)?.bytes;
    },

    /** The prompt of the image `original` returns, or of the portrait while it has none. */
    originalPrompt(id: string, portraitId: number) {
      using db = open(id);
      return (
        db
          .query<{ prompt: string | null }, [number]>(
            "SELECT CASE WHEN o.id IS NULL THEN p.prompt ELSE o.prompt END AS prompt FROM portraits p LEFT JOIN portrait_originals o ON o.id = p.id WHERE p.id = ?",
          )
          .get(portraitId)?.prompt ?? undefined
      );
    },

    /** Goes by exact name, as the state does. A null `npc` is the PC. */
    portraitOf(id: string, npc: string | null) {
      using db = open(id);
      const portrait = db.query<{ bytes: Uint8Array }, [string | null]>("SELECT bytes FROM portraits WHERE npc IS ?").get(npc);
      const mediaType = portrait && imageType(portrait.bytes);
      return mediaType ? { bytes: portrait!.bytes, mediaType } : undefined;
    },

    /** Stores nothing if the Message that asked has gone, like `addSceneImage`. An NPC's goes by their first appearance, or by that Message if they have been in no Scene. */
    addPortrait(id: string, messageId: number, npc: string | null, bytes: Uint8Array, prompt: string | null = null) {
      if (!imageType(bytes)) throw new Error("The image model returned something that isn't a PNG, JPEG or WebP");
      using db = open(id);
      // The opening's, like the PC's, as one drawn before the story outlives every Revert.
      if (npc === null || messageId === OPENING_SNAPSHOT) {
        db.run(`INSERT INTO portraits (npc, message_id, bytes, prompt) VALUES (?, ${OPENING_SNAPSHOT}, ?, ?)`, [npc, bytes, prompt]);
        return;
      }
      db.run(
        `INSERT INTO portraits (npc, message_id, bytes, prompt)
         SELECT ?1, coalesce(min(message_id), ?2), ?3, ?4 FROM snapshot_sections
         JOIN sections ON sections.id = section_id, json_each(content, '$.visibleCast') AS cast_member
         WHERE name = 'scene' AND cast_member.value = ?1 AND EXISTS (SELECT 1 FROM messages WHERE id = ?2)
         HAVING EXISTS (SELECT 1 FROM messages WHERE id = ?2)`,
        [npc, messageId, bytes, prompt],
      );
    },

    /** The first Message a Scene Memory can cover: older ones stayed with the summary when the Save upgraded. */
    memoryStart(id: string) {
      using db = open(id);
      return db.query<{ memory_start: number }, []>("SELECT memory_start FROM save").get()!.memory_start;
    },

    /** Everyone who has been in a Scene, last seen first. */
    recentCast(id: string) {
      using db = open(id);
      return db
        .query<{ npc: string }, []>(
          `SELECT cast_member.value AS npc FROM snapshot_sections
           JOIN sections ON sections.id = section_id, json_each(content, '$.visibleCast') AS cast_member
           WHERE snapshot_sections.name = 'scene' GROUP BY npc ORDER BY max(message_id) DESC`,
        )
        .all()
        .map(({ npc }) => npc);
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
        log.info("saves", "Reverted", { save: id, message: messageId, ...deleted });
        return deleted;
      })();
    },

    /** Copies the whole Save, or only as far as `fromMessage`. */
    duplicate(id: string, fromMessage?: number) {
      using source = open(id);
      if (fromMessage !== undefined) requireMessage(source, fromMessage);
      const copyId = crypto.randomUUID();
      const unfinishedPath = `${pathOf(copyId)}.unfinished`;
      try {
        source.run("VACUUM INTO ?", [unfinishedPath]);
        if (fromMessage !== undefined) {
          using copy = connect(unfinishedPath);
          deleteAfter(copy, fromMessage);
        }
      } catch (error) {
        rmSync(unfinishedPath, { force: true });
        throw error;
      }
      renameSync(unfinishedPath, pathOf(copyId));
      log.info("saves", "Save duplicated", { save: id, copy: copyId, fromMessage });
      return copyId;
    },

    delete(id: string) {
      const path = existingPath(id);
      // The Save goes first, because a crash's leftovers hold story text but mean nothing without it.
      for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
      log.info("saves", "Save deleted", { save: id });
    },

    /** One self-contained file, without deleted rows, whatever journal the Save last used. */
    export(id: string) {
      using source = open(id);
      const path = `${pathOf(crypto.randomUUID())}.unfinished`;
      try {
        source.run("VACUUM INTO ?", [path]);
        const bytes = readFileSync(path);
        log.info("saves", "Save exported", { save: id, bytes: bytes.byteLength });
        return bytes;
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
        log.info("saves", "Save imported", { save: id, bytes: bytes.byteLength });
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
      choices?: string[],
    ): Reply[] {
      using db = open(id);
      const insert = db.query<ChoicesRow, [Message["role"], string, string | null, string | null]>(
        `INSERT INTO messages (role, text, hidden_check, choices, created_at) VALUES (?, ?, ?, ?, ${NOW}) RETURNING id, role, text, choices`,
      );
      return db.transaction(() => {
        // Message ids are never reused, so any Revert or other Turn since `basedOn` is caught here.
        if (latestMessage(db) !== basedOn) throw new StaleTurn();
        const state = sealChapter(currentState(db), basedOn);
        const player = withChoices(insert.get("player", input, null, null)!);
        writeSnapshot(db, player.id, state);
        clearPending(db);
        const narrator = withChoices(insert.get("narrator", narration, check ? JSON.stringify(check) : null, choicesText(choices))!);
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

    /** Throws EditNotFound if a page behind the story, or a player who can't see it, names something the Journal doesn't show. */
    addEdit(id: string, edit: WorldEdit) {
      using db = open(id);
      db.transaction(() => {
        const { pcKnown, looseEnds, sceneMemories, chapters } = currentState(db);
        const missing =
          (edit.edit === "fact" && edit.old !== null && !pcKnown.facts.includes(edit.old)) ||
          (edit.edit === "looseEnd" && edit.old !== null && !looseEnds.includes(edit.old)) ||
          (edit.edit === "npcSummary" && !pcKnown.npcs.includes(edit.name)) ||
          (edit.edit === "sceneMemory" && !sceneMemories.some(({ firstMessage }) => firstMessage === edit.firstMessage)) ||
          (edit.edit === "chapterTitle" && edit.index >= chapters.length);
        if (missing) throw new EditNotFound();
        db.run("UPDATE save SET pending_edits = ?", [JSON.stringify([...pendingEdits(db), edit])]);
      })();
    },

    /**
     * Renames a known NPC in every Message, Snapshot, pending change and image of the Save, so no Revert brings the old name back.
     * Their first name alone is renamed too, as the story mostly uses it, unless someone else shares it.
     */
    rename(id: string, name: string, newName: string) {
      using db = open(id);
      db.transaction(() => {
        const { npcs, pcKnown } = currentState(db);
        if (!pcKnown.npcs.includes(name)) throw new EditNotFound();
        const pc = db.query<{ pc_name: string }, []>("SELECT pc_name FROM save").get()!.pc_name;
        const others = [pc, ...npcs.map((npc) => npc.name), ...pcKnown.npcs].filter((other) => other !== name);
        if (others.includes(newName)) throw new NameTaken();
        const first = (full: string) => full.split(/\s+/)[0]!;
        const pairs: [string, string][] = [[name, newName]];
        const [oldFirst, newFirst] = [first(name), first(newName)];
        if (oldFirst !== name && oldFirst !== newFirst && !others.some((other) => first(other) === oldFirst)) pairs.push([oldFirst, newFirst]);
        // JSON-escaped, as most columns hold JSON, and a plain name reads the same either way.
        const patterns = pairs.map(([from, to]) => {
          const escaped = JSON.stringify(from)
            .slice(1, -1)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return [new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), JSON.stringify(to).slice(1, -1)] as const;
        });
        const renamed = (text: string) => patterns.reduce((result, [pattern, to]) => result.replace(pattern, () => to), text);
        for (const [table, columns] of RENAMED) {
          for (const row of db.query<Record<string, string | number | null>, []>(`SELECT rowid AS _row, ${columns} FROM ${table}`).all()) {
            for (const column of columns) {
              const text = row[column];
              if (typeof text === "string" && renamed(text) !== text) db.run(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`, [renamed(text), row._row!]);
            }
          }
        }
        log.info("saves", "NPC renamed", { save: id });
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
        sceneImage: db.query<{ prompt: string | null }, [number]>("SELECT prompt FROM scene_images WHERE message_id = ?").get(messageId),
      };
    },

    /**
     * Swaps the latest Narrator Message for a new one that keeps its Check. The new Message gets a new id, so any
     * Turn or replacement in flight from the old response is caught as stale.
     */
    /** In place, so the Message keeps its id and with it its Scene Image, Requested Images and portraits. */
    editTurn(id: string, messageId: number, narration: string, advance: (state: State) => State, choices?: string[]): Reply[] {
      using db = open(id);
      return db.transaction(() => {
        const { state, edits } = latestTurn(db, messageId);
        const edited = db
          .query<ChoicesRow, [string, string | null, string | null, number]>(
            "UPDATE messages SET text = ?, edits = ?, choices = ? WHERE id = ? RETURNING id, role, text, choices",
          )
          .get(narration, edits.length > 0 ? JSON.stringify(edits) : null, choicesText(choices), messageId)!;
        db.run("DELETE FROM snapshot_sections WHERE message_id = ?", [messageId]);
        writeSnapshot(db, messageId, advance(state));
        sweepSections(db);
        clearPending(db);
        return [withChoices(edited)];
      })();
    },

    /** A Rewrite's `direction` replaces the old response's, and a Regenerate keeps it. */
    replaceTurn(id: string, messageId: number, narration: string, advance: (state: State) => State, direction?: string, choices?: string[]): Reply[] {
      using db = open(id);
      return db.transaction(() => {
        const { narrator, player, state, edits } = latestTurn(db, messageId);
        deleteAfter(db, player.id);
        const replacement = db
          .query<ChoicesRow, [string, string | null, string | null, string | null, string | null]>(
            `INSERT INTO messages (role, text, hidden_check, edits, direction, choices, created_at) VALUES ('narrator', ?, ?, ?, ?, ?, ${NOW}) RETURNING id, role, text, choices`,
          )
          .get(narration, narrator.hidden_check, edits.length > 0 ? JSON.stringify(edits) : null, direction ?? narrator.direction, choicesText(choices))!;
        writeSnapshot(db, replacement.id, advance(state));
        return [withChoices(replacement)];
      })();
    },
  };
}
