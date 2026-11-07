// One-off: rewrites a Save copy's named Scene Memories on the Text Provider in the settings file named, then applies a
// plan of corrected records. It sends those memories' Messages to that provider, and writes only to the copy:
//   bun run scripts/repair-records.ts <Save copy> <settings.json> <plan.json>
import { existsSync } from "node:fs";
import { z } from "zod";
import { changeLatestStates, InvalidSave, readSaveCopy } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { applyOperations, type State, StateOperation } from "../src/state-applier";
import { textProvider } from "../src/text-provider";
import { askForMemory, type TextProvider, TurnFailed } from "../src/turn-engine";
import { readable } from "../src/web/chat-style";
import { assertIsACopy, Refused } from "./backfill-scene-memories";

const Plan = z.object({
  /** The first Message of each Scene Memory to write again. */
  memories: z.array(z.number().int()).default([]),
  facts: z.array(z.string()).optional(),
  looseEnds: z.array(z.string()).optional(),
  plotThreads: z.array(z.string()).optional(),
  /** By title. Null removes the entry, and a new title adds one. */
  lore: z.record(z.string(), z.object({ keywords: z.array(z.string()).optional(), content: z.string(), alwaysOn: z.boolean().optional() }).nullable()).default({}),
  operations: z.array(StateOperation).default([]),
});
export type Plan = z.input<typeof Plan>;

function correct(state: State, plan: z.output<typeof Plan>) {
  const { next, refused, ignored } = applyOperations(state, plan.operations);
  const failed = [...refused, ...ignored];
  if (failed.length > 0) throw new Refused(`The plan's operations were refused: ${failed.map(({ op, reason }) => `${op}: ${reason}`).join(", ")}`);
  const titles = Object.keys(plan.lore);
  const added = titles.filter((title) => plan.lore[title] && !next.worldBible.some((entry) => entry.title === title));
  next.worldBible = [
    ...next.worldBible.filter(({ title }) => plan.lore[title] !== null).map((entry) => ({ ...entry, ...plan.lore[entry.title] })),
    ...added.map((title) => ({ title, keywords: [], alwaysOn: false, ...plan.lore[title]! })),
  ];
  return { ...next, ...(plan.facts && { pcKnown: { ...next.pcKnown, facts: plan.facts } }), ...(plan.looseEnds && { looseEnds: plan.looseEnds }), ...(plan.plotThreads && { plotThreads: plan.plotThreads }) };
}

/** Writes nothing until every memory is back, so a failure costs the calls made and leaves the story as it was. */
export async function repair(path: string, provider: TextProvider, input: Plan, print: (line: string) => void = console.log, savesFolder?: string) {
  assertIsACopy(path, savesFolder);
  const plan = Plan.parse(input);
  const { messages, sceneMemories } = readSaveCopy(path);
  const rewritten = new Map<number, string>();
  for (const first of plan.memories) {
    const at = sceneMemories.findIndex(({ firstMessage }) => firstMessage === first);
    if (at === -1) throw new Refused(`No Scene Memory starts at Message ${first}.`);
    const { firstMessage, lastMessage } = sceneMemories[at]!;
    const batch = readable(messages.filter(({ id }) => id >= firstMessage && id <= lastMessage));
    const before = sceneMemories[at - 1];
    print(`Memory ${firstMessage} to ${lastMessage}`);
    rewritten.set(first, await askForMemory(provider, batch, before && (rewritten.get(before.firstMessage) ?? before.text), new AbortController().signal));
  }
  changeLatestStates(path, (state) => ({
    ...correct(state, plan),
    sceneMemories: state.sceneMemories.map((memory) => ({ ...memory, text: rewritten.get(memory.firstMessage) ?? memory.text })),
  }));
  print(`Wrote ${rewritten.size} Scene Memories and the plan's records to ${path}`);
}

if (import.meta.main) {
  const [copy, settingsPath, planPath] = process.argv.slice(2);
  try {
    if (!copy || !settingsPath || !planPath) throw new Refused("Give the path of a Save copy, then of a settings file, then of a plan.");
    if (!existsSync(settingsPath)) throw new Refused(`There's no settings file at ${settingsPath}.`);
    await repair(copy, textProvider(settingsStore(settingsPath)), await Bun.file(planPath).json());
  } catch (error) {
    // Only messages written here, as any other could quote the story or the key.
    const safe = error instanceof Refused || error instanceof InvalidSave || error instanceof TurnFailed;
    console.error(`Stopped, with nothing written: ${safe ? error.message : (error as Error).name}`);
    process.exitCode = 1;
  }
}
