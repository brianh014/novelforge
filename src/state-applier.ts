import { z } from "zod";

export type LoreEntry = { title: string; keywords: string[]; content: string; alwaysOn: boolean };

export type State = {
  inventory: { wearing: string[]; carrying: string[] };
  status: { health: string; injuries: string[]; conditions: string[] };
  npcs: { name: string; appearance: string }[];
  pcKnown: { facts: string[]; npcs: string[] };
  worldBible: LoreEntry[];
  worldRules: string[];
  plotThreads: string[];
  summary: string;
  directorsNotes: string[];
};

export const openingState: State = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  pcKnown: { facts: [], npcs: [] },
  worldBible: [],
  worldRules: [],
  plotThreads: [],
  summary: "",
  directorsNotes: [],
};

const stringList = z.array(z.string());

/** What each Snapshot section must hold, for a Save that comes from outside the game. */
export const StateSections = {
  inventory: z.object({ wearing: stringList, carrying: stringList }),
  status: z.object({ health: z.string(), injuries: stringList, conditions: stringList }),
  npcs: z.array(z.object({ name: z.string(), appearance: z.string() })),
  pcKnown: z.object({ facts: stringList, npcs: stringList }),
  worldBible: z.array(
    z.object({ title: z.string(), keywords: stringList, content: z.string(), alwaysOn: z.boolean() }),
  ),
  worldRules: stringList,
  plotThreads: stringList,
  summary: z.string(),
  directorsNotes: stringList,
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
  z.object({ op: z.literal("add_known_fact"), fact: nonEmpty }),
  z.object({ op: z.literal("add_known_npc"), name: nonEmpty }),
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
    case "add_known_fact":
      return addOnce(state.pcKnown.facts, operation.fact);
    case "add_known_npc":
      return findNpc(state, operation.name) !== undefined && addOnce(state.pcKnown.npcs, operation.name);
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
