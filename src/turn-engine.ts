import { z } from "zod";
import type { SaveStore } from "./save-store";
import { applyOperations, StateOperation } from "./state-applier";

export type Prompt = { role: "system" | "user"; content: string }[];
export type TextProvider = (prompt: Prompt) => Promise<string>;

export class NarratorError extends Error {}

const NarratorResponse = z.object({
  narration: z.string().min(1),
  state_operations: z.array(StateOperation).default([]),
});
const responseSchema = JSON.stringify(z.toJSONSchema(NarratorResponse, { io: "input" }));

export async function playTurn(saves: SaveStore, textProvider: TextProvider, id: string, input: string) {
  const { worldBrief, pc } = saves.read(id);
  const { narration, state_operations } = await narrate(textProvider, [
    {
      role: "system",
      content: `You are the Narrator of a story. World Brief: ${worldBrief}\nThe player controls the PC, ${pc.name}.
Current state: ${JSON.stringify(saves.latestState(id))}
Change the state only through state_operations, naming things exactly as the current state does. Reply only with JSON matching this schema: ${responseSchema}`,
    },
    { role: "user", content: input },
  ]);
  return saves.commitTurn(id, input, narration, (state) => {
    const { next, refused } = applyOperations(state, state_operations);
    if (refused.length > 0) console.warn("Refused state operations:", refused);
    return next;
  });
}

async function narrate(textProvider: TextProvider, prompt: Prompt) {
  try {
    return NarratorResponse.parse(JSON.parse(await textProvider(prompt)));
  } catch (cause) {
    throw new NarratorError("The Narrator gave no usable response", { cause });
  }
}
