import { z } from "zod";
import { type Check, CheckRequest, type Dice, resolveCheck } from "./check-resolver";
import { type ImagePipeline, movedScene, portraitsDue, restyledBy, type Scene } from "./image-pipeline";
import { promptStyle } from "./graph-builder";
import { withArtStyleFor } from "./web/art-styles";
import { errorFields, log } from "./logger";
import {
  assemblePrompt,
  chapterTitlePrompt,
  CONTINUE_INPUT,
  editInstruction,
  memoryDue,
  memoryPrompt,
  OPENING_INPUT,
  type Prompt,
  replacementInstruction,
  resultInstruction,
  SET_SCENE_NOTE,
} from "./prompt-assembler";
import { type Message, type SaveStore, StaleTurn } from "./save-store";
import type { SettingsStore } from "./settings-store";
import { applyOperations, introduce, Person, type SceneMemory, type State, StateOperation } from "./state-applier";
import { readable } from "./web/chat-style";

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
  recent_summary: z.string().nullish().catch(""),
  scene_changed: z.boolean().nullish(),
  visual_description: z.string().nullish(),
  chapter_ends: z.boolean().nullish(),
  // Without this, narration beside an invalid difficulty would pass as a finished Turn and dodge the Check.
  check: z.null().optional(),
});
const NarratorResponse = z.union([z.object({ check: CheckRequest }), FinishedTurn]);
/** The player wrote the narration of an Edit, so the reply holds only what follows from it. */
const EditedTurn = FinishedTurn.extend({ narration: z.string().nullish() });

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
const ResponseShape = z.object({
  check: CheckRequest.nullable(),
  narration: z.string().nullable(),
  state_operations: z.array(StateOperation),
  // Described here for the same reason as chapter_ends: speakers kept going missing from it.
  people: z
    .array(Person)
    .describe(
      "everyone the narration names or gives a spoken line to, other than the PC, even someone only mentioned, each with their name and appearance. Someone new never gets a name the state already has for someone else, as people are matched by name",
    ),
  summary: z.string(),
  recent_summary: z.string(),
  scene_changed: z.boolean().nullable(),
  // The length beside the field too, as the Narrator writes the people's looks itself and a rule mid-prompt gets ignored.
  visual_description: z
    .string()
    .nullable()
    .describe("the picture's prompt, written as the rules say and kept within their word limit with each person's looks counted in it"),
  // Defined here, beside the field, as a rule mid-prompt is the kind Narrators ignore.
  chapter_ends: z
    .boolean()
    .nullable()
    .describe(
      "true only when a Scene has just resolved and the story is about to move to a new place, a new time, or a new stage in a Plot Thread, which suggests ending the chapter here",
    ),
});
const responseSchema = jsonSchemaOf(ResponseShape);
// Once a Check is rolled, or none can be, the schema itself forbids one, as the prompt's "do not request another check" was ignored three times running.
const noCheckSchema = jsonSchemaOf(ResponseShape.extend({ check: z.null() }));

// shortcut: a reply in another key order or after prose shows no narration until the Turn is done, loosen this only if real models do that often.
const NARRATION_START = /^\s*(?:```(?:json)?\s*)?\{\s*"check"\s*:\s*null\s*,\s*"narration"\s*:\s*"/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: JSON strings may not hold raw control characters, so this matches what they can.
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
  kind: "turn" | "opening" | "rewrite" | "regenerate" | "edit";
  prompt: Prompt;
  /** The text a failure hands back to the player. */
  input: string;
  refusal: string;
  pcName: string;
  /** The player's own words for an Edit, which stand in for whatever narration the reply holds. */
  narration?: string;
  check?: Check;
  /** The Scene Memory this Turn adds, if one is due and came back. */
  memory: Promise<SceneMemory | null>;
  /** Left out when no new roll is allowed, which makes a Check request an invalid reply. */
  rollCheck?: (request: z.infer<typeof CheckRequest>) => Check;
  commit: (narration: string, check: Check | undefined, advance: (state: State) => State) => Message[];
  /** Runs once the Turn is committed, so image work is never part of its transaction. */
  committed: (messageId: number, scene: Scene) => void;
};

/** The prompt for a Turn's reply, and the Scene Memory due alongside it. Settings are read once, so the whole prompt comes from one copy. */
function turnPrompt(
  saves: SaveStore,
  settings: SettingsStore,
  id: string,
  signal: AbortSignal,
  textProvider: TextProvider,
  {
    state,
    messages,
    input,
    directions,
    picture,
  }: Pick<Parameters<typeof assemblePrompt>[0], "state" | "messages" | "input" | "directions"> & { picture: boolean },
) {
  const current = settings.read();
  const memoryStart = saves.memoryStart(id);
  return {
    prompt: assemblePrompt({
      save: withArtStyleFor(saves.read(id), current),
      state,
      messages,
      memoryStart,
      windowMessages: current.textRecentMessages,
      modelInstructions: current.modelInstructions,
      imageInstructions: current.imageInstructions,
      directions,
      input,
      responseSchema: JSON.stringify(responseSchema),
      promptStyle: picture ? promptStyle(current) : null,
    }),
    memory: nextMemory(textProvider, messages, state.sceneMemories, memoryStart, current.textRecentMessages, signal),
  };
}

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
  const state = saves.latestState(id);
  const messages = saves.messages(id);
  const { prompt, memory } = turnPrompt(saves, settings, id, signal, textProvider, {
    state,
    messages,
    input,
    directions: saves.directions(id, basedOn),
    picture: images.ready(),
  });
  return narrate(textProvider, signal, emit, {
    kind: input === OPENING_INPUT ? "opening" : "turn",
    prompt,
    input,
    refusal: "The Narrator refused this message. Edit it and try again.",
    pcName: saves.read(id).pc.name,
    memory,
    // The PC attempts nothing in a Continue, so there is nothing to roll for.
    rollCheck: mayCheck && input !== CONTINUE_INPUT ? (request) => resolveCheck(request, dice, nearMissMargin) : undefined,
    commit: (narration, check, advance) => saves.commitTurn(id, basedOn, input, narration, check, advance),
    committed: (messageId, scene) => images.sceneChanged(id, messageId, scene),
  });
}

/** The Narrator's first Message, which the player has done nothing to earn a Check in. A story already open is stale. */
export function playOpening(saves: SaveStore, engine: Parameters<typeof playTurn>[1], id: string, signal: AbortSignal, emit?: TurnEvents) {
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
  const { prompt, memory } = turnPrompt(saves, settings, id, signal, textProvider, {
    state,
    messages,
    input,
    // The response being replaced keeps its own, which a Regenerate carries over.
    directions: saves.directions(id, messageId),
    picture: images.ready(),
  });
  const kind = feedback === undefined ? "regenerate" : "rewrite";
  return narrate(textProvider, signal, emit, {
    kind,
    prompt: [...prompt, ...replacementInstruction(feedback === undefined ? undefined : { narration, feedback }, hadPicture && images.ready())],
    input: feedback ?? "",
    refusal: "The Narrator refused this, so the response stays as it was.",
    pcName: saves.read(id).pc.name,
    check,
    memory,
    commit: (text, _check, advance) => saves.replaceTurn(id, messageId, text, advance, feedback?.trim() || undefined),
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

/** An Edit: the player's words replace the latest response's, and the Narrator brings the state in line with them. The picture and any Check stay. */
export async function editResponse(
  saves: SaveStore,
  { textProvider, settings, images }: { textProvider: TextProvider; settings: SettingsStore; images: ImagePipeline },
  id: string,
  messageId: number,
  text: string,
  signal: AbortSignal,
  emit: TurnEvents = () => {},
) {
  const { input, state, messages } = saves.turnToReplace(id, messageId);
  const { prompt, memory } = turnPrompt(saves, settings, id, signal, textProvider, {
    state,
    messages,
    input,
    // No picture is drawn, so the Narrator needn't write a prompt for one.
    picture: false,
  });
  return narrate(textProvider, signal, emit, {
    kind: "edit",
    prompt: [...prompt, editInstruction(text)],
    input: text,
    refusal: "The Narrator refused this edit, so the response stays as it was.",
    pcName: saves.read(id).pc.name,
    narration: text,
    memory,
    commit: (narration, _check, advance) => saves.editTurn(id, messageId, narration, advance),
    // Only portraits for anyone new, as the Scene Image stays.
    committed: (edited, scene) => images.sceneChanged(id, edited, { ...scene, changed: false }),
  });
}

async function narrate(
  textProvider: TextProvider,
  signal: AbortSignal,
  emit: TurnEvents,
  { kind, prompt, input, refusal, pcName, narration: edited, check: storedCheck, memory: pendingMemory, rollCheck, commit, committed }: Narrated,
) {
  // Kept across attempts, so an invalid reply can never change the outcome.
  let check = storedCheck;
  let narrationSent = 0;
  let retry = "";
  let unplacedBefore = false;
  for (let attempt = 1; ; attempt++) {
    // Without a reason the player sees text vanish, which looks like a glitch.
    if (narrationSent > 0) emit("restart", { reason: retry });
    narrationSent = 0;
    let generation: string | undefined;
    let partial = "";
    const onText = (text: string) => {
      if (edited !== undefined) return;
      partial += text;
      const narration = narrationSoFar(partial);
      if (narration.length <= narrationSent) return;
      emit("narration", { text: narration.slice(narrationSent) });
      narrationSent = narration.length;
    };
    try {
      const reply = await askNarrator(
        textProvider,
        [...prompt, ...(check ? [resultInstruction(check)] : []), ...(unplacedBefore ? [SET_SCENE_NOTE] : [])],
        { schema: check || !rollCheck ? noCheckSchema : responseSchema, onText, onGeneration: (id) => (generation = id), signal },
        input,
        refusal,
      );
      const response = parseReply<z.infer<typeof NarratorResponse | typeof EditedTurn>>(reply, edited === undefined ? NarratorResponse : EditedTurn);
      if (response.check) {
        if (check || !rollCheck) throw new InvalidResponse();
        check = rollCheck(response.check);
        attempt = 0; // The result call gets its own retries.
        continue;
      }
      const { state_operations, people, summary, recent_summary, scene_changed, visual_description, chapter_ends } = response;
      const narration = edited ?? (response.narration as string);
      // The last attempt keeps such a reply, as losing the Turn costs more than a long speech.
      // A picture without set_scene takes the last location as its caption and its previous image as a reference.
      const unplaced = scene_changed && !state_operations.some(({ op }) => op === "set_scene") ? "a picture without set_scene" : undefined;
      const spoken = edited === undefined ? spokenLineFault(narration) : undefined;
      // A long speech is only logged, as rewriting it restarted too many Turns the player could see.
      const fault = attempt < MAX_ATTEMPTS ? (unplaced ?? (spoken === LONG_SPEECH ? undefined : spoken)) : undefined;
      unplacedBefore = fault === unplaced && !!unplaced;
      if (fault) throw new InvalidResponse(undefined, { cause: fault });
      if (spoken === LONG_SPEECH) log.warning("turn", "Long speech kept", { attempt, generation });
      const memory = await pendingMemory;
      let moved = false;
      let location = "";
      let npcs: Scene["npcs"] = [];
      let wearing: Scene["wearing"] = [];
      let portraits: Scene["portraits"] = [];
      let restyled: Scene["restyled"] = [];
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
        if (recent_summary?.trim()) next.recentSummary = recent_summary.trim();
        if (memory) next.sceneMemories.push(memory);
        next.chapterReady = !!chapter_ends;
        moved = movedScene(state, next);
        location = next.scene.location;
        npcs = next.npcs;
        wearing = next.inventory.wearing;
        portraits = portraitsDue(state, next);
        restyled = restyledBy(state, next);
        return next;
      });
      // The Turn is saved by now, so image trouble must not report it failed, or the player would send it again.
      try {
        committed(messages.at(-1)!.id, {
          changed: moved || !!scene_changed,
          moved,
          description: visual_description?.trim() ?? "",
          location,
          npcs,
          wearing,
          portraits,
          restyled,
        });
      } catch (error) {
        log.error("turn", "Image work after commit failed", errorFields(error));
      }
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
        ...(memory && { memoryFirst: memory.firstMessage, memoryLast: memory.lastMessage, memoryLength: memory.text.length }),
        people: people.length,
        operations: state_operations.map(({ op }) => op),
        sceneChanged: !!scene_changed,
        chapterEnds: !!chapter_ends,
      }));
      return messages;
    } catch (cause) {
      retry = `${retryIfInvalid(cause, attempt, input, generation)}, so the Narrator is writing it again (try ${attempt + 1} of ${MAX_ATTEMPTS}).`;
    }
  }
}

/** Why the spoken lines break the reply's shape, if they do: a tag missing its "[", or someone speaking more than twice. */
export function spokenLineFault(narration: string) {
  const lines = new Map<string, number>();
  for (const line of narration.split("\n").map((text) => text.trim())) {
    if (/^[^[\]\s][^[\]]*\]:/.test(line)) return "a speaker tag without its [";
    const speaker = line.match(/^\[([^[\]]+)\]:/)?.[1]?.trim();
    if (speaker) lines.set(speaker, (lines.get(speaker) ?? 0) + 1);
  }
  return [...lines.values()].some((count) => count > 2) ? LONG_SPEECH : undefined;
}
const LONG_SPEECH = "someone speaks more than twice";

type Refusal = { op: string; reason: string };
const refusalText = (refusals: Refusal[]) => refusals.map(({ op, reason }) => `${op}: ${reason}`).join(", ");

/** What was wrong with a reply, without any of its text. */
function whyInvalid({ cause }: InvalidResponse) {
  if (typeof cause === "string") return cause;
  // A custom check's message is the app's own fixed words, never the reply's, so it may name what failed.
  if (cause instanceof z.ZodError) return cause.issues.map(({ path, code, message }) => `${path.join(".")}: ${code === "custom" ? message : code}`).join(", ");
  if (Array.isArray(cause)) return `refused operations: ${refusalText(cause)}`;
  // Not the parser's message, which quotes the reply.
  return cause instanceof SyntaxError ? "not JSON" : "a Check request where none is allowed";
}

/** What a player is told of an invalid reply, never quoting it, as a reply may hold secrets. */
function playerReason({ cause }: InvalidResponse) {
  if (cause === "a speaker tag without its [") return "A spoken line in the last reply was missing its speaker";
  if (cause === "a picture without set_scene") return "The last reply moved to a new scene without saying where";
  if (Array.isArray(cause)) return "The last reply changed the story in a way that doesn't fit what's already true";
  if (cause === undefined) return "The last reply asked for a second dice roll";
  return "The last reply came back garbled";
}

/** Returns, if another attempt should run, why it's needed in the player's words. Anything but an invalid reply goes on up. */
function retryIfInvalid(cause: unknown, attempt: number, input: string, generation: string | undefined) {
  if (!(cause instanceof InvalidResponse)) throw cause;
  const reason = whyInvalid(cause);
  log.warning("turn", "Unusable Narrator reply", { attempt, of: MAX_ATTEMPTS, reason, generation });
  if (attempt === MAX_ATTEMPTS) {
    throw new TurnFailed("The Narrator gave no usable response", "retryable", input, { cause: new Error(reason) });
  }
  return playerReason(cause);
}

async function askNarrator(textProvider: TextProvider, prompt: Prompt, request: Parameters<TextProvider>[1], input: string, refusal: string) {
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
const SceneMemoryReply = z.object({ scene_memory: z.string().refine((text) => text.trim() !== "") });

/** Throws as askForJson does. */
export async function askForMemory(textProvider: TextProvider, batch: Message[], previous: string | undefined, signal: AbortSignal) {
  const { scene_memory } = await askForJson(textProvider, memoryPrompt(batch, previous), SceneMemoryReply, "The model refused a batch of Messages.", signal);
  return scene_memory.trim();
}

const ChapterTitleReply = z.object({ title: z.string().trim().min(1).max(80) });

/** Throws as askForJson does. */
export async function askForChapterTitle(textProvider: TextProvider, memories: string[], recent: Message[], signal: AbortSignal) {
  const { title } = await askForJson(textProvider, chapterTitlePrompt(memories, recent), ChapterTitleReply, "The model refused to title the chapter.", signal);
  return title;
}

/** Runs beside the Turn, so the player waits no longer. A missed memory costs nothing: the window keeps its Messages, and the next Turn asks again. */
async function nextMemory(
  textProvider: TextProvider,
  messages: Message[],
  sceneMemories: SceneMemory[],
  memoryStart: number,
  windowMessages: number,
  signal: AbortSignal,
) {
  const range = memoryDue(messages, sceneMemories, memoryStart, windowMessages);
  if (!range) return null;
  const batch = readable(messages.filter(({ id }) => id >= range.firstMessage && id <= range.lastMessage));
  try {
    return { ...range, text: await askForMemory(textProvider, batch, sceneMemories.at(-1)?.text, signal) };
  } catch (cause) {
    log.warning("turn", "Scene Memory missed", { reason: cause instanceof Error ? cause.message : "unknown" });
    return null;
  }
}

export async function askForJson<T>(textProvider: TextProvider, prompt: Prompt, schema: z.ZodType<T>, refusal: string, signal: AbortSignal) {
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
