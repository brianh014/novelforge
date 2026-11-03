import { z } from "zod";
import type { SaveStore } from "./save-store";
import { applyOperations, StateOperation } from "./state-applier";

export type Prompt = { role: "system" | "user"; content: string }[];
/** Throws ContentRefused when the content is refused. Anything else it throws is a network or API error. */
export type TextProvider = (prompt: Prompt) => Promise<string>;

// shortcut: nothing raises this outside tests yet, the OpenRouter client must in ticket 07.
export class ContentRefused extends Error {}
class InvalidResponse extends Error {}

/** The Turn wrote nothing. `input` is the player's text, so they can edit it or send it again. */
export class TurnFailed extends Error {
  constructor(
    message: string,
    readonly failure: "refused" | "retryable",
    readonly input: string,
    options: ErrorOptions,
  ) {
    super(message, options);
  }
}

const NarratorResponse = z.object({
  narration: z.string().min(1),
  state_operations: z.array(StateOperation).default([]),
});
const responseSchema = JSON.stringify(z.toJSONSchema(NarratorResponse, { io: "input" }));

// The first try plus two automatic retries.
const MAX_ATTEMPTS = 3;

export async function playTurn(saves: SaveStore, textProvider: TextProvider, id: string, input: string) {
  const { worldBrief, pc } = saves.read(id);
  const basedOn = saves.latestMessageId(id);
  const prompt: Prompt = [
    {
      role: "system",
      content: `You are the Narrator of a story. World Brief: ${worldBrief}\nThe player controls the PC, ${pc.name}.
Current state: ${JSON.stringify(saves.latestState(id))}
Change the state only through state_operations, naming things exactly as the current state does. Reply only with JSON matching this schema: ${responseSchema}`,
    },
    { role: "user", content: input },
  ];
  for (let attempt = 1; ; attempt++) {
    const reply = await askNarrator(textProvider, prompt, input);
    try {
      const { narration, state_operations } = parseReply(reply);
      return saves.commitTurn(id, basedOn, input, narration, (state) => {
        const { next, refused } = applyOperations(state, state_operations);
        // Dropping one would leave narration that disagrees with the state, so the whole Turn is invalid.
        if (refused.length > 0) throw new InvalidResponse(undefined, { cause: refused });
        return next;
      });
    } catch (cause) {
      if (!(cause instanceof InvalidResponse)) throw cause;
      if (attempt === MAX_ATTEMPTS) {
        throw new TurnFailed("The Narrator gave no usable response", "retryable", input, { cause });
      }
    }
  }
}

async function askNarrator(textProvider: TextProvider, prompt: Prompt, input: string) {
  try {
    return await textProvider(prompt);
  } catch (cause) {
    if (cause instanceof ContentRefused) {
      throw new TurnFailed("The Narrator refused this message. Edit it and try again.", "refused", input, { cause });
    }
    throw new TurnFailed("The Text Provider request failed", "retryable", input, { cause });
  }
}

function parseReply(reply: string) {
  try {
    return NarratorResponse.parse(JSON.parse(reply));
  } catch (cause) {
    throw new InvalidResponse(undefined, { cause });
  }
}
