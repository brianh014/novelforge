import { z } from "zod";
import { type Check, CheckRequest, type Dice, resolveCheck } from "./check-resolver";
import { type ImagePipeline, movedScene, portraitsDue, type Scene } from "./image-pipeline";
import { promptStyle } from "./graph-builder";
import { log } from "./logger";
import { assemblePrompt, OPENING_INPUT, type Prompt, replacementInstruction, resultInstruction } from "./prompt-assembler";
import { type Message, type SaveStore, StaleTurn } from "./save-store";
import type { SettingsStore } from "./settings-store";
import { applyOperations, introduce, Person, type State, StateOperation } from "./state-applier";

/** Throws ContentRefused when the content is refused. Anything else it throws is a network or API error. */
export type TextProvider = (
  prompt: Prompt,
  /** `onGeneration` hears the provider's id for this reply, the one way to find a reply no Save keeps. */
  request: { schema?: object; onText: (text: string) => void; onGeneration?: (id: string) => void; signal: AbortSignal },
) => Promise<string>;

export type TurnEvents = (event: "narration" | "restart", data: object) => void;

export class ContentRefused extends Error {}
/** A failure whose message is fit to show the player. */
export class TextProviderFailed extends Error {}
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
  narration: z.string().trim().min(1),
  state_operations: z.array(StateOperation).default([]),
  people: z.array(Person).catch([]),
  summary: z.string().catch(""),
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
    people: z.array(Person),
    summary: z.string(),
    scene_changed: z.boolean().nullable(),
    visual_description: z.string().nullable(),
  }),
);

// shortcut: a reply in another key order or after prose shows no narration until the Turn is done, loosen this only if real models do that often.
const NARRATION_START = /^\s*(?:```(?:json)?\s*)?\{\s*"check"\s*:\s*null\s*,\s*"narration"\s*:\s*"/;
const COMPLETE_JSON_CHARACTERS = /^(?:[^"\\\x00-\x1f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*/;

// A model's thoughts can hold stray JSON, or a draft that differs from its reply. A chat template may supply the
// opening tag, and a reply can be cut off before the closing one.
const withoutThinking = (reply: string) => reply.replace(/^[\s\S]*<\/think>/, "").replace(/<think>[\s\S]*$/, "");

/** The narration in a partial reply, empty until the reply has shown it is not a Check request. */
function narrationSoFar(partial: string) {
  const reply = withoutThinking(partial);
  const start = reply.match(NARRATION_START);
  if (!start) return "";
  return JSON.parse(`"${reply.slice(start[0].length).match(COMPLETE_JSON_CHARACTERS)![0]}"`) as string;
}

// The first try plus two automatic retries.
const MAX_ATTEMPTS = 3;

type Narrated = {
  /** For the Server Log. */
  kind: "turn" | "opening" | "rewrite" | "regenerate";
  prompt: Prompt;
  /** The text a failure hands back to the player. */
  input: string;
  refusal: string;
  pcName: string;
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
  mayCheck = true,
) {
  const basedOn = saves.latestMessageId(id);
  const prompt = assemblePrompt({
    save: saves.read(id),
    state: saves.latestState(id),
    messages: saves.messages(id),
    modelInstructions: settings.read().modelInstructions,
    input,
    responseSchema: JSON.stringify(responseSchema),
    promptStyle: images.ready() ? promptStyle(settings.read()) : null,
  });
  return narrate(textProvider, signal, emit, {
    kind: input === OPENING_INPUT ? "opening" : "turn",
    prompt,
    input,
    refusal: "The Narrator refused this message. Edit it and try again.",
    pcName: saves.read(id).pc.name,
    rollCheck: mayCheck ? (request) => resolveCheck(request, dice, nearMissMargin) : undefined,
    commit: (narration, check, advance) => saves.commitTurn(id, basedOn, input, narration, check, advance),
    committed: (messageId, scene) => images.sceneChanged(id, messageId, scene),
  });
}

/** The Narrator's first Message, which the player has done nothing to earn a Check in. A story already open is stale. */
export function playOpening(
  saves: SaveStore,
  engine: Parameters<typeof playTurn>[1],
  id: string,
  signal: AbortSignal,
  emit?: TurnEvents,
) {
  if (saves.latestMessageId(id) !== 0) throw new StaleTurn();
  return playTurn(saves, engine, id, OPENING_INPUT, signal, emit, false);
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
  const { input, narration, check, state, messages, sceneImage } = saves.turnToReplace(id, messageId);
  // The old picture goes with its response, so the new one always gets its own, whatever the Narrator decides.
  const hadPicture = !!sceneImage || images.sceneDrawing(id, messageId);
  const prompt = assemblePrompt({
    save: saves.read(id),
    state,
    messages,
    modelInstructions: settings.read().modelInstructions,
    input,
    responseSchema: JSON.stringify(responseSchema),
    promptStyle: images.ready() ? promptStyle(settings.read()) : null,
  });
  const kind = feedback === undefined ? "regenerate" : "rewrite";
  return narrate(textProvider, signal, emit, {
    kind,
    prompt: [...prompt, replacementInstruction(feedback === undefined ? undefined : { narration, feedback }, hadPicture && images.ready())],
    input: feedback ?? "",
    refusal: "The Narrator refused this, so the response stays as it was.",
    pcName: saves.read(id).pc.name,
    check,
    commit: (text, _check, advance) => saves.replaceTurn(id, messageId, text, advance),
    committed: (replacement, scene) => {
      images.forget(id, messageId - 1, kind);
      // shortcut: a Narrator that writes no prompt gets the old one, which shows the old moment and draws with no portraits. Retry the reply if real models do this.
      const description = scene.description || (sceneImage?.prompt ?? "");
      if (hadPicture) log.info("turn", "Replaced Turn's Scene Image forced", { message: replacement });
      if (hadPicture && !scene.description && sceneImage) log.warning("turn", "Replacement drawn from the old image's prompt", { message: replacement });
      images.sceneChanged(id, replacement, hadPicture ? { ...scene, changed: true, description } : scene);
    },
  });
}

async function narrate(
  textProvider: TextProvider,
  signal: AbortSignal,
  emit: TurnEvents,
  { kind, prompt, input, refusal, pcName, check: storedCheck, rollCheck, commit, committed }: Narrated,
) {
  // Kept across attempts, so an invalid reply can never change the outcome.
  let check = storedCheck;
  let narrationSent = 0;
  for (let attempt = 1; ; attempt++) {
    if (narrationSent > 0) emit("restart", {});
    narrationSent = 0;
    let generation: string | undefined;
    let partial = "";
    const onText = (text: string) => {
      partial += text;
      const narration = narrationSoFar(partial);
      if (narration.length <= narrationSent) return;
      emit("narration", { text: narration.slice(narrationSent) });
      narrationSent = narration.length;
    };
    try {
      const reply = await askNarrator(
        textProvider,
        check ? [...prompt, resultInstruction(check)] : prompt,
        { schema: responseSchema, onText, onGeneration: (id) => (generation = id), signal },
        input,
        refusal,
      );
      const response = parseReply(reply, NarratorResponse);
      if (response.check) {
        if (check || !rollCheck) throw new InvalidResponse();
        check = rollCheck(response.check);
        attempt = 0; // The result call gets its own retries.
        continue;
      }
      const { narration, state_operations, people, summary, scene_changed, visual_description } = response;
      let moved = false;
      let location = "";
      let npcs: Scene["npcs"] = [];
      let wearing: Scene["wearing"] = [];
      let portraits: Scene["portraits"] = [];
      let repeated = 0;
      let ignored: Refusal[] = [];
      const messages = commit(narration, check, (state) => {
        const introduced = introduce(state, people, pcName, state_operations);
        const { next, refused, ignored: harmless, repeats } = applyOperations(introduced.state, introduced.operations);
        // Dropping one would leave narration that disagrees with the state, so the whole Turn is invalid.
        if (refused.length > 0) throw new InvalidResponse(undefined, { cause: refused });
        repeated = repeats;
        ignored = harmless;
        if (summary.trim()) next.summary = summary.trim();
        moved = movedScene(state, next);
        location = next.scene.location;
        npcs = next.npcs;
        wearing = next.inventory.wearing;
        portraits = portraitsDue(state, next);
        return next;
      });
      committed(messages.at(-1)!.id, {
        changed: moved || !!scene_changed,
        moved,
        description: visual_description?.trim() ?? "",
        location,
        npcs,
        wearing,
        portraits,
      });
      if (repeated > 0) log.info("turn", "Repeats ignored", { count: repeated });
      if (ignored.length > 0) log.warning("turn", "Operations ignored", { reason: refusalText(ignored) });
      // Counts only, so that the log never repeats the story.
      log.info("turn", "Turn committed", () => ({
        kind,
        message: messages.at(-1)!.id,
        attempts: attempt,
        check: !!check,
        narration: narration.length,
        summary: summary.trim().length,
        people: people.length,
        operations: state_operations.map(({ op }) => op),
        sceneChanged: !!scene_changed,
      }));
      return messages;
    } catch (cause) {
      retryIfInvalid(cause, attempt, input, generation);
    }
  }
}

type Refusal = { op: string; reason: string };
const refusalText = (refusals: Refusal[]) => refusals.map(({ op, reason }) => `${op}: ${reason}`).join(", ");

/** What was wrong with a reply, without any of its text. */
function whyInvalid({ cause }: InvalidResponse) {
  if (cause instanceof z.ZodError) return cause.issues.map(({ path, code }) => `${path.join(".")}: ${code}`).join(", ");
  if (Array.isArray(cause)) return `refused operations: ${refusalText(cause)}`;
  // Not the parser's message, which quotes the reply.
  return cause instanceof SyntaxError ? "not JSON" : "a Check request where none is allowed";
}

/** Returns if another attempt should run. Anything but an invalid reply goes on up. */
function retryIfInvalid(cause: unknown, attempt: number, input: string, generation: string | undefined) {
  if (!(cause instanceof InvalidResponse)) throw cause;
  const reason = whyInvalid(cause);
  log.warning("turn", "Unusable Narrator reply", { attempt, of: MAX_ATTEMPTS, reason, generation });
  if (attempt === MAX_ATTEMPTS) {
    throw new TurnFailed("The Narrator gave no usable response", "retryable", input, { cause: new Error(reason) });
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
    // A stream line that isn't JSON is a garbled reply, so it gets the same retries as one.
    if (cause instanceof SyntaxError) throw new InvalidResponse(undefined, { cause });
    const message = cause instanceof TextProviderFailed ? cause.message : "The Text Provider request failed";
    throw new TurnFailed(message, "retryable", input, { cause });
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
  let generation: string | undefined;
  const request = { schema: jsonSchemaOf(schema), onText: () => {}, onGeneration: (id: string) => (generation = id), signal };
  for (let attempt = 1; ; attempt++) {
    try {
      return parseReply(await askNarrator(textProvider, prompt, request, "", refusal), schema);
    } catch (cause) {
      retryIfInvalid(cause, attempt, "", generation);
    }
  }
}

function parseReply<T>(reply: string, schema: z.ZodType<T>) {
  // shortcut: this takes a code fence or prose around the JSON, but braces in that prose fail validation and retry, parse balanced braces if real models do that.
  const text = withoutThinking(reply);
  try {
    return schema.parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  } catch (cause) {
    throw new InvalidResponse(undefined, { cause });
  }
}
