import { z } from "zod";
import { type Check, CheckRequest, type Dice, resolveCheck } from "./check-resolver";
import { type ImagePipeline, movedScene, type Scene } from "./image-pipeline";
import { assemblePrompt, type Prompt, replacementInstruction, resultInstruction } from "./prompt-assembler";
import type { Message, SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import { applyOperations, type State, StateOperation } from "./state-applier";

/** Throws ContentRefused when the content is refused. Anything else it throws is a network or API error. */
export type TextProvider = (
  prompt: Prompt,
  request: { schema: object; onText: (text: string) => void; signal: AbortSignal },
) => Promise<string>;

export type TurnEvents = (event: "narration" | "restart", data: object) => void;

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
  scene_changed: z.boolean().nullish(),
  visual_description: z.string().nullish(),
  // Without this, narration beside an invalid difficulty would pass as a finished Turn and dodge the Check.
  check: z.null().optional(),
});
const NarratorResponse = z.union([z.object({ check: CheckRequest }), FinishedTurn]);

/** A schema to send to a model. Strict schema modes refuse some keywords, so those are left to validating the reply. */
export function jsonSchemaOf(schema: z.ZodType) {
  const { $schema, ...sendable } = z.toJSONSchema(schema, {
    io: "output",
    override: ({ jsonSchema }) => {
      delete jsonSchema.minLength;
      delete jsonSchema.minItems;
      if (jsonSchema.oneOf) {
        jsonSchema.anyOf = jsonSchema.oneOf;
        delete jsonSchema.oneOf;
      }
    },
  });
  return sendable;
}

// What the Narrator is asked for. It is flat because strict schema modes refuse a union at the root, and check
// comes first so that a streamed reply shows it is not a Check request before any narration arrives.
const responseSchema = jsonSchemaOf(
  z.object({
    check: CheckRequest.nullable(),
    narration: z.string().nullable(),
    state_operations: z.array(StateOperation),
    scene_changed: z.boolean().nullable(),
    visual_description: z.string().nullable(),
  }),
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

type Narrated = {
  prompt: Prompt;
  /** The text a failure hands back to the player. */
  input: string;
  refusal: string;
  check?: Check;
  /** Left out when no new roll is allowed, which makes a Check request an invalid reply. */
  rollCheck?: (request: z.infer<typeof CheckRequest>) => Check;
  commit: (narration: string, check: Check | undefined, advance: (state: State) => State) => Message[];
  /** Runs once the Turn is committed, so image work is never part of its transaction. */
  committed: (messageId: number, scene: Scene) => void;
};

export async function playTurn(
  saves: SaveStore,
  {
    textProvider,
    dice,
    nearMissMargin,
    settings,
    images,
  }: { textProvider: TextProvider; dice: Dice; nearMissMargin: number; settings: SettingsStore; images: ImagePipeline },
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
  return narrate(textProvider, signal, emit, {
    prompt,
    input,
    refusal: "The Narrator refused this message. Edit it and try again.",
    rollCheck: (request) => resolveCheck(request, dice, nearMissMargin),
    commit: (narration, check, advance) => saves.commitTurn(id, basedOn, input, narration, check, advance),
    committed: (messageId, scene) => images.sceneChanged(id, messageId, scene),
  });
}

/** Rewrite, when there is `feedback`, or Regenerate. Takes no Dice: the Turn's stored Check stands, and a Turn without one stays without. */
export async function replaceResponse(
  saves: SaveStore,
  { textProvider, settings, images }: { textProvider: TextProvider; settings: SettingsStore; images: ImagePipeline },
  id: string,
  messageId: number,
  feedback: string | undefined,
  signal: AbortSignal,
  emit: TurnEvents = () => {},
) {
  const { input, narration, check, state, messages } = saves.turnToReplace(id, messageId);
  const prompt = assemblePrompt({
    save: saves.read(id),
    state,
    messages,
    modelInstructions: settings.read().modelInstructions,
    input,
    responseSchema: JSON.stringify(responseSchema),
  });
  return narrate(textProvider, signal, emit, {
    prompt: [...prompt, replacementInstruction(feedback === undefined ? undefined : { narration, feedback })],
    input: feedback ?? "",
    refusal: "The Narrator refused this, so the response stays as it was.",
    check,
    commit: (text, _check, advance) => saves.replaceTurn(id, messageId, text, advance),
    committed: (replacement, scene) => {
      images.forget(id, messageId - 1);
      images.sceneChanged(id, replacement, scene);
    },
  });
}

async function narrate(
  textProvider: TextProvider,
  signal: AbortSignal,
  emit: TurnEvents,
  { prompt, input, refusal, check: storedCheck, rollCheck, commit, committed }: Narrated,
) {
  // Kept across attempts, so an invalid reply can never change the outcome.
  let check = storedCheck;
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
      refusal,
    );
    try {
      const response = parseReply(reply, NarratorResponse);
      if (response.check) {
        if (check || !rollCheck) throw new InvalidResponse();
        check = rollCheck(response.check);
        attempt = 0; // The result call gets its own retries.
        continue;
      }
      const { narration, state_operations, scene_changed, visual_description } = response;
      let moved = false;
      let location = "";
      const messages = commit(narration, check, (state) => {
        const { next, refused } = applyOperations(state, state_operations);
        // Dropping one would leave narration that disagrees with the state, so the whole Turn is invalid.
        if (refused.length > 0) throw new InvalidResponse(undefined, { cause: refused });
        moved = movedScene(state, next);
        location = next.scene.location;
        return next;
      });
      committed(messages.at(-1)!.id, { changed: moved || !!scene_changed, description: visual_description || location, location });
      return messages;
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
  refusal: string,
) {
  try {
    return await textProvider(prompt, request);
  } catch (cause) {
    if (cause instanceof ContentRefused) {
      throw new TurnFailed(refusal, "refused", input, { cause });
    }
    throw new TurnFailed("The Text Provider request failed", "retryable", input, { cause });
  }
}

/** One reply matching `schema`, with the retries and failures of a Turn. Nothing streams, as a reply may hold secrets. */
export async function askForJson<T>(
  textProvider: TextProvider,
  prompt: Prompt,
  schema: z.ZodType<T>,
  refusal: string,
  signal: AbortSignal,
) {
  const request = { schema: jsonSchemaOf(schema), onText: () => {}, signal };
  for (let attempt = 1; ; attempt++) {
    const reply = await askNarrator(textProvider, prompt, request, "", refusal);
    try {
      return parseReply(reply, schema);
    } catch (cause) {
      if (attempt === MAX_ATTEMPTS) {
        throw new TurnFailed("The Narrator gave no usable response", "retryable", "", { cause });
      }
    }
  }
}

function parseReply<T>(reply: string, schema: z.ZodType<T>) {
  try {
    return schema.parse(JSON.parse(reply));
  } catch (cause) {
    throw new InvalidResponse(undefined, { cause });
  }
}
