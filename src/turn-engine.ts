import { z } from "zod";
import { type Check, CheckRequest, type Dice, resolveCheck } from "./check-resolver";
import { assemblePrompt, type Prompt, resultInstruction } from "./prompt-assembler";
import type { SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import { applyOperations, StateOperation } from "./state-applier";

/** Throws ContentRefused when the content is refused. Anything else it throws is a network or API error. */
export type TextProvider = (
  prompt: Prompt,
  request: { schema: object; onText: (text: string) => void; signal: AbortSignal },
) => Promise<string>;

type TurnEvents = (event: "narration" | "restart", data: object) => void;

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

// What the Narrator is asked for. It is flat because strict schema modes refuse a union at the root, and check
// comes first so that a streamed reply shows it is not a Check request before any narration arrives.
const { $schema, ...responseSchema } = z.toJSONSchema(
  z.object({
    check: CheckRequest.nullable(),
    narration: z.string().nullable(),
    state_operations: z.array(StateOperation),
  }),
  {
    io: "output",
    override: ({ jsonSchema }) => {
      delete jsonSchema.minLength;
      if (jsonSchema.oneOf) {
        jsonSchema.anyOf = jsonSchema.oneOf;
        delete jsonSchema.oneOf;
      }
    },
  },
);

// shortcut: a reply in another key order shows no narration until the Turn is done, loosen this only if real models do that often.
const NARRATION_START = /^\s*\{\s*"check"\s*:\s*null\s*,\s*"narration"\s*:\s*"/;
const COMPLETE_JSON_CHARACTERS = /^(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*/;

/** The narration in a partial reply, empty until the reply has shown it is not a Check request. */
function narrationSoFar(reply: string) {
  const start = reply.match(NARRATION_START);
  if (!start) return "";
  return JSON.parse(`"${reply.slice(start[0].length).match(COMPLETE_JSON_CHARACTERS)![0]}"`) as string;
}

// The first try plus two automatic retries.
const MAX_ATTEMPTS = 3;

export async function playTurn(
  saves: SaveStore,
  {
    textProvider,
    dice,
    nearMissMargin,
    settings,
  }: { textProvider: TextProvider; dice: Dice; nearMissMargin: number; settings: SettingsStore },
  id: string,
  input: string,
  signal: AbortSignal,
  emit: TurnEvents = () => {},
) {
  const basedOn = saves.latestMessageId(id);
  const prompt = assemblePrompt({
    save: saves.read(id),
    state: saves.latestState(id),
    messages: saves.messages(id),
    modelInstructions: settings.read().modelInstructions,
    input,
    responseSchema: JSON.stringify(responseSchema),
  });
  // Kept across attempts, so an invalid reply can never change the outcome.
  let check: Check | undefined;
  let narrationSent = 0;
  for (let attempt = 1; ; attempt++) {
    if (narrationSent > 0) emit("restart", {});
    narrationSent = 0;
    let partial = "";
    const onText = (text: string) => {
      partial += text;
      const narration = narrationSoFar(partial);
      if (narration.length <= narrationSent) return;
      emit("narration", { text: narration.slice(narrationSent) });
      narrationSent = narration.length;
    };
    const reply = await askNarrator(
      textProvider,
      check ? [...prompt, resultInstruction(check)] : prompt,
      { schema: responseSchema, onText, signal },
      input,
    );
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

async function askNarrator(
  textProvider: TextProvider,
  prompt: Prompt,
  request: Parameters<TextProvider>[1],
  input: string,
) {
  try {
    return await textProvider(prompt, request);
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
