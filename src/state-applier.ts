import { z } from "zod";

export type State = {
  inventory: { wearing: string[]; carrying: string[] };
  status: { health: string; injuries: string[]; conditions: string[] };
  npcs: { name: string; appearance: string }[];
  pcKnown: { facts: string[]; npcs: string[] };
};

export const openingState: State = {
  inventory: { wearing: [], carrying: [] },
  status: { health: "unhurt", injuries: [], conditions: [] },
  npcs: [],
  pcKnown: { facts: [], npcs: [] },
};

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
]);
type StateOperation = z.infer<typeof StateOperation>;

const findNpc = (state: State, name: string) => state.npcs.find((npc) => npc.name === name);

function take(list: string[], value: string) {
  const index = list.indexOf(value);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

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
      state.status.health = operation.health;
      return true;
    case "add_status":
      return addOnce(state.status[operation.kind], operation.text);
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
  }
}

/** Applies operations in order, so each is judged against the ones before it. */
export function applyOperations(state: State, operations: StateOperation[]) {
  const next = structuredClone(state);
  const refused = operations.filter((operation) => !apply(next, operation));
  return { next, refused };
}
