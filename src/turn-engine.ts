import { z } from "zod";
import { type Check, CheckRequest, type Dice, resolveCheck } from "./check-resolver";
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

const FinishedTurn = z.object({
  narration: z.string().min(1),
  state_operations: z.array(StateOperation).default([]),
  // Without this, narration beside an invalid difficulty would pass as a finished Turn and dodge the Check.
  check: z.null().optional(),
});
const NarratorResponse = z.union([z.object({ check: CheckRequest }), FinishedTurn]);
const responseSchema = JSON.stringify(z.toJSONSchema(NarratorResponse, { io: "input" }));

// The first try plus two automatic retries.
const MAX_ATTEMPTS = 3;

export async function playTurn(
  saves: SaveStore,
  { textProvider, dice, nearMissMargin }: { textProvider: TextProvider; dice: Dice; nearMissMargin: number },
  id: string,
  input: string,
) {
  const { worldBrief, pc } = saves.read(id);
  const basedOn = saves.latestMessageId(id);
  const prompt: Prompt = [
    {
      role: "system",
      content: `You are the Narrator of a story. World Brief: ${worldBrief}\nThe player controls the PC, ${pc.name}.
Current state: ${JSON.stringify(saves.latestState(id))}
Change the state only through state_operations, naming things exactly as the current state does. Reply only with JSON matching this schema: ${responseSchema}
If the PC attempts something risky, do not narrate it yet. Reply with a check instead, naming the action and one difficulty that already accounts for the PC's skills, condition and the situation. Safe actions need no check. Never mention dice, numbers or Checks.`,
    },
    { role: "user", content: input },
  ];
  // Kept across attempts, so an invalid reply can never change the outcome.
  let check: Check | undefined;
  for (let attempt = 1; ; attempt++) {
    const reply = await askNarrator(textProvider, check ? [...prompt, resultInstruction(check)] : prompt, input);
    try {
      const response = parseReply(reply);
      if (response.check) {
        if (check) throw new InvalidResponse();
        check = resolveCheck(response.check, dice, nearMissMargin);
        attempt = 0; // The result call gets its own retries.
        continue;
      }
      const { narration, state_operations } = response;
      return saves.commitTurn(id, basedOn, input, narration, check, (state) => {
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

function resultInstruction({ action, outcome, degree }: Check): Prompt[number] {
  return {
    role: "system",
    content: `The Check is resolved: ${JSON.stringify({ action, outcome, degree })}
A mixed degree means the PC succeeds at a cost. Narrate exactly this result as a finished Turn, and do not request another check.`,
  };
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
