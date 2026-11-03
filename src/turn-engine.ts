import { z } from "zod";
import type { SaveStore } from "./save-store";

export type Prompt = { role: "system" | "user"; content: string }[];
export type TextProvider = (prompt: Prompt) => Promise<string>;

export class NarratorError extends Error {}

const NarratorResponse = z.object({ narration: z.string().min(1) });

export async function playTurn(saves: SaveStore, textProvider: TextProvider, id: string, input: string) {
  const { worldBrief, pc } = saves.read(id);
  const narration = await narrate(textProvider, [
    {
      role: "system",
      content: `You are the Narrator of a story. World Brief: ${worldBrief}\nThe player controls the PC, ${pc.name}. Reply only with JSON: {"narration": string}`,
    },
    { role: "user", content: input },
  ]);
  return saves.commitTurn(id, input, narration);
}

async function narrate(textProvider: TextProvider, prompt: Prompt) {
  try {
    return NarratorResponse.parse(JSON.parse(await textProvider(prompt))).narration;
  } catch (cause) {
    throw new NarratorError("The Narrator gave no usable response", { cause });
  }
}
