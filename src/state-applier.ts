import { z } from "zod";

export type LoreEntry = { title: string; keywords: string[]; content: string; alwaysOn: boolean };

export type SceneMemory = { firstMessage: number; lastMessage: number; text: string };

export type State = {
  inventory: { wearing: string[]; carrying: string[] };
  status: { health: string; injuries: string[]; conditions: string[] };
  npcs: { name: string; appearance: string }[];
  /** What each NPC has learned or lived through in play, newest last, by name. Hidden from the player, as it can hold what the PC never saw. */
  npcKnows: Record<string, string[]>;
  scene: { location: string; visibleCast: string[] };
  /** `summaries` says who each known NPC is, as the PC understands it. A Save from before them has none. */
  pcKnown: { facts: string[]; npcs: string[]; summaries?: Record<string, string> };
  /** What the PC knows is still unresolved. Unlike a Plot Thread, the player reads these. */
  looseEnds: string[];
  /** The story's older Messages in about 100 words each, oldest first. The server sets each range, so a wrong memory can be traced to its source. */
  sceneMemories: SceneMemory[];
  worldBible: LoreEntry[];
  worldRules: string[];
  /** Each Plot Thread's truth: what really happened, who is behind it, what they want and what is hidden. It changes only when play reveals it. */
  plotThreads: string[];
  /**
   * Each Plot Thread's now, by its truth: what its people have done out of the PC's sight, which is true. World Moves On
   * rewrites it freely, as rewriting a thread's one text lost who was behind it and what it hid. A Save from before it has none.
   */
  threadsNow: Record<string, string>;
  /**
   * Each Plot Thread's plan, by its truth: the deed its people mean to do next and by when, which hasn't happened, apart from
   * the now, as a planned deed read as done had someone act on news the PC had outrun. A Save from before it has none, so its
   * now, which held both, reads as done.
   */
  threadsPlan: Record<string, string>;
  /**
   * Each Plot Thread's question, by its truth: what it turns on, fixed once when it begins, so each move asks only whether play has
   * answered it, as a question rewritten every move moved on with play and no thread closed in 160 rounds. A Save from before it has none.
   */
  threadsQuestion: Record<string, string>;
  /** Each Plot Thread's plan's due hour on storyTime's hours, by its truth, so code tells a move whose plan is due. */
  threadsDue: Record<string, number>;
  /**
   * By each Plot Thread's truth, who World Moves On gave their own part of it, kept in npcKnows. Apart from what they learn in
   * play, as a move took anything in npcKnows for their part and never gave the people with only that one. A Save from before it has none.
   */
  threadParts: Record<string, string[]>;
  /** By name, the words of each part World Moves On gave them, which the npcKnows cap keeps, as dropping the oldest lost people their own secrets. */
  npcParts: Record<string, string[]>;
  summary: string;
  /** How many of the Narrator's replies the summary covers, as it is written only every few replies. 0 in a Save from before it, so its next reply writes one. */
  summaryReplies: number;
  /** Just the last few scenes, for the player. The Narrator never reads it back. */
  recentSummary: string;
  directorsNotes: string[];
  /** Here rather than on the Save, so a Revert undoes an edit to it. */
  worldBrief: string;
  /** Closed Chapters, oldest first. A null `lastMessage` was closed after the latest Message, and the next Turn fills it in. */
  chapters: Chapter[];
  /** Whether the latest Narrator reply suggested ending the open Chapter. */
  chapterReady: boolean;
  /** Null until the Narrator first sets it, as in a Save from before Story Time. */
  storyTime: StoryTime | null;
  /** How the PC's body and face look now, once the story changes them. Empty until then, when the PC's own physicalTraits stand. */
  pcAppearance: string;
  /** The real era and region every picture resembles, set once so pictures don't drift between eras. Empty until the Narrator sets it. */
  era: string;
};

/**
 * `day` counts days since the Opening, as Narrators add whole numbers far better than they work an in-world calendar. `hours` counts
 * story hours since then, code adding up each reply's hours_passed, so it holds in any world's calendar. The player sees neither.
 */
export type StoryTime = { day: number; date: string; timeOfDay: string; hours?: number; dateDue?: boolean };

export type Chapter = { lastMessage: number | null; title: string };

export const openingState: State = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  npcKnows: {},
  scene: { location: "", visibleCast: [] },
  pcKnown: { facts: [], npcs: [] },
  looseEnds: [],
  sceneMemories: [],
  worldBible: [],
  worldRules: [],
  plotThreads: [],
  threadsNow: {},
  threadsPlan: {},
  threadsQuestion: {},
  threadsDue: {},
  threadParts: {},
  npcParts: {},
  summary: "",
  summaryReplies: 0,
  recentSummary: "",
  directorsNotes: [],
  worldBrief: "",
  chapters: [],
  chapterReady: false,
  storyTime: null,
  pcAppearance: "",
  era: "",
};

const stringList = z.array(z.string());

/** What each Snapshot section must hold, for a Save that comes from outside the app. */
export const StateSections = {
  inventory: z.object({ wearing: stringList, carrying: stringList }),
  status: z.object({ health: z.string(), injuries: stringList, conditions: stringList }),
  npcs: z.array(z.object({ name: z.string(), appearance: z.string() })),
  npcKnows: z.record(z.string(), stringList),
  scene: z.object({ location: z.string(), visibleCast: stringList }),
  pcKnown: z.object({ facts: stringList, npcs: stringList, summaries: z.record(z.string(), z.string()).optional() }),
  looseEnds: stringList,
  sceneMemories: z.array(z.object({ firstMessage: z.number().int(), lastMessage: z.number().int(), text: z.string() })),
  worldBible: z.array(z.object({ title: z.string(), keywords: stringList, content: z.string(), alwaysOn: z.boolean() })),
  worldRules: stringList,
  plotThreads: stringList,
  threadsNow: z.record(z.string(), z.string()),
  threadsPlan: z.record(z.string(), z.string()),
  threadsQuestion: z.record(z.string(), z.string()),
  threadsDue: z.record(z.string(), z.number()),
  threadParts: z.record(z.string(), stringList),
  npcParts: z.record(z.string(), stringList),
  summary: z.string(),
  summaryReplies: z.number().int().nonnegative(),
  recentSummary: z.string(),
  directorsNotes: stringList,
  worldBrief: z.string(),
  chapters: z.array(z.object({ lastMessage: z.number().int().nullable(), title: z.string() })),
  chapterReady: z.boolean(),
  storyTime: z
    .object({ day: z.number().int(), date: z.string(), timeOfDay: z.string(), hours: z.number().optional(), dateDue: z.boolean().optional() })
    .nullable(),
  pcAppearance: z.string(),
  era: z.string(),
} satisfies { [Section in keyof State]: z.ZodType<State[Section]> };

const nonEmpty = z.string().min(1);
const statusKind = z.enum(["injuries", "conditions"]);

export const StateOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_item"), slot: z.enum(["wearing", "carrying"]), item: nonEmpty }),
  z.object({ op: z.literal("remove_item"), item: nonEmpty }),
  z.object({ op: z.literal("set_health"), health: nonEmpty }),
  z.object({ op: z.literal("add_status"), kind: statusKind, text: nonEmpty }),
  z.object({ op: z.literal("remove_status"), kind: statusKind, text: nonEmpty }),
  z.object({ op: z.literal("add_npc"), name: nonEmpty, appearance: nonEmpty }),
  z.object({ op: z.literal("update_npc"), name: nonEmpty, appearance: nonEmpty }),
  z.object({ op: z.literal("merge_npc"), name: nonEmpty, into: nonEmpty }),
  z.object({
    op: z.literal("npc_learns"),
    name: nonEmpty,
    fact: nonEmpty.describe("one short sentence of what this NPC learned or lived through in play, as they would remember it"),
  }),
  z.object({ op: z.literal("set_scene"), location: nonEmpty, visible_cast: z.array(nonEmpty) }),
  z.object({ op: z.literal("add_known_fact"), fact: nonEmpty }),
  z.object({ op: z.literal("update_known_fact"), fact: nonEmpty, replacement: nonEmpty }),
  z.object({ op: z.literal("remove_known_fact"), fact: nonEmpty }),
  z.object({ op: z.literal("add_known_npc"), name: nonEmpty }),
  z.object({ op: z.literal("set_known_npc_summary"), name: nonEmpty, summary: nonEmpty }),
  z.object({ op: z.literal("add_loose_end"), loose_end: nonEmpty }),
  z.object({ op: z.literal("resolve_loose_end"), loose_end: nonEmpty }),
  z.object({
    op: z.literal("add_lore_entry"),
    title: nonEmpty,
    keywords: z.array(nonEmpty).min(1),
    content: nonEmpty,
  }),
  z.object({
    op: z.literal("update_lore_entry"),
    title: nonEmpty,
    keywords: z.array(nonEmpty).min(1),
    content: nonEmpty,
  }),
  z.object({ op: z.literal("remove_lore_entry"), title: nonEmpty }),
  z.object({
    op: z.literal("update_plot_thread"),
    thread: nonEmpty,
    now: nonEmpty,
    plan: nonEmpty.nullable().default(null),
    truth: nonEmpty.nullable().default(null),
  }),
  z.object({ op: z.literal("resolve_plot_thread"), thread: nonEmpty }),
  z.object({ op: z.literal("set_pc_appearance"), appearance: nonEmpty }),
  z.object({ op: z.literal("set_era"), era: nonEmpty }),
  z.object({
    op: z.literal("set_story_time"),
    days_passed: z.number().int().min(0),
    // Missing reads as unknown, so a reply from before it still moves the clock by its words.
    hours_passed: z.preprocess((hours) => hours ?? null, z.number().min(0).nullable()),
    date: nonEmpty.nullable(),
    time_of_day: nonEmpty,
  }),
]);
export type StateOperation = z.infer<typeof StateOperation>;

const findNpc = (state: State, name: string) => state.npcs.find((npc) => npc.name === name);

export const named = (full: string, mark: string) => full.toLowerCase() === mark.toLowerCase() || full.toLowerCase().split(" ").includes(mark.toLowerCase());

/** How many letters must change to turn one word into the other. */
function editDistance(one: string, other: string) {
  let row = Array.from({ length: other.length + 1 }, (_, at) => at);
  for (let at = 1; at <= one.length; at++) {
    const next = [at];
    for (let to = 1; to <= other.length; to++) next[to] = Math.min(row[to]! + 1, next[to - 1]! + 1, row[to - 1]! + (one[at - 1] === other[to - 1] ? 0 : 1));
    row = next;
  }
  return row[other.length]!;
}

/** Narrators shorten names, so part of one counts when it can only mean one person. */
export function findPerson<Npc extends { name: string }>(npcs: Npc[], mark: string) {
  const exact = npcs.find(({ name }) => name === mark);
  if (exact) return exact;
  // Or every word of it a name of theirs, as a speaker named without their title was added as a second person and portrait.
  // Its title left out where a full name remains, as a thread's "Reverend Amos Thorne" and a page's "Amos Thorne" were kept as two
  // people, but not from "Mrs. Owen", who is no Owen Kade.
  const untitled = mark.split(/\s+/).filter((word) => !TITLES.has(word.toLowerCase().replace(/\.$/, "")));
  const words = untitled.length >= 2 ? untitled : mark.split(/\s+/);
  const partly = npcs.filter(({ name }) => named(name, mark) || words.every((word) => nameForms(name).includes(word)));
  if (partly.length === 1) return partly[0];
  // Or, matching no one, every word after its first where two or more remain, as a garbled "Rerend Amos Thorne" or a
  // "Constable Owen Price" whose title is also a surname became a second person.
  const rest = mark.split(/\s+/).slice(1);
  const byRest = partly.length === 0 && rest.length >= 2 ? npcs.filter(({ name }) => rest.every((word) => nameForms(name).includes(word))) : [];
  return byRest.length === 1 ? byRest[0] : undefined;
}

const itemWords = (item: string) =>
  ` ${
    item
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") ?? ""
  } `;
/** Whether two items are one: the same words, or one holding all of the other's two words or more in a row. */
const sameItem = (held: string, item: string) => {
  const [shorter, longer] = [itemWords(held), itemWords(item)].sort((a, b) => a.length - b.length) as [string, string];
  return shorter === longer || (shorter.trim().includes(" ") && longer.includes(shorter));
};

function take(list: string[], value: string) {
  const index = list.indexOf(value);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

// Status reads as words in the story, never as points or percentages.
// shortcut: spelled-out numbers pass and only the Narrator prompt stops them, screen them if models write them.
export const hasNumber = (text: string) => /\p{N}/u.test(text);

/** The most injuries, and the most conditions, the PC keeps, so the status the player reads stays a line or two. */
export const MAX_STATUS = 3;

/** The most Plot Threads the Narrator keeps open, so it isn't pulling on a dozen at once. A world starts with three to six. */
export const MAX_PLOT_THREADS = 8;

/** The most an NPC's list of what they know keeps, newest last, so the lists of a crowded scene stay a few lines each. */
export const MAX_NPC_KNOWS = 12;
// Of those, how many may be parts of threads, which the cap keeps.
const MAX_PARTS = 4;

// Saying what someone doesn't know, which an NPC's list read as what they do, and which goes stale once they learn it.
// Any verb of knowing or learning denied, or with nothing or no one as what is known, as "has not heard of", "heard nothing of"
// and "knows of no" reached the lists.
const UNKNOWING =
  /\b(?:(?:does|did|do|has|have|had|is|was|were)(?:n't| not)(?: yet)? (?:know|heard|seen|learned|learnt|been told|aware)|(?:knows?|knew|heard|seen|saw|learned|learnt|been told)(?: yet)? (?:nothing|none|of no(?:ne|thing)?|no one|of no one)|knows? no\b|but nothing (?:yet )?(?:of|about)|(?:has|have|had) (?:never|no idea)|never (?:learned|learnt|heard|knew|saw|been told)|no idea|unaware|but not (?:what|who|whom|where|when|why|how|whether|that|of|about)\b)/i;
// Clauses split where a fact goes on, keeping the joining word with the clause it starts. "But" without a comma too, as "has
// the evidence but has heard nothing of" was one clause.
const CLAUSES = /(\s*;\s*|,\s+(?=(?:but|and|though|yet|while|nor)\b)|\s+(?=but\b))/i;

/** A fact an NPC learns without its clauses saying what they don't know, or "" when that is all it says. */
export function knownOnly(fact: string) {
  if (!UNKNOWING.test(fact)) return fact;
  const pieces = fact.split(CLAUSES);
  const kept: string[] = [];
  for (let at = 0; at < pieces.length; at += 2) {
    const clause = pieces[at]!;
    if (UNKNOWING.test(clause) || /^nor\b/i.test(clause)) continue;
    kept.push(kept.length === 0 ? clause.replace(/^(?:but|and|though|yet|while)\s+/i, "") : `${pieces[at - 1]}${clause}`);
  }
  const text = kept.join("").trim();
  if (!/\p{L}{2}/u.test(text)) return "";
  return `${text[0]!.toUpperCase()}${text.slice(1).replace(/[\s,;:]+$/, "")}${/[.!?]$/.test(text) ? "" : "."}`;
}

function addOnce(list: string[], value: string) {
  if (list.includes(value)) return false;
  list.push(value);
  return true;
}

/**
 * Puts `replacement` where `value` was, or on the end if `value` isn't there, as a long text is easily miscopied and
 * that isn't worth a whole response. If `replacement` is already there, the two versions become one.
 */
function replaceOnce(list: string[], value: string, replacement: string) {
  const index = list.indexOf(value);
  take(list, value);
  if (!list.includes(replacement)) list.splice(index === -1 ? list.length : index, 0, replacement);
}

// Words shorter than four letters are skipped too, so these are only the common longer ones.
const COMMON_WORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "they",
  "their",
  "them",
  "have",
  "been",
  "will",
  "into",
  "when",
  "what",
  "were",
  "than",
  "then",
  "there",
  "about",
  "would",
  "which",
  "while",
]);
const wordsOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}]{4,}/gu)
      ?.filter((word) => !COMMON_WORDS.has(word)),
  );

/**
 * The thread `text` names: itself, or else the one sharing most of its words, as Narrators paraphrase a long thread they
 * were told to copy. Threads in one story share names, so it takes half the longer one's words, and a tie is no match.
 */
export function closestThread(threads: string[], text: string) {
  if (threads.includes(text)) return text;
  const words = wordsOf(text);
  const scored = threads.map((thread) => {
    const theirs = wordsOf(thread);
    return { thread, score: [...words].filter((word) => theirs.has(word)).length / Math.max(words.size, theirs.size, 1) };
  });
  const [best, next] = scored.sort((a, b) => b.score - a.score);
  return best && best.score >= 0.5 && best.score !== next?.score ? best.thread : undefined;
}

/**
 * Makes `name` and `into` one person, or renames `name` if `into` isn't in the state. Someone already gone is no reason to
 * lose a response. Portraits stay as they are, so a Revert needs nothing undone: the known list hides the merged one's.
 */
function mergeNpc(state: State, name: string, into: string) {
  const npc = findNpc(state, name);
  if (!npc || name === into) return;
  const { pcKnown, scene } = state;
  if (findNpc(state, into)) state.npcs = state.npcs.filter((other) => other !== npc);
  else npc.name = into;
  if (pcKnown.npcs.includes(name)) replaceOnce(pcKnown.npcs, name, into);
  if (scene.visibleCast.includes(name)) replaceOnce(scene.visibleCast, name, into);
  const { [name]: summary, ...summaries } = pcKnown.summaries ?? {};
  if (summary !== undefined) pcKnown.summaries = { [into]: summary, ...summaries };
  mergeNpcKnows(state, name, into);
}

/** At most MAX_NPC_KNOWS of what someone knows, dropping the oldest, but never their parts, as those were their secrets. */
const capped = (knows: string[], parts: string[] = []) => {
  const learned = knows.filter((fact) => !parts.includes(fact));
  const room = learned.slice(Math.max(0, learned.length - Math.max(0, MAX_NPC_KNOWS - (knows.length - learned.length))));
  return knows.filter((fact) => parts.includes(fact) || room.includes(fact));
};
const own = (record: Record<string, string[]>, name: string) => (Object.hasOwn(record, name) ? record[name]! : []);

function mergeNpcKnows(state: State, name: string, into: string) {
  if (Object.hasOwn(state.npcParts, name)) {
    const { [name]: given = [], ...parts } = state.npcParts;
    state.npcParts = { ...parts, [into]: [...new Set([...own(parts, into), ...given])] };
  }
  if (!Object.hasOwn(state.npcKnows, name)) return;
  const { [name]: knew = [], ...knows } = state.npcKnows;
  const kept = own(knows, into);
  // The kept one's own last, shared ones too, so the cap drops the other's first.
  state.npcKnows = { ...knows, [into]: capped([...knew.filter((fact) => !kept.includes(fact)), ...kept], own(state.npcParts, into)) };
}

/** What this reply made of each Plot Thread's truth it changed, its amended truth or null once resolved. */
type ThreadsSoFar = { became: Map<string, string | null>; held?: Set<string> };

/**
 * The open thread `text` names, followed to what this reply made of it, so that a thread already changed is never matched
 * to another that shares its words. `resolved` when this reply closed it.
 */
function namedThread(state: State, text: string, { became }: ThreadsSoFar) {
  // Only those the prompt showed, as a Save from before the limit can hold more.
  const shown = state.plotThreads.slice(0, MAX_PLOT_THREADS);
  // Once each, as a thread in two lists would tie with itself and match nothing.
  const named = closestThread([...new Set([...shown, ...became.keys()])], text);
  if (named === undefined || shown.includes(named)) return { thread: named };
  let now: string | null | undefined = named;
  // A few steps at most, in case a reply rewrites a thread back and forth.
  for (let step = 0; typeof now === "string" && !shown.includes(now) && became.has(now) && step < MAX_PLOT_THREADS; step++) now = became.get(now);
  return now === null ? { resolved: true } : { thread: now };
}

/** Changes `state` and returns nothing, or returns why `operation` is disproved, having changed nothing. The reason goes to the Server Log, so it never quotes the operation. */
function apply(state: State, operation: StateOperation, threads: ThreadsSoFar = { became: new Map() }): string | undefined {
  switch (operation.op) {
    case "add_item": {
      // Worn or carried, the same thing held twice was the same notebook three times and a shawl both worn and carried. A fuller
      // name replaces the old where it is, as models restate what is held with how it is now.
      // The same words twice in one reply may be two of a thing, as "two lengths of rope" are, so only one held before it repeats.
      for (const list of [state.inventory.wearing, state.inventory.carrying]) {
        const at = list.findIndex((held) => sameItem(held, operation.item));
        if (at < 0) continue;
        if (itemWords(list[at]!) !== itemWords(operation.item)) list[at] = operation.item;
        else if (!threads.held?.has(itemWords(operation.item))) break;
        else return "already there";
        return;
      }
      state.inventory[operation.slot].push(operation.item);
      return;
    }
    case "remove_item":
      if (take(state.inventory.carrying, operation.item) || take(state.inventory.wearing, operation.item)) return;
      // The old name of what an add just gave a fuller one, as a reply adds the new and removes the old: it is the same thing, still held.
      return [...state.inventory.wearing, ...state.inventory.carrying].some((held) => sameItem(held, operation.item)) ? undefined : "not held";
    case "set_health":
      if (hasNumber(operation.health)) return "has a number";
      state.status.health = operation.health;
      return;
    case "add_status":
      if (hasNumber(operation.text)) return "has a number";
      if (!addOnce(state.status[operation.kind], operation.text)) return "already there";
      // The oldest goes, as Narrators often forget to remove what has passed.
      state.status[operation.kind] = state.status[operation.kind].slice(-MAX_STATUS);
      return;
    case "remove_status":
      return take(state.status[operation.kind], operation.text) ? undefined : "not there";
    case "add_npc": {
      // No two people share a name, so adding someone already there gives them the looks they now have, as update_npc would.
      // By another form of a full name with a title too, as a garbled speaker label, "Rerend Amos Thorne", was added as a second
      // person and portrait. Only three words or more, so a short name spelled otherwise, "mara" beside "Mara", stays its own.
      const titled = operation.name.split(/\s+/).length >= 3;
      const found = titled ? findPerson(state.npcs, operation.name) : undefined;
      // Only where its first word is a title, or a misspelling of one or of their own name, so a father "Thomas Owen Price" isn't
      // taken for Owen Price.
      const first = operation.name.split(/\s+/)[0]!.toLowerCase().replace(/\.$/, "");
      const forms = [...TITLES, ...(found?.name.toLowerCase().split(/\s+/) ?? [])];
      const same = found && (TITLES.has(first) || forms.some((word) => word.length >= 5 && first.length >= 5 && editDistance(first, word) <= 2));
      const npc = findNpc(state, operation.name) ?? (same ? found : undefined);
      if (npc) npc.appearance = lasting(operation.appearance);
      else state.npcs.push({ name: operation.name, appearance: lasting(operation.appearance) });
      // What World Moves On gave them to know before they were met, under the name a thread gave them.
      const unmet = Object.keys(state.npcKnows).find(
        (name) => name !== operation.name && !findNpc(state, name) && (findPerson([{ name }], operation.name) || findPerson([{ name: operation.name }], name)),
      );
      if (unmet) mergeNpcKnows(state, unmet, operation.name);
      return;
    }
    case "update_npc": {
      const npc = findNpc(state, operation.name);
      if (!npc) return "no such NPC";
      npc.appearance = lasting(operation.appearance);
      return;
    }
    case "merge_npc":
      mergeNpc(state, operation.name, operation.into);
      return;
    case "npc_learns": {
      // A reply squeezed by its schema can send a scrap here, and then they just know less.
      const name = findPerson(state.npcs, operation.name)?.name;
      if (!name) return "no such NPC";
      if (!/\p{L}/u.test(operation.fact)) return "no words";
      // Without a trailing run of symbols, as a reviewer's "+#+#+#" was kept and sent in every prompt after.
      const fact = knownOnly(operation.fact.replace(/[^\p{L}\p{N}\s.!?"'’)]{3,}$/u, "").trim());
      if (!fact) return "only what they don't know";
      // Own keys only, as a name such as "constructor" would find what every object has.
      const knows = Object.hasOwn(state.npcKnows, name) ? state.npcKnows[name]! : [];
      if (!addOnce(knows, fact)) return "already there";
      state.npcKnows = { ...state.npcKnows, [name]: capped(knows, own(state.npcParts, name)) };
      return;
    }
    case "set_scene": {
      // The cast only steers images, so a name the state lacks is left out rather than failing the Turn.
      const visibleCast = [...new Set(operation.visible_cast)].filter((name) => findNpc(state, name));
      state.scene = { location: operation.location, visibleCast };
      return;
    }
    // A repeat is already true, so it costs nothing, and refusing one would throw away a whole response.
    case "add_known_fact":
      addOnce(state.pcKnown.facts, operation.fact);
      return;
    case "update_known_fact":
      replaceOnce(state.pcKnown.facts, operation.fact, operation.replacement);
      return;
    case "remove_known_fact":
      take(state.pcKnown.facts, operation.fact);
      return;
    case "add_known_npc":
      if (!findNpc(state, operation.name)) return "no such NPC";
      addOnce(state.pcKnown.npcs, operation.name);
      return;
    case "set_known_npc_summary":
      if (!state.pcKnown.npcs.includes(operation.name)) return "NPC not known";
      state.pcKnown.summaries = { ...state.pcKnown.summaries, [operation.name]: operation.summary };
      return;
    case "add_loose_end":
      addOnce(state.looseEnds, operation.loose_end);
      return;
    case "resolve_loose_end":
      return take(state.looseEnds, operation.loose_end) ? undefined : "not there";
    case "add_lore_entry": {
      const { title, keywords, content } = operation;
      // The Narrator only sees activated entries, so it can repeat a title innocently: keep the first, not fail the Turn.
      if (state.worldBible.some((entry) => entry.title === title)) return;
      // Always-on entries bypass the token budget, so the Narrator can only add keyword-activated ones.
      state.worldBible.push({ title, keywords, content, alwaysOn: false });
      return;
    }
    case "update_lore_entry": {
      const { title, keywords, content } = operation;
      const entry = state.worldBible.find((lore) => lore.title === title);
      // Always-on entries bypass the token budget, so the Narrator can't grow one.
      if (entry?.alwaysOn) return;
      if (entry) Object.assign(entry, { keywords, content });
      else state.worldBible.push({ title, keywords, content, alwaysOn: false });
      return;
    }
    case "remove_lore_entry":
      state.worldBible = state.worldBible.filter(({ title, alwaysOn }) => alwaysOn || title !== operation.title);
      return;
    case "update_plot_thread": {
      const { thread, resolved } = namedThread(state, operation.thread, threads);
      // Closed earlier in this reply, so a rewrite mustn't open it again.
      if (resolved) return;
      // Not added, as a Turn adds no thread: World Moves On does. A DeepSeek Turn's unmatched rewrites took three threads to six.
      if (thread === undefined) return "matches no thread";
      const truth = operation.truth ?? thread;
      const { [thread]: _was, ...others } = state.threadsNow;
      state.threadsNow = { ...others, [truth]: operation.now };
      const { [thread]: _planned, ...otherPlans } = state.threadsPlan;
      state.threadsPlan = operation.plan ? { ...otherPlans, [truth]: operation.plan } : otherPlans;
      // A Turn's plan has no hour on the clock, so the old one goes with the old plan.
      const { [thread]: _due, ...otherDue } = state.threadsDue;
      state.threadsDue = otherDue;
      const { [thread]: question, ...otherQuestions } = state.threadsQuestion;
      if (question) state.threadsQuestion = { ...otherQuestions, [truth]: question };
      const { [thread]: parts, ...otherParts } = state.threadParts;
      if (parts) state.threadParts = { ...otherParts, [truth]: parts };
      replaceOnce(state.plotThreads, thread, truth);
      if (thread !== truth) threads.became.set(thread, truth);
      return;
    }
    case "resolve_plot_thread": {
      const { thread, resolved } = namedThread(state, operation.thread, threads);
      if (resolved) return;
      // Ignored, not refused, as DeepSeek resolved threads long gone, which failed whole Turns.
      if (thread === undefined || !take(state.plotThreads, thread)) return "matches no thread";
      const { [thread]: _gone, ...open } = state.threadsNow;
      state.threadsNow = open;
      const { [thread]: _plan, ...openPlans } = state.threadsPlan;
      state.threadsPlan = openPlans;
      const { [thread]: _question, ...openQuestions } = state.threadsQuestion;
      state.threadsQuestion = openQuestions;
      const { [thread]: _due, ...openDue } = state.threadsDue;
      state.threadsDue = openDue;
      const { [thread]: _parts, ...openParts } = state.threadParts;
      state.threadParts = openParts;
      threads.became.set(thread, null);
      return;
    }
    case "set_pc_appearance":
      state.pcAppearance = operation.appearance;
      return;
    case "set_era":
      // Set once, as changing it later is the drift it exists to stop.
      if (state.era) return "already there";
      state.era = operation.era;
      return;
    case "set_story_time": {
      const { time_of_day } = operation;
      const before = state.storyTime;
      // A new day only where the hours or the words reach one, as a ten-yard walk from a quarter to six to a quarter past was given
      // a day and the next date, and a date once moved on never comes back. Not a date the clock is waiting on, nor a clock it lacks.
      const wentBack = (hourOf(time_of_day) ?? 24) < (hourOf(before?.timeOfDay ?? "") ?? 0);
      const reached =
        operation.days_passed === 0 ||
        !before ||
        before.dateDue ||
        before.hours === undefined ||
        operation.hours_passed === null ||
        wentBack ||
        Math.floor((before.hours + operation.hours_passed) / 24) > Math.floor(before.hours / 24);
      const date = (reached ? operation.date : null) ?? before?.date;
      if (date === undefined) return "no date";
      // The date wins over days_passed when they disagree, as models gave the day count there, doubling it each time (day 280 in
      // 30 rounds); and a day the clock already rolled, waiting on its date, isn't counted again when the date comes.
      const claimed = !reached || operation.date === before?.date ? 0 : operation.days_passed;
      const days = before?.dateDue && date !== before.date ? Math.max(0, claimed - 1) : claimed;
      const hours = clockHours(before, (before?.day ?? 1) + days, time_of_day, operation.hours_passed);
      // Past midnight on the clock is a new day, as a reply from ten at night to three in the morning gave no days or date, and
      // the story stayed on Monday to the end.
      // Only where the words go back past midnight, or, naming no hour, where this reply's own hours crossed it, as hours
      // over-counted on talk would put an afternoon on the next day.
      const [from, to] = [hourOf(before?.timeOfDay ?? ""), hourOf(time_of_day)];
      const crossed = operation.hours_passed !== null && Math.floor(hours / 24) > Math.floor((before?.hours ?? hours) / 24);
      const wordsRoll = from !== undefined && to !== undefined ? to < from : crossed;
      const day = Math.max((before?.day ?? 1) + days, wordsRoll ? Math.floor(hours / 24) + 1 : 0);
      // Back to a clock time the words give, where far from the count, so it never drifts from what the page says; never to
      // words alone, as "three in the morning" reads as morning's nine.
      const at = clockTimeOf(time_of_day);
      const named = at === undefined ? undefined : (day - 1) * 24 + at;
      const clock = named !== undefined && Math.abs(hours - named) > DRIFT_HOURS ? named : hours;
      const newDay = day > (before?.day ?? 1);
      // Never back within a day, as a reply that did so had started the story over from its first morning.
      const [was, now] = [dayPart(before?.timeOfDay), dayPart(time_of_day)];
      // From night on, the small hours and the next morning come after, as "past midnight" refused them all for five rounds.
      const wraps = was !== undefined && was >= NIGHT && now !== undefined && (now >= NIGHT || now <= MORNING);
      // By the hours too, as clock times such as "3 pm" to "9 am" have no part of the day in words to compare.
      const hoursBack = from !== undefined && to !== undefined && to < from && !nightWraps(from, to);
      if (!newDay && date === before?.date && ((was !== undefined && now !== undefined && now < was && !wraps) || hoursBack)) return "earlier than now";
      // A new day with no date of its own keeps the old one until a Turn names it, as code can't reckon a world's calendar.
      const dateDue = (newDay || before?.dateDue) && date === before?.date;
      state.storyTime = { day, date, timeOfDay: withoutDate(time_of_day, date), hours: clock, ...(dateDue && { dateDue: true }) };
      return;
    }
  }
}

/** The time of day without the parts that only repeat the date, as "mid-morning, Tuesday 16th October" showed the date twice. */
function withoutDate(timeOfDay: string, date: string) {
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const inDate = new Set(words(date));
  const parts = timeOfDay.split(/\s*,\s*/).filter((part) => !words(part).every((word) => inDate.has(word)));
  return parts.length > 0 ? parts.join(", ") : timeOfDay;
}

// First match wins, so "afternoon" isn't read as "noon" nor "midnight" as "night".
const DAY_PARTS: [RegExp, number][] = [
  [/midnight/i, 7],
  [/afternoon/i, 4],
  [/evening|dusk|sunset/i, 5],
  [/night/i, 6],
  [/noon|midday/i, 3],
  [/dawn|sunrise|daybreak|early morning/i, 1],
  [/morning/i, 2],
];
// What someone holds, or where they are or what they are doing, which passes with the scene, as a looks of "hat in hand, gone
// out into the rain" redrew a portrait. The weather and the road's dirt too, as "rain-dark shoulders" redrew one soaked, and a
// passing pallor, bonds or a garment taken off and put down, as "coat folded over a barrel" redrew one coatless, or carried on
// an arm, as another man's coat "under his arm" stayed in a constable's looks.
// Bare feet too, as a man was drawn barefoot in the morning from the night before.
// shortcut: whole comma clauses by these words; add a word when another passing state sticks.
const PASSING =
  /\b(?:holding|carrying|carried|clutch(?:ing|ed)|gripp(?:ing|ed)|kneeling|crouching|sitting|seated|lying|leaning|standing (?:at|in|by|on|beside|over|before)|gone (?:out|off|away|into|to|back)|in (?:his|her|their|one) (?:other )?hand|in hand|held (?:high|low|up|out)|rain-\w+|wet|soaked|sodden|drenched|dripping|damp|dusty|dust|mud-\w+|muddied|windblown|caked|crusted|drained|ashen|flushed|(?:wrists|hands|arms|ankles) (?:bound|tied)|(?:bound|tied) (?:before|behind)|manacled|shackled|in irons|(?:taken|pulled|shrugged) off|(?:coat|jacket|cloak|hat|cap|shirt|boots) off|bare-?foot(?:ed)?|folded (?:over|on|across)|left (?:below|behind)|(?:under|over|across) (?:his|her|their|one|an?) arms?|tucked)\b/i;
/** The looks without their passing clauses, or as written if nothing else is left. */
const lasting = (appearance: string) => {
  const kept = appearance
    .split(",")
    .filter((clause) => !PASSING.test(clause))
    .join(",")
    .trim();
  return kept || appearance;
};

/**
 * Whether going from one hour back to an earlier one is the night running on past midnight: from night, about eight on, to the
 * next morning, as the words' own check has it, so evening to mid-morning is still a story starting over.
 */
const nightWraps = (from: number, to: number) => from >= 20 && to < 12;

// Hours the count may stray from a clock time the words give before it is set back to it.
const DRIFT_HOURS = 3;

/**
 * The story hours since the Opening after a set_story_time: the old count plus the reply's hours_passed, or the hours its words
 * moved on when it gives none, never short of the days passed. A Save from before it starts from its day and time of day.
 */
function clockHours(was: StoryTime | null, day: number, timeOfDay: string, passed: number | null) {
  // A first Story Time starts at its own hour of day 1.
  const start = was?.hours ?? (was ? (was.day - 1) * 24 + (hourOf(was.timeOfDay) ?? 12) : (hourOf(timeOfDay) ?? 12));
  const [from, to] = [hourOf(was?.timeOfDay ?? ""), hourOf(timeOfDay)];
  // Forward within the day, or on through the night into the small hours, as words going back from evening to the next morning
  // are a story starting over, not a night passing, but "11 pm" to "1 am" is two hours.
  const byWords = from === undefined || to === undefined ? 0 : to >= from ? to - from : nightWraps(from, to) ? to + 24 - from : 0;
  // More than the days passed allow is the running total, as a reply gave 29.65 hours since the opening for a quarter hour's talk.
  const fits = passed !== null && passed <= (day - (was?.day ?? 1) + 1) * 24;
  // A first Story Time is its own hour, as hours_passed then counts from nothing the clock had.
  const hours = start + (!was ? 0 : fits ? passed : day === was.day ? byWords : 0);
  // A new day the hours didn't reach, as days_passed is the surer of the two.
  return Math.max(hours, (day - 1) * 24);
}

// Checked in order, as "afternoon" holds "noon" and "midnight" holds "night".
const HOURS: [RegExp, number][] = [
  [/midnight/, 0],
  [/afternoon/, 15],
  [/noon|midday/, 12],
  [/dawn|sunrise|daybreak/, 6],
  [/morning/, 9],
  [/dusk|sunset|twilight/, 18],
  [/evening/, 19],
  [/night/, 22],
];

/** The hour a time of day gives as a clock time, such as "9:30 pm", or undefined. */
function clockTimeOf(timeOfDay: string) {
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i.exec(timeOfDay);
  return clock ? (Number(clock[1]) % 12) + (clock[3]!.toLowerCase() === "p" ? 12 : 0) + Number(clock[2] ?? 0) / 60 : undefined;
}

/** The hour a time of day names, by its clock time or its words, or undefined when it names neither. */
export function hourOf(timeOfDay: string) {
  return clockTimeOf(timeOfDay) ?? HOURS.find(([words]) => words.test(timeOfDay.toLowerCase()))?.[1];
}

const [MORNING, NIGHT] = [2, 6];
/** Where in the day a time of day falls, in order, or undefined for words that don't say. */
export const dayPart = (timeOfDay = "") => DAY_PARTS.find(([words]) => words.test(timeOfDay))?.[1];

const isRepeat = ({ pcKnown, looseEnds }: State, operation: StateOperation) =>
  (operation.op === "add_known_fact" && pcKnown.facts.includes(operation.fact)) ||
  (operation.op === "add_known_npc" && pcKnown.npcs.includes(operation.name)) ||
  (operation.op === "add_loose_end" && looseEnds.includes(operation.loose_end));

// None of these contradict the narration, so they aren't worth a whole response. Someone nameless is added once they're named.
const IGNORABLE: StateOperation["op"][] = ["resolve_loose_end", "add_known_npc", "set_known_npc_summary", "set_story_time", "npc_learns"];
const isHarmless = ({ op, reason }: { op: StateOperation["op"]; reason: string }) =>
  IGNORABLE.includes(op) || reason === "already there" || reason === "matches no thread";

/** Applies operations in order, so each is judged against the ones before it. */
export function applyOperations(state: State, operations: StateOperation[]) {
  const next = structuredClone(state);
  let repeats = 0;
  const threads: ThreadsSoFar = { became: new Map(), held: new Set([...state.inventory.wearing, ...state.inventory.carrying].map(itemWords)) };
  const refusals = operations.flatMap(({ ...operation }) => {
    if (isRepeat(next, operation)) repeats++;
    const reason = apply(next, operation, threads);
    return reason ? [{ op: operation.op, reason }] : [];
  });
  return { next, refused: refusals.filter((refusal) => !isHarmless(refusal)), ignored: refusals.filter(isHarmless), repeats };
}

export type World = Pick<State, "worldBible" | "worldRules" | "plotThreads">;

const words = z.string().trim().min(1);
// Untrimmed, as a quote must match what a Turn stored, and Turns store text as it came.
const quote = z.string().min(1);
export const namesSomething = (change: { old: string | null; new: string | null }) => change.old !== null || change.new !== null;

export const LoreEntryReply = z.object({ title: words, keywords: z.array(words).min(3), content: words });

/** One entry of a list: replaces `old`, or adds when `old` is null, or removes it when `new` is null. */
export const ListChange = z.object({ old: quote.nullable(), new: words.nullable() }).refine(namesSomething);
export type ListChange = z.infer<typeof ListChange>;

/** A change to a world already written, holding only what changes, so a reply can't lose an entry by leaving it out. Each Lore Entry is added, or replaces the one with its exact title. */
export const WorldUpdate = z.object({
  lore_entries: z.array(LoreEntryReply),
  removed_lore: z.array(quote),
  world_rules: z.array(ListChange),
  plot_threads: z.array(ListChange),
});
export type WorldUpdate = z.infer<typeof WorldUpdate>;

/** An edit can outlive the entry it names, when a replaced response took that entry away, so a missing `old` adds rather than failing. */
export function changeList(list: string[], change: ListChange) {
  const at = change.old === null ? -1 : list.indexOf(change.old);
  const added = change.new === null ? [] : [change.new];
  return [...new Set(at < 0 ? [...list, ...added] : list.toSpliced(at, 1, ...added))];
}

export function mergeWorldUpdate(world: World, update: WorldUpdate): World {
  const written = new Map(update.lore_entries.map((entry) => [entry.title, entry]));
  const kept = world.worldBible.filter(({ title }) => !update.removed_lore.includes(title));
  const added = update.lore_entries.filter(({ title }) => !kept.some((entry) => entry.title === title));
  return {
    worldBible: [
      ...kept.map((entry) => ({ ...entry, ...written.get(entry.title) })),
      // Always-on entries bypass the token budget, so the Narrator can only add keyword-activated ones.
      ...added.map((entry) => ({ ...entry, alwaysOn: false })),
    ],
    worldRules: update.world_rules.reduce(changeList, world.worldRules),
    plotThreads: update.plot_threads.reduce(changeList, world.plotThreads),
  };
}

/** What the player can change directly, which is all text they can already read. */
export const VisibleEdit = z.discriminatedUnion("edit", [
  z.object({ edit: z.literal("worldBrief"), text: words }),
  z.object({ edit: z.literal("summary"), text: words }),
  z.object({ edit: z.literal("recentSummary"), text: words }),
  z.object({ edit: z.literal("fact"), old: quote.nullable(), new: words.nullable() }).refine(namesSomething),
  z.object({ edit: z.literal("looseEnd"), old: quote.nullable(), new: words.nullable() }).refine(namesSomething),
  z.object({ edit: z.literal("npcSummary"), name: words, text: words }),
  // Text only: the range stays the server's. Never give a Narrator reply this edit, as no model rewrites a stored memory.
  z.object({ edit: z.literal("sceneMemory"), firstMessage: z.number().int(), text: words }),
  // The place in `chapters`, as titles needn't be unique.
  z.object({ edit: z.literal("chapterTitle"), index: z.number().int().min(0), title: words }),
  // Never the day count, which only measures the days played.
  z.object({ edit: z.literal("storyTime"), date: words, timeOfDay: words }),
]);

export type VisibleEdit = z.infer<typeof VisibleEdit>;

/** A change made between Messages. Snapshots are immutable, so these wait on the Save for the next Message to store. */
export const WorldEdit = z.discriminatedUnion("edit", [
  ...VisibleEdit.options,
  // `made` counts the edits just before it that the same World Change wrote, which a Save from before it lacks.
  // `moved` marks World Moves On's, which settles none of the player's Journal edits and rests on the reply it followed.
  // `now` sets the now of each thread it names by its truth, after `update`, which a Save from before it lacks, and `plan` the
  // plan of each, which a thread whose now it sets without one loses.
  z.object({
    edit: z.literal("world"),
    update: WorldUpdate,
    now: z.record(z.string(), z.string()).optional(),
    plan: z.record(z.string(), z.string()).optional(),
    // World Moves On's: by truth, the question of each thread that had none, and each plan's due hour on storyTime's hours.
    question: z.record(z.string(), z.string()).optional(),
    due: z.record(z.string(), z.number()).optional(),
    made: z.number().int().min(0).optional(),
    moved: z.boolean().optional(),
    // World Moves On's: by name, each person's own part of the threads it wrote, kept as what they know.
    knows: z.record(z.string(), z.array(z.string())).optional(),
    // By truth, who those parts went to.
    parts: z.record(z.string(), z.array(z.string())).optional(),
  }),
  // Whole lists, as a World Change rewrites what the player says is wrong rather than one item at a time.
  z.object({ edit: z.literal("inventory"), wearing: z.array(z.string()), carrying: z.array(z.string()) }),
  z.object({ edit: z.literal("status"), health: z.string(), injuries: z.array(z.string()), conditions: z.array(z.string()) }),
  // Hidden like the rest of an NPC's looks, so only a World Change writes it.
  z.object({ edit: z.literal("npcLooks"), name: z.string(), appearance: z.string() }),
  z.object({ edit: z.literal("pcLooks"), appearance: z.string() }),
  // Only the server closes a Chapter, as it writes the title.
  z.object({ edit: z.literal("closeChapter"), title: z.string() }),
]);
export type WorldEdit = z.infer<typeof WorldEdit>;

/** The edits the player made themselves, leaving out each World Change and the edits it wrote. */
export function playersOwn(edits: WorldEdit[]) {
  const own: WorldEdit[] = [];
  for (const edit of edits) {
    if (edit.edit === "world") own.splice(own.length - (edit.made ?? 0));
    else own.push(edit);
  }
  return own;
}

export function applyEdit(state: State, edit: WorldEdit): State {
  switch (edit.edit) {
    case "worldBrief":
      return { ...state, worldBrief: edit.text };
    case "summary":
      return { ...state, summary: edit.text };
    case "recentSummary":
      return { ...state, recentSummary: edit.text };
    case "fact":
      return { ...state, pcKnown: { ...state.pcKnown, facts: changeList(state.pcKnown.facts, edit) } };
    case "looseEnd":
      return { ...state, looseEnds: changeList(state.looseEnds, edit) };
    case "npcSummary":
      return { ...state, pcKnown: { ...state.pcKnown, summaries: { ...state.pcKnown.summaries, [edit.name]: edit.text } } };
    // A replaced response can take the memory away, and with it what this names, so a miss changes nothing.
    case "sceneMemory":
      return {
        ...state,
        sceneMemories: state.sceneMemories.map((memory) => (memory.firstMessage === edit.firstMessage ? { ...memory, text: edit.text } : memory)),
      };
    case "world": {
      const merged = mergeWorldUpdate(state, edit.update);
      // A truth a World Change rewrites starts with no now, as the old one may no longer fit it, until the world next moves on.
      const now = { ...state.threadsNow, ...edit.now };
      const threadsNow = Object.fromEntries(merged.plotThreads.flatMap((truth) => (Object.hasOwn(now, truth) ? [[truth, now[truth]!]] : [])));
      const plans = Object.fromEntries(Object.entries(state.threadsPlan).filter(([truth]) => !Object.hasOwn(edit.now ?? {}, truth)));
      const plan = { ...plans, ...edit.plan };
      const threadsPlan = Object.fromEntries(merged.plotThreads.flatMap((truth) => (Object.hasOwn(plan, truth) ? [[truth, plan[truth]!]] : [])));
      // A question once set stays, and a due hour goes with the plan a move rewrote.
      const question = { ...edit.question, ...state.threadsQuestion };
      const threadsQuestion = Object.fromEntries(merged.plotThreads.flatMap((truth) => (Object.hasOwn(question, truth) ? [[truth, question[truth]!]] : [])));
      const due = { ...Object.fromEntries(Object.entries(state.threadsDue).filter(([truth]) => !Object.hasOwn(edit.now ?? {}, truth))), ...edit.due };
      const threadsDue = Object.fromEntries(merged.plotThreads.flatMap((truth) => (Object.hasOwn(due, truth) ? [[truth, due[truth]!]] : [])));
      // Under the name of someone met, or as named until they are, when add_npc takes it up.
      const had = (truth: string) => (Object.hasOwn(state.threadParts, truth) ? state.threadParts[truth]! : []);
      const given = (truth: string) => (edit.parts && Object.hasOwn(edit.parts, truth) ? edit.parts[truth]! : []);
      const partTakers = new Set(Object.values(edit.parts ?? {}).flat());
      const npcKnows = { ...state.npcKnows };
      const npcParts = { ...state.npcParts };
      for (const [name, parts] of Object.entries(edit.knows ?? {})) {
        const key = findPerson(state.npcs, name)?.name ?? name;
        const knew = own(npcKnows, key);
        const known = parts.map(knownOnly).filter((part) => part && !knew.includes(part));
        // shortcut: the last few parts only, so a long story's turnover of threads can't fill the cap with them; keep more if old secrets go missing.
        if (partTakers.has(name) && known.length > 0) npcParts[key] = [...own(npcParts, key), ...known].slice(-MAX_PARTS);
        if (known.length > 0 || knew.length > 0) npcKnows[key] = capped([...knew, ...known], own(npcParts, key));
      }
      const threadParts = Object.fromEntries(
        merged.plotThreads.flatMap((truth) => {
          const names = [...new Set([...had(truth), ...given(truth)])];
          return names.length > 0 ? [[truth, names]] : [];
        }),
      );
      return { ...state, ...merged, threadsNow, threadsPlan, threadsQuestion, threadsDue, npcKnows, npcParts, threadParts };
    }
    case "inventory":
      return { ...state, inventory: { wearing: edit.wearing, carrying: edit.carrying } };
    case "pcLooks":
      return { ...state, pcAppearance: edit.appearance };
    case "npcLooks":
      return { ...state, npcs: state.npcs.map((npc) => (npc.name === edit.name ? { ...npc, appearance: edit.appearance } : npc)) };
    case "status":
      return { ...state, status: { health: edit.health, injuries: edit.injuries.slice(-MAX_STATUS), conditions: edit.conditions.slice(-MAX_STATUS) } };
    case "storyTime":
      return { ...state, storyTime: { ...state.storyTime, day: state.storyTime?.day ?? 1, date: edit.date, timeOfDay: edit.timeOfDay, dateDue: undefined } };
    case "chapterTitle":
      return { ...state, chapters: state.chapters.map((chapter, index) => (index === edit.index ? { ...chapter, title: edit.title } : chapter)) };
    // A second close before any new Message would make an empty Chapter.
    case "closeChapter":
      return state.chapters.at(-1)?.lastMessage === null
        ? state
        : { ...state, chapters: [...state.chapters, { lastMessage: null, title: edit.title }], chapterReady: false };
  }
}

export const Person = z.object({ name: z.string().trim().min(1), appearance: z.string() });

/**
 * Makes everyone a response names a known NPC, as Narrators often forget to, ahead of `operations`, so that those can
 * use the new names. Returns the state and what's left of `operations` once anything this already did is taken out.
 */
export function introduce(state: State, people: z.infer<typeof Person>[], pcName: string, operations: StateOperation[]) {
  // Someone shortened to a name only one person has is that person, not someone new.
  const known = (name: string) => findPerson(state.npcs, name)?.name;
  // A list of people is never worth a Turn, so someone with no looks waits until they're named again. Each name once, the first
  // listing, as a second add_npc would give them its looks.
  const listed = new Set<string>();
  const introductions = people
    .filter(({ name, appearance }) => !named(pcName, name) && (known(name) || appearance.trim()))
    .filter(({ name }) => !listed.has(name) && listed.add(name))
    .flatMap(({ name, appearance }): StateOperation[] => {
      const kept = known(name) ?? name;
      return [
        ...(known(name) ? [] : [{ op: "add_npc" as const, name, appearance }]),
        ...(state.pcKnown.npcs.includes(kept) ? [] : [{ op: "add_known_npc" as const, name: kept }]),
      ];
    });
  // Two people with one given name can't be told apart, by the player or by the matching above.
  const taken = new Set([pcName, ...state.npcs.map(({ name }) => name)].map(givenName));
  // A full name learned later is added and the short one merged into it, as the prompt asks.
  const merging = new Set(operations.flatMap((operation) => (operation.op === "merge_npc" ? [operation.into] : [])));
  // Each name once, as a reply often lists someone in people and adds them in its operations too.
  const added = new Set(
    [...introductions, ...operations].flatMap((operation) =>
      operation.op === "add_npc" && !findNpc(state, operation.name) && !merging.has(operation.name) ? [operation.name] : [],
    ),
  );
  const refused = [...added].flatMap((name) => {
    const given = givenName(name);
    if (!given) return [];
    if (!taken.has(given)) {
      taken.add(given);
      return [];
    }
    return [{ op: "add_npc" as const, reason: "a given name someone already has" }];
  });
  return {
    state: applyOperations(state, introductions).next,
    operations: operations.filter(
      (operation) => !introductions.some((done) => done.op === operation.op && "name" in done && "name" in operation && done.name === operation.name),
    ),
    refused,
  };
}

// Articles and titles only: words such as "old" describe someone rather than stand before their name.
const TITLES = new Set(
  "the a an mr mrs ms miss mx dr doctor sir dame lady lord madam officer detective captain father mother sister brother aunt uncle reverend rev sergeant inspector lieutenant colonel commander admiral professor".split(
    " ",
  ),
);
const PARTICLES = new Set(["van", "von", "de", "der", "den", "del", "della", "di", "da", "du", "la", "le", "bin", "ibn", "al", "el", "y", "dos", "das"]);

/**
 * The first word of a name after any title, or none for a description such as "Man in grey windbreaker", which has
 * lowercase words that aren't part of a name.
 */
// shortcut: titles and name particles are short English-leaning lists, add to them if a real name is refused or a description clashes.
export function givenName(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.some((word, at) => at > 0 && /^\p{Ll}/u.test(word) && !PARTICLES.has(word))) return undefined;
  return words.map((word) => word.toLowerCase().replace(/\.$/, "")).find((word) => !TITLES.has(word));
}

/**
 * A name and each word of it that tells it apart, so "Dacre" names Mr Dacre and "Crane" names Crane's cottage, as a phrase
 * matched whole dropped writing that shortened it. A word counts if capitalised, past two letters and not a title.
 */
/**
 * Whether someone is named as a body, or their own Lore Entry is keyed as one. shortcut: by name and keyword, as an NPC has no
 * alive or dead, so one who dies in play still counts as alive; add a field if that misleads.
 */
export const isBody = (state: Pick<State, "worldBible">, name: string) =>
  DEAD.test(name) || state.worldBible.some(({ title, keywords }) => title === name && keywords.some((keyword) => DEAD.test(keyword)));
const DEAD = /\b(body|corpse|remains)\b/i;

export const nameForms = (name: string) => [
  name,
  ...name
    .split(" ")
    .map((part) => part.replace(/['’]s$/u, ""))
    .filter((part) => part.length > 2 && /^\p{Lu}/u.test(part) && !TITLES.has(part.toLowerCase().replace(/\.$/, ""))),
];
