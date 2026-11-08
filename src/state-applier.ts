import { z } from "zod";

export type LoreEntry = { title: string; keywords: string[]; content: string; alwaysOn: boolean };

export type SceneMemory = { firstMessage: number; lastMessage: number; text: string };

export type State = {
  inventory: { wearing: string[]; carrying: string[] };
  status: { health: string; injuries: string[]; conditions: string[] };
  npcs: { name: string; appearance: string }[];
  scene: { location: string; visibleCast: string[] };
  /** `summaries` says who each known NPC is, as the PC understands it. A Save from before them has none. */
  pcKnown: { facts: string[]; npcs: string[]; summaries?: Record<string, string> };
  /** What the PC knows is still unresolved. Unlike a Plot Thread, the player reads these. */
  looseEnds: string[];
  /** The story's older Messages in about 100 words each, oldest first. The server sets each range, so a wrong memory can be traced to its source. */
  sceneMemories: SceneMemory[];
  worldBible: LoreEntry[];
  worldRules: string[];
  plotThreads: string[];
  summary: string;
  directorsNotes: string[];
  /** Here rather than on the Save, so a Revert undoes an edit to it. */
  worldBrief: string;
  /** Closed Chapters, oldest first. A null `lastMessage` was closed after the latest Message, and the next Turn fills it in. */
  chapters: Chapter[];
  /** Whether the latest Narrator reply suggested ending the open Chapter. */
  chapterReady: boolean;
  /** Null until the Narrator first sets it, as in a Save from before Story Time. */
  storyTime: StoryTime | null;
};

/** `day` counts days since the Opening, as Narrators add whole numbers far better than they work an in-world calendar. The player never sees it. */
export type StoryTime = { day: number; date: string; timeOfDay: string };

export type Chapter = { lastMessage: number | null; title: string };

export const openingState: State = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  scene: { location: "", visibleCast: [] },
  pcKnown: { facts: [], npcs: [] },
  looseEnds: [],
  sceneMemories: [],
  worldBible: [],
  worldRules: [],
  plotThreads: [],
  summary: "",
  directorsNotes: [],
  worldBrief: "",
  chapters: [],
  chapterReady: false,
  storyTime: null,
};

const stringList = z.array(z.string());

/** What each Snapshot section must hold, for a Save that comes from outside the app. */
export const StateSections = {
  inventory: z.object({ wearing: stringList, carrying: stringList }),
  status: z.object({ health: z.string(), injuries: stringList, conditions: stringList }),
  npcs: z.array(z.object({ name: z.string(), appearance: z.string() })),
  scene: z.object({ location: z.string(), visibleCast: stringList }),
  pcKnown: z.object({ facts: stringList, npcs: stringList, summaries: z.record(z.string(), z.string()).optional() }),
  looseEnds: stringList,
  sceneMemories: z.array(z.object({ firstMessage: z.number().int(), lastMessage: z.number().int(), text: z.string() })),
  worldBible: z.array(
    z.object({ title: z.string(), keywords: stringList, content: z.string(), alwaysOn: z.boolean() }),
  ),
  worldRules: stringList,
  plotThreads: stringList,
  summary: z.string(),
  directorsNotes: stringList,
  worldBrief: z.string(),
  chapters: z.array(z.object({ lastMessage: z.number().int().nullable(), title: z.string() })),
  chapterReady: z.boolean(),
  storyTime: z.object({ day: z.number().int(), date: z.string(), timeOfDay: z.string() }).nullable(),
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
  z.object({ op: z.literal("add_plot_thread"), thread: nonEmpty }),
  z.object({ op: z.literal("update_plot_thread"), thread: nonEmpty, replacement: nonEmpty }),
  z.object({ op: z.literal("resolve_plot_thread"), thread: nonEmpty }),
  z.object({ op: z.literal("set_summary"), summary: nonEmpty }),
  z.object({ op: z.literal("set_story_time"), days_passed: z.number().int().min(0), date: nonEmpty.nullable(), time_of_day: nonEmpty }),
]);
export type StateOperation = z.infer<typeof StateOperation>;

const findNpc = (state: State, name: string) => state.npcs.find((npc) => npc.name === name);

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
}

/** Changes `state` and returns nothing, or returns why `operation` is disproved, having changed nothing. The reason goes to the Server Log, so it never quotes the operation. */
function apply(state: State, operation: StateOperation): string | undefined {
  switch (operation.op) {
    case "add_item":
      state.inventory[operation.slot].push(operation.item);
      return;
    case "remove_item":
      return take(state.inventory.carrying, operation.item) || take(state.inventory.wearing, operation.item) ? undefined : "not held";
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
    case "add_npc":
      if (findNpc(state, operation.name)) return "already an NPC";
      state.npcs.push({ name: operation.name, appearance: operation.appearance });
      return;
    case "update_npc": {
      const npc = findNpc(state, operation.name);
      if (!npc) return "no such NPC";
      npc.appearance = operation.appearance;
      return;
    }
    case "merge_npc":
      mergeNpc(state, operation.name, operation.into);
      return;
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
    case "add_plot_thread":
      return addOnce(state.plotThreads, operation.thread) ? undefined : "already there";
    case "update_plot_thread":
      replaceOnce(state.plotThreads, operation.thread, operation.replacement);
      return;
    case "resolve_plot_thread":
      return take(state.plotThreads, operation.thread) ? undefined : "not there";
    case "set_summary":
      state.summary = operation.summary;
      return;
    case "set_story_time": {
      const { days_passed, time_of_day } = operation;
      // A new day kept on the old date would put the story on the wrong day, so it waits for a Turn that names one.
      const date = operation.date ?? (days_passed === 0 ? state.storyTime?.date : undefined);
      if (date === undefined) return "no date";
      state.storyTime = { day: (state.storyTime?.day ?? 1) + days_passed, date, timeOfDay: time_of_day };
      return;
    }
  }
}

const isRepeat = ({ pcKnown, looseEnds }: State, operation: StateOperation) =>
  (operation.op === "add_known_fact" && pcKnown.facts.includes(operation.fact)) ||
  (operation.op === "add_known_npc" && pcKnown.npcs.includes(operation.name)) ||
  (operation.op === "add_loose_end" && looseEnds.includes(operation.loose_end));

// None of these contradict the narration, so they aren't worth a whole response. Someone nameless is added once they're named.
const IGNORABLE: StateOperation["op"][] = ["resolve_loose_end", "add_known_npc", "set_known_npc_summary", "set_story_time"];
const isHarmless = ({ op, reason }: { op: StateOperation["op"]; reason: string }) => IGNORABLE.includes(op) || reason === "already there";

/** Applies operations in order, so each is judged against the ones before it. */
export function applyOperations(state: State, operations: StateOperation[]) {
  const next = structuredClone(state);
  let repeats = 0;
  const refusals = operations.flatMap(({ ...operation }) => {
    if (isRepeat(next, operation)) repeats++;
    const reason = apply(next, operation);
    return reason ? [{ op: operation.op, reason }] : [];
  });
  return { next, refused: refusals.filter((refusal) => !isHarmless(refusal)), ignored: refusals.filter(isHarmless), repeats };
}

export type World = Pick<State, "worldBible" | "worldRules" | "plotThreads">;

const words = z.string().trim().min(1);
// Untrimmed, as a quote must match what a Turn stored, and Turns store text as it came.
const quote = z.string().min(1);
const namesSomething = (change: { old: string | null; new: string | null }) => change.old !== null || change.new !== null;

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
function changeList(list: string[], change: ListChange) {
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
  z.object({ edit: z.literal("world"), update: WorldUpdate }),
  // Whole lists, as a World Change rewrites what the player says is wrong rather than one item at a time.
  z.object({ edit: z.literal("inventory"), wearing: z.array(z.string()), carrying: z.array(z.string()) }),
  z.object({ edit: z.literal("status"), health: z.string(), injuries: z.array(z.string()), conditions: z.array(z.string()) }),
  // Hidden like the rest of an NPC's looks, so only a World Change writes it.
  z.object({ edit: z.literal("npcLooks"), name: z.string(), appearance: z.string() }),
  // Only the server closes a Chapter, as it writes the title.
  z.object({ edit: z.literal("closeChapter"), title: z.string() }),
]);
export type WorldEdit = z.infer<typeof WorldEdit>;

export function applyEdit(state: State, edit: WorldEdit): State {
  switch (edit.edit) {
    case "worldBrief":
      return { ...state, worldBrief: edit.text };
    case "summary":
      return { ...state, summary: edit.text };
    case "fact":
      return { ...state, pcKnown: { ...state.pcKnown, facts: changeList(state.pcKnown.facts, edit) } };
    case "looseEnd":
      return { ...state, looseEnds: changeList(state.looseEnds, edit) };
    case "npcSummary":
      return { ...state, pcKnown: { ...state.pcKnown, summaries: { ...state.pcKnown.summaries, [edit.name]: edit.text } } };
    // A replaced response can take the memory away, and with it what this names, so a miss changes nothing.
    case "sceneMemory":
      return { ...state, sceneMemories: state.sceneMemories.map((memory) => (memory.firstMessage === edit.firstMessage ? { ...memory, text: edit.text } : memory)) };
    case "world":
      return { ...state, ...mergeWorldUpdate(state, edit.update) };
    case "inventory":
      return { ...state, inventory: { wearing: edit.wearing, carrying: edit.carrying } };
    case "npcLooks":
      return { ...state, npcs: state.npcs.map((npc) => (npc.name === edit.name ? { ...npc, appearance: edit.appearance } : npc)) };
    case "status":
      return { ...state, status: { health: edit.health, injuries: edit.injuries.slice(-MAX_STATUS), conditions: edit.conditions.slice(-MAX_STATUS) } };
    case "storyTime":
      return { ...state, storyTime: { day: state.storyTime?.day ?? 1, date: edit.date, timeOfDay: edit.timeOfDay } };
    case "chapterTitle":
      return { ...state, chapters: state.chapters.map((chapter, index) => (index === edit.index ? { ...chapter, title: edit.title } : chapter)) };
    // A second close before any new Message would make an empty Chapter.
    case "closeChapter":
      return state.chapters.at(-1)?.lastMessage === null ? state : { ...state, chapters: [...state.chapters, { lastMessage: null, title: edit.title }], chapterReady: false };
  }
}

export const Person = z.object({ name: z.string().trim().min(1), appearance: z.string() });

/**
 * Makes everyone a response names a known NPC, as Narrators often forget to, ahead of `operations`, so that those can
 * use the new names. Returns the state and what's left of `operations` once anything this already did is taken out.
 */
export function introduce(state: State, people: z.infer<typeof Person>[], pcName: string, operations: StateOperation[]) {
  // A list of people is never worth a Turn, so someone with no looks waits until they're named again.
  const introductions = people
    .filter(({ name, appearance }) => !pcName.split(" ").includes(name) && name !== pcName && (findNpc(state, name) || appearance.trim()))
    .flatMap(({ name, appearance }): StateOperation[] => [
      ...(findNpc(state, name) ? [] : [{ op: "add_npc" as const, name, appearance }]),
      ...(state.pcKnown.npcs.includes(name) ? [] : [{ op: "add_known_npc" as const, name }]),
    ]);
  return {
    state: applyOperations(state, introductions).next,
    operations: operations.filter(
      (operation) => !introductions.some((done) => done.op === operation.op && "name" in done && "name" in operation && done.name === operation.name),
    ),
  };
}
