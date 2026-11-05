import { z } from "zod";

export type LoreEntry = { title: string; keywords: string[]; content: string; alwaysOn: boolean };

export type State = {
  inventory: { wearing: string[]; carrying: string[] };
  status: { health: string; injuries: string[]; conditions: string[] };
  npcs: { name: string; appearance: string }[];
  scene: { location: string; visibleCast: string[] };
  /** `summaries` says who each known NPC is, as the PC understands it. A Save from before them has none. */
  pcKnown: { facts: string[]; npcs: string[]; summaries?: Record<string, string> };
  worldBible: LoreEntry[];
  worldRules: string[];
  plotThreads: string[];
  summary: string;
  directorsNotes: string[];
  /** Here rather than on the Save, so a Revert undoes an edit to it. */
  worldBrief: string;
};

export const openingState: State = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  scene: { location: "", visibleCast: [] },
  pcKnown: { facts: [], npcs: [] },
  worldBible: [],
  worldRules: [],
  plotThreads: [],
  summary: "",
  directorsNotes: [],
  worldBrief: "",
};

const stringList = z.array(z.string());

/** What each Snapshot section must hold, for a Save that comes from outside the game. */
export const StateSections = {
  inventory: z.object({ wearing: stringList, carrying: stringList }),
  status: z.object({ health: z.string(), injuries: stringList, conditions: stringList }),
  npcs: z.array(z.object({ name: z.string(), appearance: z.string() })),
  scene: z.object({ location: z.string(), visibleCast: stringList }),
  pcKnown: z.object({ facts: stringList, npcs: stringList, summaries: z.record(z.string(), z.string()).optional() }),
  worldBible: z.array(
    z.object({ title: z.string(), keywords: stringList, content: z.string(), alwaysOn: z.boolean() }),
  ),
  worldRules: stringList,
  plotThreads: stringList,
  summary: z.string(),
  directorsNotes: stringList,
  worldBrief: z.string(),
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
  z.object({ op: z.literal("set_scene"), location: nonEmpty, visible_cast: z.array(nonEmpty) }),
  z.object({ op: z.literal("add_known_fact"), fact: nonEmpty }),
  z.object({ op: z.literal("add_known_npc"), name: nonEmpty }),
  z.object({ op: z.literal("set_known_npc_summary"), name: nonEmpty, summary: nonEmpty }),
  z.object({
    op: z.literal("add_lore_entry"),
    title: nonEmpty,
    keywords: z.array(nonEmpty).min(1),
    content: nonEmpty,
  }),
  z.object({ op: z.literal("add_plot_thread"), thread: nonEmpty }),
  z.object({ op: z.literal("resolve_plot_thread"), thread: nonEmpty }),
  z.object({ op: z.literal("set_summary"), summary: nonEmpty }),
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
const hasNumber = (text: string) => /\p{N}/u.test(text);

function addOnce(list: string[], value: string) {
  if (list.includes(value)) return false;
  list.push(value);
  return true;
}

/** Changes `state` and returns true, or returns false having changed nothing if `operation` is disproved. */
function apply(state: State, operation: StateOperation) {
  switch (operation.op) {
    case "add_item":
      state.inventory[operation.slot].push(operation.item);
      return true;
    case "remove_item":
      return take(state.inventory.carrying, operation.item) || take(state.inventory.wearing, operation.item);
    case "set_health":
      if (hasNumber(operation.health)) return false;
      state.status.health = operation.health;
      return true;
    case "add_status":
      return !hasNumber(operation.text) && addOnce(state.status[operation.kind], operation.text);
    case "remove_status":
      return take(state.status[operation.kind], operation.text);
    case "add_npc":
      if (findNpc(state, operation.name)) return false;
      state.npcs.push({ name: operation.name, appearance: operation.appearance });
      return true;
    case "update_npc": {
      const npc = findNpc(state, operation.name);
      if (!npc) return false;
      npc.appearance = operation.appearance;
      return true;
    }
    case "set_scene": {
      // The cast only steers images, so a name the state lacks is left out rather than failing the Turn.
      const visibleCast = [...new Set(operation.visible_cast)].filter((name) => findNpc(state, name));
      state.scene = { location: operation.location, visibleCast };
      return true;
    }
    case "add_known_fact":
      return addOnce(state.pcKnown.facts, operation.fact);
    case "add_known_npc":
      return findNpc(state, operation.name) !== undefined && addOnce(state.pcKnown.npcs, operation.name);
    case "set_known_npc_summary":
      if (!state.pcKnown.npcs.includes(operation.name)) return false;
      state.pcKnown.summaries = { ...state.pcKnown.summaries, [operation.name]: operation.summary };
      return true;
    case "add_lore_entry": {
      const { title, keywords, content } = operation;
      // The Narrator only sees activated entries, so it can repeat a title innocently: keep the first, not fail the Turn.
      if (state.worldBible.some((entry) => entry.title === title)) return true;
      // Always-on entries bypass the token budget, so the Narrator can only add keyword-activated ones.
      state.worldBible.push({ title, keywords, content, alwaysOn: false });
      return true;
    }
    case "add_plot_thread":
      return addOnce(state.plotThreads, operation.thread);
    case "resolve_plot_thread":
      return take(state.plotThreads, operation.thread);
    case "set_summary":
      state.summary = operation.summary;
      return true;
  }
}

/** Applies operations in order, so each is judged against the ones before it. */
export function applyOperations(state: State, operations: StateOperation[]) {
  const next = structuredClone(state);
  const refused = operations.filter((operation) => !apply(next, operation));
  return { next, refused };
}

export type World = Pick<State, "worldBible" | "worldRules" | "plotThreads">;

const words = z.string().trim().min(1);
// Untrimmed, as a quote must match what a Turn stored, and Turns store text as it came.
const quote = z.string().min(1);
const namesSomething = (change: { old: string | null; new: string | null }) => change.old !== null || change.new !== null;

export const LoreEntryReply = z.object({ title: words, keywords: z.array(words).min(3), content: words });

/** One entry of a list: replaces `old`, or adds when `old` is null, or removes it when `new` is null. */
const ListChange = z.object({ old: quote.nullable(), new: words.nullable() }).refine(namesSomething);
type ListChange = z.infer<typeof ListChange>;

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
  z.object({ edit: z.literal("npcSummary"), name: words, text: words }),
]);

export type VisibleEdit = z.infer<typeof VisibleEdit>;

/** A change made between Messages. Snapshots are immutable, so these wait on the Save for the next Message to store. */
export const WorldEdit = z.discriminatedUnion("edit", [...VisibleEdit.options, z.object({ edit: z.literal("world"), update: WorldUpdate })]);
export type WorldEdit = z.infer<typeof WorldEdit>;

export function applyEdit(state: State, edit: WorldEdit): State {
  switch (edit.edit) {
    case "worldBrief":
      return { ...state, worldBrief: edit.text };
    case "summary":
      return { ...state, summary: edit.text };
    case "fact":
      return { ...state, pcKnown: { ...state.pcKnown, facts: changeList(state.pcKnown.facts, edit) } };
    case "npcSummary":
      return { ...state, pcKnown: { ...state.pcKnown, summaries: { ...state.pcKnown.summaries, [edit.name]: edit.text } } };
    case "world":
      return { ...state, ...mergeWorldUpdate(state, edit.update) };
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
