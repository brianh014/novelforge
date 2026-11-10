import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Dice } from "./check-resolver";
import { InvalidWorkflow, parseWorkflow } from "./comfy-workflow";
import { comfyImages, comfyModels, randomSeed } from "./comfyui";
import { chosenModels, drawSteps, localIsSetUp, promptStyle } from "./graph-builder";
import { withArtStyleFor } from "./web/art-styles";
import { defaultLogLevel, errorFields, errorType, log, setLogLevel, withLogContext } from "./logger";
import { estimateTokens } from "./lore-activation";
import type { ImageAdapter } from "./image-adapter";
import { coverPeople, type EarlyImage, type ImageKind, imagePipeline, pcLooks, pcNow, restyledBy, type PictureWriter, shownFailure, unnamed, visibleNpcs } from "./image-pipeline";
import {
  EditNotFound,
  imageType,
  InvalidSave,
  MAX_IMPORT_BYTES,
  type Message,
  MessageNotFound,
  NoteNotFound,
  OPENING_SNAPSHOT,
  PcDetails,
  PortraitNotFound,
  SaveNotFound,
  saveStore,
  StaleTurn,
} from "./save-store";
import { LONG_TEXT } from "./limits";
import { type SettingsChange, type SettingsStore, SettingsUpdate } from "./settings-store";
import { textHosts, textModels } from "./text-provider";
import { type BegunTurn, liveTurns, STOPPED_STATUS, TurnRunning, WorldChanging } from "./live-turns";
import { type State, VisibleEdit, type World, type WorldEdit } from "./state-applier";
import { askForChapterTitle, ContentRefused, editResponse, playOpening, playTurn, replaceResponse, type TextProvider, TextProviderFailed, TurnFailed, type TurnEvents } from "./turn-engine";
import { readable } from "./web/chat-style";
import spa from "./web/index.html";
import { answerQuestion, changeWorld, decideForPc, ENHANCE_FIELDS, enhance, generateWorld, PC_FIELDS, pcSheet, pickForMe, type PictureAsk, type WorldChoices, type WorldPc, writeImagePrompt, writePicturePrompt } from "./world-creation";

/** What a form's pictures may be held under, as it names their folder. */
const HELD_ID = /^[\w-]{1,64}$/;

const NamedPc = PcDetails.extend({ name: z.string().trim().min(1) });

/** A multiline box of the New Story form, which holds at most this much. */
const longText = z.string().trim().max(LONG_TEXT);

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: NamedPc,
  artStyle: z.string().optional(),
  startingHook: z.string().optional(),
});

/** What the form holds an Important Character's portrait under. */
const Ref = z.string().regex(/^[\w-]{1,40}$/);

const WorldRequest = z.object({
  title: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1),
  worldBrief: longText.min(1),
  startingHook: longText,
  characters: z.array(z.object({ name: z.string().trim().min(1).max(80), description: longText, ref: Ref.optional(), onCover: z.boolean().optional() })).max(10).default([]),
  artStyle: z.string().max(LONG_TEXT).optional(),
  pcOnCover: z.boolean().default(true),
});

/** `id` holds the images already drawn on the form, if any. One the server has lost simply starts again. */
const NewWorldRequest = WorldRequest.extend({
  id: z.string().regex(HELD_ID).optional(),
  pc: NamedPc.extend({ background: z.string().max(LONG_TEXT).optional(), physicalTraits: z.string().max(LONG_TEXT).optional() }),
  inventory: longText.default(""),
});

const someWords = z.string().trim().min(1);
/** The player's own few words for one picture's new prompt, such as "smiling". */
const Nudge = z.string().trim().max(200).default("");

// `id` as in `NewWorldRequest`. The form offers these only once their boxes are filled, and this holds it to that.
const DrawRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cover"),
    id: z.string().regex(HELD_ID).optional(),
    title: someWords.max(80),
    theme: someWords,
    worldBrief: someWords,
    // Whoever the form holds so far, to be on the cover.
    pc: z.object({ name: z.string().trim().max(80), physicalTraits: longText }).default({ name: "", physicalTraits: "" }),
    pcOnCover: z.boolean().default(true),
    characters: z.array(z.object({ name: z.string().trim().max(80), description: longText, ref: Ref.optional(), onCover: z.boolean().optional() })).max(10).default([]),
    // The form's wearing and carrying box, so the PC is drawn dressed before the Narrator has sorted it.
    inventory: longText.default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
  z.object({
    kind: z.literal("portrait"),
    id: z.string().regex(HELD_ID).optional(),
    name: z.string().trim(),
    physicalTraits: someWords.max(LONG_TEXT),
    inventory: longText.default(""),
    // The world the PC belongs to, so they're drawn in its era. Either may be empty while the form is.
    theme: z.string().trim().max(4000).default(""),
    worldBrief: z.string().trim().max(4000).default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
  // An Important Character's portrait, drawn from what the player wrote of them. `pcName` is kept out of it, like their own.
  z.object({
    kind: z.literal("npc"),
    id: z.string().regex(HELD_ID).optional(),
    ref: Ref,
    name: z.string().trim().max(80),
    pcName: z.string().trim().max(80).default(""),
    description: someWords.max(LONG_TEXT),
    theme: z.string().trim().max(4000).default(""),
    worldBrief: z.string().trim().max(4000).default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
]);

const PcBoxes = z.record(z.enum(PC_FIELDS), longText);

const PickRequest = z.object({
  theme: z.string().trim().min(1),
  title: z.string().trim().max(80),
  worldBrief: longText,
  startingHook: longText.optional(),
  pc: PcBoxes.optional(),
});

// A `draft` is the player's own move to Enhance. Without one, the PC's next move is written from scratch.
const DecideRequest = z.object({ draft: z.string().trim().max(4000).default("") });
const QuestionRequest = z.object({ question: z.string().trim().min(1).max(1000) });

const CharacterBoxes = z.object({ name: z.string().trim().max(80), description: longText });

// Any box may be empty, and an empty `text` asks for that box to be written from scratch. `character` is the row an Important Character's box is in.
const EnhanceRequest = z.object({
  field: z.enum(ENHANCE_FIELDS),
  text: longText,
  theme: z.string().trim(),
  title: z.string().trim(),
  worldBrief: longText,
  startingHook: longText,
  // Half-written rows, as the form holds them while the player works on them.
  characters: z.array(CharacterBoxes).max(10).default([]),
  character: CharacterBoxes.optional(),
  pc: PcBoxes.optional(),
});

class WorldNotFound extends Error {}

/** Removes the pictures of forms untouched for `age` milliseconds. A failure only leaves them for next time. */
function pruneHeld(dir: string, age: number) {
  try {
    for (const entry of readdirSync(dir)) {
      const folder = join(dir, entry);
      if (Date.now() - statSync(folder).mtimeMs > age) rmSync(folder, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") log.warning("images", "Old pictures from the form weren't cleared", errorType(error));
  }
}

class UploadRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** A picture the player chose themselves. Sent as a type no form can send, so other websites need a CORS preflight, like an import. */
async function uploaded(req: Request) {
  if (req.headers.get("content-type") !== "application/octet-stream") throw new UploadRefused("A picture must be sent as application/octet-stream", 415);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadRefused("That picture is over 10 MB.", 413);
  if (!imageType(bytes)) throw new UploadRefused("That picture isn't a PNG, JPEG or WebP.", 415);
  return bytes;
}

const IMAGES_OFF = "Images are turned off or not set up in Settings.";

/** A failure falls back on the image before it, whose prompt stands too. A Cover's `pictured` are the held portraits it was drawn from. */
type DrawnImage = EarlyImage & { failure?: string; pictured?: string[] };

// What the page may say. Strict and numbers only, as the app listens on the network, so nothing the page holds can reach the log.
const PAGE_EVENTS = {
  "stream-lost": "info",
  "polling-fallback": "verbose",
  "turn-resumed": "info",
  "polling-gave-up": "warning",
  "narration-restarted": "info",
  "page-error": "error",
} as const;

const pageNumber = z.number().finite().optional();

// A Save's id isn't free text, and the line would be no use without it.
const PageEvent = z.strictObject({
  event: z.enum(Object.keys(PAGE_EVENTS) as (keyof typeof PAGE_EVENTS)[]),
  save: z.uuid().optional(),
  after: pageNumber,
  misses: pageNumber,
  returned: pageNumber,
  line: pageNumber,
  column: pageNumber,
});

const MOST_PAGE_EVENT_BYTES = 1024;

/** The fewest Messages the open Chapter needs before a Narrator's suggestion to end it shows. The player can end one sooner. */
export const MIN_CHAPTER_MESSAGES = 10;
const CHAPTER_TITLE_MESSAGES = 20;
const RECENT_CHARACTERS = 6;

/** Stops reading at the cap, as a Save's import needs the server's own limit to be huge. */
async function cappedBody(req: Request) {
  let bytes = 0;
  const parts: Uint8Array[] = [];
  for await (const part of req.body ?? []) {
    bytes += part.byteLength;
    if (bytes > MOST_PAGE_EVENT_BYTES) return undefined;
    parts.push(part);
  }
  return new Request(req.url, { method: "POST", headers: req.headers, body: Buffer.concat(parts) });
}

const NewTurnRequest = z.object({ input: z.string().min(1) });

const NoFields = z.object({});

const RewriteRequest = z.object({ feedback: z.string().trim().min(1) });

const EditRequest = z.object({ text: z.string().trim().min(1) });

const PromptRequest = z.object({ prompt: z.string().trim().min(1) });

// The form's Art Style can change after a first draw.
const RedrawRequest = PromptRequest.extend({ kind: z.enum(["cover", "portrait", "original", "scene", "requested"]), ref: z.number().int().nonnegative() });

// Only these have a prompt the text model writes from the story, as a Scene Image's comes from its Turn.
const UpdateRequest = z.object({ kind: z.enum(["cover", "portrait", "original"]), ref: z.number().int().nonnegative(), nudge: Nudge });

// Besides the PC, so a cover isn't crowded.
const COVER_NPCS = 3;

// An allowlist, as the Cover and portraits are never the player's to delete.
const DeleteImageRequest = z.object({ kind: z.enum(["scene", "requested"]), ref: z.number().int().nonnegative() });

// Blank draws the scene as it stands.
const ImageRequest = z.object({ words: z.string().trim().max(300) });

const NoteRequest = z.object({ text: z.string().trim().min(1) });

// shortcut: Notes are addressed by position, so a second tab can change the wrong one, give them ids if that ever matters.
function spliceNote(notes: string[], index: string, ...replacement: string[]) {
  const position = Number(index);
  if (notes[position] === undefined) throw new NoteNotFound();
  return notes.toSpliced(position, 1, ...replacement);
}

const WorldChangeRequest = z.object({ change: someWords });

const ArtStyleRequest = z.object({ artStyle: z.string().max(LONG_TEXT) });

const DuplicateRequest = z.object({ fromMessage: z.number().optional() });

// Requiring JSON also stops other websites posting here, since a cross-site JSON POST needs a CORS preflight.
async function parseBody<T>(req: Request, schema: z.ZodType<T>) {
  const isJson = req.headers.get("content-type")?.startsWith("application/json");
  return schema.parse(isJson ? await req.json().catch(() => undefined) : undefined);
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: z.prettifyError(error) }, { status: 400 });
  if (error instanceof InvalidSave || error instanceof InvalidWorkflow) {
    if (error instanceof InvalidSave) log.error("saves", "A Save was refused", errorFields(error));
    return Response.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof SaveNotFound) return Response.json({ error: "Save not found" }, { status: 404 });
  if (error instanceof MessageNotFound) return Response.json({ error: "Message not found" }, { status: 404 });
  if (error instanceof UploadRefused) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof PortraitNotFound) return Response.json({ error: "Portrait not found" }, { status: 404 });
  if (error instanceof NoteNotFound) return Response.json({ error: "Note not found" }, { status: 404 });
  if (error instanceof EditNotFound) return Response.json({ error: "That's no longer in the Journal" }, { status: 404 });
  if (error instanceof WorldNotFound) {
    return Response.json({ error: "This world is no longer held. Go back to your choices and generate it again." }, { status: 404 });
  }
  if (error instanceof StaleTurn) return Response.json({ error: "The story changed during this Turn" }, { status: 409 });
  if (error instanceof TurnRunning) return Response.json({ error: "A Turn is still running for this story" }, { status: 409 });
  if (error instanceof WorldChanging) return Response.json({ error: "The Narrator is still changing the world" }, { status: 409 });
  if (error instanceof TurnFailed) {
    const { message, failure, input } = error;
    // Not the error itself, as its `input` is the story, and not its cause, as a provider's can echo the prompt.
    (failure === "refused" ? log.warning : log.error)("turn", "A Turn failed", { failure, message });
    return Response.json({ error: message, failure, input }, { status: failure === "refused" ? 422 : 502 });
  }
  log.error("http", "A request failed", errorFields(error));
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

// The type comes from the bytes, and a file put in the Saves folder by hand is never checked, so nothing here can run as a page.
const imageResponse = (bytes: Uint8Array<ArrayBuffer>) =>
  new Response(bytes, {
    headers: { "Content-Type": imageType(bytes) ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" },
  });

// A Turn outlives its request, so the player can switch away. Only Stop or the Text Provider's silence limit ends one early.

/** Answers with the committed Messages, as one JSON body or, if the client asks, as a stream of the Turn. */
async function turnResponse(req: Request, turn: BegunTurn, run: (emit: TurnEvents, signal: AbortSignal) => Promise<Message[]>) {
  const streaming = req.headers.get("accept")?.includes("text/event-stream");
  let client: TurnEvents = () => {};
  // Not started yet, as a reply can begin at once and the stream below must be there to hear it.
  const played = Promise.resolve()
    .then(() =>
      run((event, data) => {
        turn.heard(event, data);
        client(event, data);
      }, turn.signal),
    )
    .then(
      (messages) => {
        turn.end();
        return { messages };
      },
      async (error: unknown) => {
        if (turn.signal.aborted) {
          log.info("turn", "A Turn was stopped");
          const body = { error: "", input: turn.input };
          turn.end(streaming ? { ...body, replaces: turn.replaces, status: STOPPED_STATUS } : undefined);
          return { status: STOPPED_STATUS, body };
        }
        // In this log, as the client's copy is gone once the page moves on.
        if (!(error instanceof TurnFailed)) log.error("turn", "A Turn failed", errorFields(error));
        const response = errorResponse(error);
        const body = (await response.json()) as { error: string };
        // A plain JSON client gets its answer here, and has no page to come back to.
        turn.end(streaming ? { ...body, input: turn.input, replaces: turn.replaces, status: response.status } : undefined);
        return { status: response.status, body };
      },
    );
  if (!streaming) {
    const result = await played;
    return "messages" in result ? Response.json(result, { status: 201 }) : Response.json(result.body, { status: result.status });
  }
  let gone = false;
  const stream = new ReadableStream({
    async start(controller) {
      // A client that leaves stops hearing the Turn. A write to a closed stream throws, and that must never reach the Turn.
      const there = () => !gone && !req.signal.aborted;
      const send = (event: string, data: object) => {
        if (there()) controller.enqueue(`event: ${event}
data: ${JSON.stringify(data)}

`);
      };
      client = send;
      const result = await played;
      if (!there()) log.info("turn", "A Turn ended after its client left");
      if ("messages" in result) send("done", result);
      else send("error", { status: result.status, ...result.body });
      if (there()) controller.close();
    },
    cancel() {
      gone = true;
      log.info("turn", "A Turn lost its client", { save: turn.id });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/**
 * Every route, logged by its pattern as a real path holds ids and could hold anything. Each line a request causes,
 * however long after, names its route and any Save, so a Save id needn't be passed down to everything that logs.
 */
function logged<Route extends string>(routes: Bun.Serve.Routes<undefined, Route>) {
  const wrap = (route: string, method: string, handler: (req: Bun.BunRequest) => Response | Promise<Response>) => (req: Bun.BunRequest) => {
    const { id } = req.params as { id?: string };
    // Not `/worlds/:id`, whose id is a story's before it has a Save, which then gets another.
    const save = route.startsWith("/saves/") && z.uuid().safeParse(id).success ? id : undefined;
    return withLogContext({ route, save }, async () => {
      const started = performance.now();
      const response = await Promise.resolve().then(() => handler(req)).catch(errorResponse);
      log.verbose("http", "Request", () => ({ method, status: response.status, ms: Math.round(performance.now() - started) }));
      return response;
    });
  };
  const entries = Object.entries(routes).map(([route, methods]) => [
    route,
    // The page itself is a bundle, which has no methods to wrap.
    route === "/" ? methods : Object.fromEntries(Object.entries(methods as object).map(([method, handler]) => [method, wrap(route, method, handler as never)])),
  ]);
  return Object.fromEntries(entries) as typeof routes;
}

export function startServer(options: {
  savesDir: string;
  textProvider: TextProvider;
  imageAdapter: ImageAdapter;
  /** Loopback unless the caller opens the app to the network, which has no accounts to protect it. */
  hostname?: string;
  dice: Dice;
  nearMissMargin: number;
  settings: SettingsStore;
  port: number;
  /** How a Cover's or portrait's prompt is written. By default the text model writes it. */
  writePicture?: PictureWriter;
}) {
  const saves = saveStore(options.savesDir);
  const turns = liveTurns();
  const { settings } = options;
  try {
    setLogLevel(settings.read().logLevel);
  } catch (error) {
    // Settings that won't read are every request's problem, not a reason not to start.
    log.error("settings", "Settings won't read", errorFields(error));
  }
  // Held here, not in Settings, as it's only how the last job went. It's safe to show, unlike the log.
  // shortcut: a restart clears it and an open Settings screen doesn't update, poll or store it if players miss failures.
  let workflowProblem = "";
  const local = comfyImages(settings, undefined, (problem) => (workflowProblem = problem));
  const images = imagePipeline(
    saves,
    { openrouter: options.imageAdapter, local },
    settings,
    options.writePicture ?? ((ask, style, _template, signal) => writePicturePrompt(options, ask, style, signal)),
  );

  /** Every Chapter, oldest first, ending with the open one, whose `lastMessage` is null. A Chapter holds the Messages after the one before it, up to its own `lastMessage`. */
  function chaptersOf(id: string) {
    const { chapters, chapterReady, sceneMemories } = saves.latestState(id);
    const latest = saves.latestMessageId(id);
    const closed = chapters.map(({ title, lastMessage }) => ({ title, lastMessage: lastMessage ?? latest }));
    const start = closed.at(-1)?.lastMessage ?? 0;
    const open = saves.messages(id).filter(({ id }) => id > start);
    return {
      chapters: [...closed, { title: "", lastMessage: null }],
      open,
      openMemories: sceneMemories.filter(({ firstMessage }) => firstMessage > start).map(({ text }) => text),
      // Below this, a suggestion would end a chapter every few Turns.
      offer: chapterReady && open.length >= MIN_CHAPTER_MESSAGES,
    };
  }
  const engine = { ...options, images };
  // Held here until Begin because a Save holds it all at once, and so that the client never holds the secrets.
  // shortcut: an abandoned world and its images stay until the app restarts, evict them if that ever adds up.
  const worlds = new Map<string, World & Pick<State, "storyTime"> & WorldChoices & WorldPc & { sheet: Awaited<ReturnType<typeof pcSheet>> }>();
  // By the id a form or its world goes by, then the image: "cover", "portrait" for the PC's, or "npcs/<ref>" for an Important Character's.
  // These can be drawn before either a world or a Save exists.
  const held = new Map<string, { drawn: Promise<DrawnImage>; stop: AbortController }>();
  const heldAt = (id: string, image: string) => `${id}/${image}`;

  // Each finished picture is kept on disk too, as the player paid for it, and a crash or restart would otherwise lose it.
  const heldDir = join(dirname(options.savesDir), "held-images");
  // shortcut: a form abandoned for a month loses its pictures at the next start, keep them longer if players come back later.
  pruneHeld(heldDir, 30 * 24 * 60 * 60 * 1000);
  // An id or ref reaches a file name only once it's this plain, so no request can name a path of its own.
  const heldFile = (id: string, image: string) => (HELD_ID.test(id) && /^(cover|portrait|npcs\/[\w-]{1,40})$/.test(image) ? join(heldDir, id, image.replace("/", "-")) : undefined);

  function keepHeld(id: string, image: string, { prompt, bytes, pictured }: DrawnImage) {
    const file = heldFile(id, image);
    if (!file || !bytes) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.image`, bytes);
      writeFileSync(`${file}.json`, JSON.stringify({ prompt, pictured }));
    } catch (error) {
      log.warning("images", "A picture on the form wasn't kept on disk", { kind: kindOf(image), ...errorType(error) });
    }
  }

  /** What the server holds of this picture, from memory or else from disk. A picture kept on disk comes back as it was finished. */
  function heldOf(id: string, image: string) {
    const current = held.get(heldAt(id, image));
    const file = heldFile(id, image);
    if (current || !file || !existsSync(`${file}.json`)) return current;
    try {
      const { prompt, pictured } = JSON.parse(readFileSync(`${file}.json`, "utf8")) as { prompt: string; pictured?: string[] };
      const kept = { drawn: Promise.resolve<DrawnImage>({ prompt, pictured, bytes: new Uint8Array(readFileSync(`${file}.image`)) }), stop: new AbortController() };
      held.set(heldAt(id, image), kept);
      return kept;
    } catch (error) {
      log.warning("images", "A picture on the form couldn't be read back", { kind: kindOf(image), ...errorType(error) });
      return undefined;
    }
  }
  const kindOf = (image: string): ImageKind => (image === "cover" ? "cover" : "portrait");
  /** The held portrait each of a Cover's people is drawn from. */
  const castOf = (people: ReturnType<typeof coverPeople>) => people.map(({ ref }) => (ref === null ? "portrait" : `npcs/${ref}`));
  const characterLooks = (pcName: string, { name, description }: { name: string; description: string }) => unnamed([pcName, name], description);

  /**
   * Replaces any unfinished image, and never rejects: a failure falls back on `before`, so a failed Redraw leaves the old
   * image, and with no `before` keeps its prompt for a retry. `prompt` is a player's own, or written by the text model first.
   * `cast` is a Cover's people by held portrait. A Cover drawn from a player's own prompt shows whoever it showed before.
   */
  function drawHeld(id: string, image: string, prompt: string | ((signal: AbortSignal) => Promise<string>), before?: DrawnImage | Promise<DrawnImage>, cast?: string[]) {
    const key = heldAt(id, image);
    const kind = kindOf(image);
    held.get(key)?.stop.abort();
    const stop = new AbortController();
    log.verbose("images", "Image started", { kind });
    const drawn = (async (): Promise<DrawnImage> => {
      let written = typeof prompt === "string" ? prompt : "";
      let pictured: string[] | undefined;
      try {
        if (typeof prompt !== "string") written = await prompt(stop.signal);
        if (kind === "cover") pictured = cast ?? (await before)?.pictured ?? ["portrait"];
        // A Cover waits for the portraits of those it shows, drawn or drawing, to draw them from.
        const portraits = await Promise.all(
          (pictured ?? []).map(async (who) => ({ role: who === "portrait" ? ("pc" as const) : ("npc" as const), bytes: (await heldOf(id, who)?.drawn)?.bytes })),
        );
        const bytes = await images.drawEarly(kind, written, stop.signal, portraits.flatMap(({ role, bytes }) => (bytes ? [{ role, bytes }] : [])));
        if (bytes) log.info("images", "Image drawn", { kind });
        const finished = { prompt: written, bytes: bytes as Uint8Array<ArrayBuffer> | undefined, pictured };
        // Unless the form has moved on to another, as this one is no longer the player's.
        if (held.get(key)?.stop === stop) keepHeld(id, image, finished);
        return finished;
      } catch (error) {
        const old = (await before) ?? { prompt: written, pictured };
        if (stop.signal.aborted) {
          log.info("images", "Image dropped", { kind, reason: "replaced on the form" });
          return old;
        }
        log.error("images", "Image failed", { kind, ...errorType(error) });
        return { ...old, failure: shownFailure(error) };
      }
    })();
    held.set(key, { drawn, stop });
    return drawn;
  }

  /** In the background, so a slow image never holds up the world. An image drawn or drawing stays, and one that came to nothing gets another try. */
  function drawIfMissing(id: string, image: string, ask: PictureAsk, cast?: string[]) {
    const current = heldOf(id, image);
    if (!current) return void drawHeld(id, image, images.writer(ask), undefined, cast);
    void current.drawn.then(({ bytes }) => {
      if (!bytes && heldOf(id, image) === current) drawHeld(id, image, images.writer(ask), undefined, cast);
    });
  }

  function drawWorldImages(id: string, overview: string, { title, theme, worldBrief, artStyle = "", characters = [], pcOnCover = true }: WorldChoices) {
    const { pc, sheet } = worlds.get(id)!;
    const { wearing } = sheet.inventory;
    const setting = { theme, world: worldBrief, artStyle };
    // The portraits first, as the Cover draws its people from them. Someone with no looks gets no portrait.
    if (pc.physicalTraits?.trim()) drawIfMissing(id, "portrait", { kind: "portrait", looks: pcLooks(pc, wearing), ...setting });
    for (const character of characters) {
      if (character.ref && character.description.trim()) drawIfMissing(id, `npcs/${character.ref}`, { kind: "portrait", looks: characterLooks(pc.name, character), ...setting });
    }
    const people = coverPeople(pc, wearing, characters, "", pcOnCover);
    drawIfMissing(id, "cover", { kind: "cover", title, ...setting, world: overview, people: people.map(({ looks }) => looks) }, castOf(people));
  }

  // Answers once the image is done, so an img tag can simply wait for it.
  const heldImage = async (id: string, image: string) => {
    const bytes = (await heldOf(id, image)?.drawn)?.bytes;
    return bytes ? imageResponse(bytes) : Response.json({ error: `This world has no ${kindOf(image)}` }, { status: 404 });
  };

  // Answers when the Redraw is done, and the Begin that may come first takes whichever image wins.
  const redrawHeld = async (id: string, image: string, req: Request) => {
    const { prompt } = await parseBody(req, PromptRequest);
    const current = heldOf(id, image);
    if (!current) throw new WorldNotFound();
    if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
    // As written, as the prompt holds its own Art Style.
    const { failure } = await drawHeld(id, image, prompt, current.drawn);
    return Response.json(failure ? { error: failure } : {}, { status: failure ? 502 : 200 });
  };

  // The player's own picture in place of any drawn or drawing. It has no prompt, so a Redraw starts from what they write.
  const uploadHeld = async (id: string, image: string, req: Request) => {
    const bytes = await uploaded(req);
    heldOf(id, image)?.stop.abort();
    held.set(heldAt(id, image), { drawn: Promise.resolve({ prompt: "", bytes }), stop: new AbortController() });
    keepHeld(id, image, { prompt: "", bytes });
    log.info("images", "Image uploaded", { kind: kindOf(image) });
    return Response.json({});
  };

  // Answers once the image is done, like the image.
  const heldDetails = async (id: string, image: string) => {
    const drawn = await heldOf(id, image)?.drawn;
    if (!drawn) throw new WorldNotFound();
    const { prompt, bytes, failure = "" } = drawn;
    return Response.json({ prompt, hasImage: bytes !== undefined, failure, canRedraw: images.ready() });
  };

  /** An allowlist, so a visible NPC the PC doesn't know yet stays hidden, and a Revert of that knowledge hides their portrait again. */
  const knownPortraits = (id: string) => {
    const known = saves.latestState(id).pcKnown.npcs;
    return saves.portraits(id).filter(({ npc }) => npc === null || known.includes(npc));
  };

  /** Every image the player may see or Redraw, by the same allowlist. */
  const visibleImages = (id: string) => {
    const known = saves.latestState(id).pcKnown.npcs;
    return saves.gallery(id).filter(({ npc }) => npc === null || known.includes(npc));
  };

  // An allowlist, so the API key can never reach a response.
  const publicSettings = () => {
    const {
      textBaseUrl,
      textModel,
      textRouting,
      textHost,
      textHostFallback,
      textApiKey,
      modelInstructions,
      imageInstructions,
      textMaxTokens,
      textReplyMinutes,
      textRecentMessages,
      answerRejectWords,
      imageProvider,
      imageModel,
      imageApiKey,
      imagesEnabled,
      openNewImages,
      drawScenes,
      updatePortraits,
      comfyUrl,
      comfyFamily,
      comfySdBase,
      imageResolution,
      comfyCheckpoint,
      comfyDiffusionModel,
      comfyTextEncoder,
      comfyVae,
      comfyLoras,
      comfySteps,
      comfyCfg,
      comfyDefaults,
      comfySampler,
      comfyScheduler,
      comfyFamilyPicks,
      comfyMode,
      comfyWorkflow,
      chatStyle,
      fontSize,
      theme,
      logLevel,
    } = settings.read();
    return {
      textBaseUrl,
      textModel,
      textRouting,
      textHost,
      textHostFallback,
      hasTextApiKey: textApiKey !== "",
      modelInstructions,
      imageInstructions,
      textMaxTokens,
      textReplyMinutes,
      textRecentMessages,
      answerRejectWords,
      imageProvider,
      imageModel,
      hasImageApiKey: imageApiKey !== "",
      imagesEnabled,
      openNewImages,
      drawScenes,
      updatePortraits,
      imagesReady: images.ready(),
      comfyUrl,
      comfyFamily,
      comfySdBase,
      imageResolution,
      comfyCheckpoint,
      comfyDiffusionModel,
      comfyTextEncoder,
      comfyVae,
      comfyLoras,
      comfySteps,
      comfyCfg,
      comfyDefaults,
      comfySampler,
      comfyScheduler,
      comfyFamilyPicks,
      comfyMode,
      comfyWorkflow,
      workflowProblem,
      chatStyle,
      fontSize,
      theme,
      logLevel: logLevel ?? null,
      defaultLogLevel: defaultLogLevel(),
    };
  };

  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    // Not hot reload, whose client copies an uncaught page error's words to the terminal, and they can quote the story.
    development: process.env.NODE_ENV !== "production" && { hmr: false },
    // A Turn can stay silent past Bun's default, which would drop the client while the Turn went on to commit.
    idleTimeout: 0,
    // Bun's default of 128 MiB is less than a Save with images. It answers 413 itself past this, before any route runs.
    maxRequestBodySize: MAX_IMPORT_BYTES + 1,
    routes: logged({
      "/": spa,
      "/settings": {
        GET: () => Response.json(publicSettings()),
        PATCH: async (req) => {
          const change = await parseBody(req, SettingsUpdate);
          const current = settings.read();
          const next = { ...current, ...change };
          // Only a workflow in use, as Settings hides the box otherwise, and the player couldn't see what to fix.
          if (next.imageProvider === "local" && next.comfyMode === "advanced") parseWorkflow(next.comfyWorkflow);
          settings.update(change);
          if (next.comfyWorkflow !== current.comfyWorkflow) workflowProblem = "";
          if (change.logLevel !== undefined) setLogLevel(change.logLevel);
          // Names only, as a value can be a key. The form sends every field, so only those that differ.
          const same = (field: keyof SettingsChange) => JSON.stringify(current[field] ?? null) === JSON.stringify(change[field] ?? null);
          log.info("settings", "Settings changed", () => ({ fields: (Object.keys(change) as (keyof SettingsChange)[]).filter((field) => !same(field)) }));
          return Response.json(publicSettings());
        },
      },
      // Only ever the saved server, so a key can't reach an address that is still being typed.
      "/settings/text-models": {
        GET: async (req) => Response.json({ models: await textModels(settings, req.signal) }),
      },
      "/settings/text-hosts": {
        GET: async (req) => Response.json({ hosts: await textHosts(settings, new URL(req.url).searchParams.get("model") ?? "", req.signal) }),
      },
      // The prompt and Model Instructions alone, with no schema, so a failure points at the model and not at the app.
      "/settings/text-test": {
        POST: async (req) => {
          const { prompt } = await parseBody(req, PromptRequest);
          const started = performance.now();
          const elapsed = () => (performance.now() - started) / 1000;
          let firstSeconds: number | undefined;
          try {
            const onText = () => (firstSeconds ??= elapsed());
            const { modelInstructions: content } = settings.read();
            const system = content.trim() ? [{ role: "system" as const, content }] : [];
            const reply = await options.textProvider([...system, { role: "user", content: prompt }], { onText, signal: req.signal });
            const seconds = elapsed();
            return Response.json({
              reply,
              seconds,
              firstSeconds: firstSeconds ?? seconds,
              tokens: estimateTokens(reply),
              model: settings.read().textModel,
            });
          } catch (error) {
            if (error instanceof ContentRefused) log.warning("text", "The model refused the test", errorType(error));
            else log.error("text", "The text test failed", errorFields(error));
            if (error instanceof ContentRefused) return Response.json({ error: "The model refused this prompt." }, { status: 422 });
            const message = error instanceof TextProviderFailed ? error.message : "The Text Provider request failed";
            return Response.json({ error: message }, { status: 502 });
          }
        },
      },
      // Only ever the saved address, never one still being typed.
      "/settings/comfy-models": {
        GET: async (req) => Response.json(await comfyModels(settings, req.signal)),
      },
      // Draws straight to the client, so a test image reaches no Save and no session count.
      "/settings/comfy-test": {
        POST: async (req) => {
          const { prompt } = await parseBody(req, PromptRequest);
          const choices = settings.read();
          if (!localIsSetUp(choices)) return Response.json({ error: "Choose your models and save first." }, { status: 422 });
          try {
            const seed = randomSeed();
            const started = performance.now();
            const payload = { prompt, aspect_ratio: "16:9", reference_images: [], style_preset: "", seed };
            const image = imageResponse((await local(payload, req.signal)) as Uint8Array<ArrayBuffer>);
            // A workflow names its own model and steps, and may ignore the seed.
            const simple = choices.comfyMode === "simple" && { model: chosenModels(choices)[0], steps: drawSteps(choices), seed };
            const stats = { seconds: (performance.now() - started) / 1000, ...simple };
            // Encoded because a model's filename may not be valid in a header.
            image.headers.set("X-Draw-Stats", encodeURIComponent(JSON.stringify(stats)));
            return image;
          } catch (error) {
            log.error("images", "The image test failed", errorType(error));
            // The adapter's messages are written to be shown, but a failed connection is Bun's own, which has a `code`.
            const { code, message } = error as Error & { code?: string };
            return Response.json({ error: code ? "ComfyUI can't be reached at this address. Make sure it's running." : message }, { status: 502 });
          }
        },
      },
      "/log": {
        POST: async (req) => {
          const capped = await cappedBody(req);
          if (!capped) return Response.json({ error: "Too long" }, { status: 400 });
          const { event, ...fields } = await parseBody(capped, PageEvent);
          log[PAGE_EVENTS[event]]("page", event, fields);
          return new Response(null, { status: 204 });
        },
      },
      "/saves": {
        GET: () => Response.json({ saves: saves.list() }),
        POST: async (req) => {
          const save = await parseBody(req, NewSaveRequest);
          const id = saves.create(save);
          images.saveCreated(id);
          return Response.json({ id }, { status: 201 });
        },
      },
      "/worlds": {
        POST: async (req) => {
          const { id = crypto.randomUUID(), pc, inventory, ...choices } = await parseBody(req, NewWorldRequest);
          // First, as it's the small call, and a failure here then costs no world.
          const sheet = await pcSheet(options, pc, inventory, req.signal);
          const { overview, world } = await generateWorld(options, choices, { pc, inventory }, req.signal);
          worlds.set(id, { ...world, ...choices, pc, inventory, sheet });
          drawWorldImages(id, overview, choices);
          return Response.json({ id, overview }, { status: 201 });
        },
      },
      "/worlds/draw": {
        // Answers at once, as the form goes on while an image draws. The prompt holds only the player's own words.
        POST: async (req) => {
          const ask = await parseBody(req, DrawRequest);
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          const { id = crypto.randomUUID(), artStyle } = ask;
          const setting = { theme: ask.theme, world: ask.worldBrief, artStyle, ...(ask.nudge && { nudge: ask.nudge }) };
          // A Redo from the form that fails keeps the image it would have replaced.
          const redo = (image: string, picture: PictureAsk, cast?: string[]) => drawHeld(id, image, images.writer(picture), heldOf(id, image)?.drawn, cast);
          if (ask.kind === "cover") {
            const people = coverPeople(ask.pc, [], ask.characters, ask.inventory, ask.pcOnCover);
            redo("cover", { kind: "cover", title: ask.title, ...setting, people: people.map(({ looks }) => looks) }, castOf(people));
          } else if (ask.kind === "npc") {
            redo(`npcs/${ask.ref}`, { kind: "portrait", ...setting, looks: characterLooks(ask.pcName, ask) });
          } else {
            redo("portrait", { kind: "portrait", ...setting, looks: pcLooks({ name: ask.name, physicalTraits: ask.physicalTraits }, [], ask.inventory) });
          }
          return Response.json({ id }, { status: 201 });
        },
      },
      "/worlds/:id/begin": {
        POST: async (req) => {
          const { artStyle } = await parseBody(req, ArtStyleRequest);
          const world = worlds.get(req.params.id);
          if (!world) throw new WorldNotFound();
          const { title, theme, worldBrief, startingHook, pc, worldBible, worldRules, plotThreads, storyTime, sheet, characters = [] } = world;
          const opening = { worldBible, worldRules, plotThreads, storyTime, ...sheet };
          const id = saves.create({ title, theme, worldBrief, startingHook, pc, artStyle, opening });
          worlds.delete(req.params.id);
          const taken = (image: string) => heldOf(req.params.id, image)?.drawn;
          images.saveCreated(id, taken("portrait"));
          // Often still drawing. The Save may be gone by the time each lands, and a story without one loses nothing.
          const keep = (image: string, store: (drawn: DrawnImage & { bytes: Uint8Array }) => void) =>
            taken(image)
              ?.then((drawn) => drawn.bytes && store(drawn as DrawnImage & { bytes: Uint8Array }))
              .catch((error) => log.warning("images", "A picture from the form wasn't stored", { save: id, kind: kindOf(image), ...errorType(error) }));
          keep("cover", ({ bytes, prompt }) => saves.setCover(id, bytes, prompt));
          // By name, as the Narrator's NPCs go. One a Turn has drawn already keeps that portrait.
          // shortcut: an NPC the Narrator names differently from the form gets a portrait of their own, match looser if that shows.
          for (const { name, ref } of characters) {
            if (ref) keep(`npcs/${ref}`, ({ bytes, prompt }) => !saves.portraitOf(id, name) && saves.addPortrait(id, OPENING_SNAPSHOT, name, bytes, prompt));
          }
          for (const key of held.keys()) if (key.startsWith(`${req.params.id}/`)) held.delete(key);
          // After each picture above has been read, as heldOf reads from disk what isn't in memory.
          if (HELD_ID.test(req.params.id)) rmSync(join(heldDir, req.params.id), { recursive: true, force: true });
          return Response.json({ id }, { status: 201 });
        },
      },
      "/worlds/:id/cover": {
        GET: (req) => heldImage(req.params.id, "cover"),
        POST: (req) => redrawHeld(req.params.id, "cover", req),
        PUT: (req) => uploadHeld(req.params.id, "cover", req),
      },
      "/worlds/:id/cover/details": {
        GET: (req) => heldDetails(req.params.id, "cover"),
      },
      "/worlds/:id/portrait": {
        GET: (req) => heldImage(req.params.id, "portrait"),
        POST: (req) => redrawHeld(req.params.id, "portrait", req),
        PUT: (req) => uploadHeld(req.params.id, "portrait", req),
      },
      "/worlds/:id/portrait/details": {
        GET: (req) => heldDetails(req.params.id, "portrait"),
      },
      "/worlds/:id/npcs/:ref": {
        GET: (req) => heldImage(req.params.id, `npcs/${req.params.ref}`),
        POST: (req) => redrawHeld(req.params.id, `npcs/${req.params.ref}`, req),
        PUT: (req) => uploadHeld(req.params.id, `npcs/${req.params.ref}`, req),
      },
      "/worlds/:id/npcs/:ref/details": {
        GET: (req) => heldDetails(req.params.id, `npcs/${req.params.ref}`),
      },
      "/worlds/pick": {
        POST: async (req) => Response.json(await pickForMe(options, await parseBody(req, PickRequest), req.signal)),
      },
      "/enhance": {
        POST: async (req) => Response.json({ text: await enhance(options, await parseBody(req, EnhanceRequest), req.signal) }),
      },
      "/worlds/:id/regenerate": {
        POST: async (req) => {
          const { id } = req.params;
          const choices = await parseBody(req, WorldRequest);
          const before = worlds.get(id);
          if (!before) throw new WorldNotFound();
          const { overview, world } = await generateWorld(options, choices, before, req.signal);
          worlds.set(id, { ...before, ...world, ...choices });
          drawWorldImages(id, overview, choices);
          return Response.json({ overview });
        },
      },
      "/saves/import": {
        POST: async (req) => {
          // A type no form can send, so other websites need a CORS preflight to post here, like the JSON routes.
          if (req.headers.get("content-type") !== "application/octet-stream") {
            return Response.json({ error: "A Save must be sent as application/octet-stream" }, { status: 415 });
          }
          return Response.json({ id: saves.import(new Uint8Array(await req.arrayBuffer())) }, { status: 201 });
        },
      },
      "/saves/:id": {
        GET: (req) => {
          // An allowlist, so a secret added to the Save can never reach the player by default.
          const { title, worldBrief, pc, artStyle, startingHook, hasCover, coverRedraws } = saves.read(req.params.id);
          log.info("saves", "Save opened");
          return Response.json({ title, worldBrief, pc: { name: pc.name }, artStyle, startingHook, hasCover, coverRedraws });
        },
        PATCH: async (req) => {
          const { artStyle } = await parseBody(req, ArtStyleRequest);
          saves.setArtStyle(req.params.id, artStyle);
          return Response.json({ artStyle });
        },
        DELETE: (req) => {
          saves.delete(req.params.id);
          // Below 0, because the PC's portrait belongs to no Message.
          images.forget(req.params.id, -1, "the Save was deleted");
          return new Response(null, { status: 204 });
        },
      },
      "/saves/:id/cover": {
        GET: (req) => {
          const bytes = saves.cover(req.params.id);
          return bytes ? imageResponse(bytes) : Response.json({ error: "This story has no cover" }, { status: 404 });
        },
      },
      "/saves/:id/export": {
        GET: (req) =>
          new Response(saves.export(req.params.id), {
            headers: {
              "Content-Type": "application/vnd.sqlite3",
              "Content-Disposition": `attachment; filename="novelforge-save-${req.params.id}.sqlite"`,
            },
          }),
      },
      "/saves/:id/journal": {
        GET: (req) => {
          // An allowlist, so the World Bible, Plot Threads and NPC appearance text can never reach the player by default.
          // shortcut: the summary, facts, Loose Ends and Scene Memories are Narrator free text, kept clean only by its prompt, screen them if models leak.
          const { summary, recentSummary, pcKnown, looseEnds, sceneMemories, scene, storyTime, status } = saves.latestState(req.params.id);
          return Response.json({
            status,
            // Without the day count, which only the Narrator uses.
            storyTime: storyTime && { date: storyTime.date, timeOfDay: storyTime.timeOfDay },
            summary,
            recentSummary,
            facts: pcKnown.facts,
            looseEnds,
            sceneMemories,
            npcs: pcKnown.npcs,
            npcSummaries: pcKnown.summaries ?? {},
            // Everyone in the scene, then the last seen. The filter keeps an NPC the PC doesn't know yet hidden.
            recentNpcs: [...new Set([...scene.visibleCast, ...saves.recentCast(req.params.id)])]
              .filter((name) => pcKnown.npcs.includes(name))
              .slice(0, Math.max(RECENT_CHARACTERS, scene.visibleCast.length)),
            portraits: knownPortraits(req.params.id),
            fullLog: saves.messages(req.params.id),
            chapters: chaptersOf(req.params.id).chapters,
          });
        },
      },
      "/saves/:id/chapters": {
        GET: (req) => {
          const { chapters, offer } = chaptersOf(req.params.id);
          return Response.json({ chapters, offer });
        },
        /** Closes the open Chapter after the latest Message. A title the model won't give leaves it untitled, which the player can fix in the Journal. */
        POST: async (req) => {
          const { id } = req.params;
          const basedOn = saves.latestMessageId(id);
          const release = turns.hold(id);
          try {
            const { chapters, open, openMemories } = chaptersOf(id);
            if (open.length === 0) return Response.json({ error: "This chapter has no Messages yet" }, { status: 409 });
            let title = "";
            try {
              title = await askForChapterTitle(options.textProvider, openMemories, readable(open).slice(-CHAPTER_TITLE_MESSAGES), req.signal);
            } catch (error) {
              if (!(error instanceof TurnFailed)) throw error;
              log.warning("chapters", "Chapter title missed", { failure: error.failure, message: error.message });
            }
            if (saves.latestMessageId(id) !== basedOn) throw new StaleTurn();
            saves.addEdit(id, { edit: "closeChapter", title });
            log.info("chapters", "Chapter closed", { chapter: chapters.length, messages: open.length, titled: !!title });
            return Response.json({});
          } finally {
            release();
          }
        },
      },
      "/saves/:id/inventory": {
        GET: (req) => {
          // An allowlist, like the Journal and the status below.
          // shortcut: items and status are Narrator free text, kept clean only by its prompt, screen them if models leak.
          const { wearing, carrying } = saves.latestState(req.params.id).inventory;
          return Response.json({ wearing, carrying });
        },
      },
      "/saves/:id/status": {
        GET: (req) => {
          const { health, injuries, conditions } = saves.latestState(req.params.id).status;
          return Response.json({ health, injuries, conditions });
        },
      },
      // shortcut: no screen uses these since Director's Notes left the UI, kept as the user may bring them back (ticket 31).
      "/saves/:id/notes": {
        GET: (req) => Response.json({ notes: saves.latestState(req.params.id).directorsNotes }),
        POST: async (req) => {
          const { text } = await parseBody(req, NoteRequest);
          return Response.json({ notes: saves.changeNotes(req.params.id, (notes) => [...notes, text]) }, { status: 201 });
        },
      },
      "/saves/:id/notes/:index": {
        PATCH: async (req) => {
          const { text } = await parseBody(req, NoteRequest);
          return Response.json({ notes: saves.changeNotes(req.params.id, (notes) => spliceNote(notes, req.params.index, text)) });
        },
        DELETE: (req) =>
          Response.json({ notes: saves.changeNotes(req.params.id, (notes) => spliceNote(notes, req.params.index)) }),
      },
      "/saves/:id/edits": {
        POST: async (req) => {
          const edit = await parseBody(req, VisibleEdit);
          const { id } = req.params;
          turns.assertIdle(id);
          saves.addEdit(id, edit);
          return Response.json({});
        },
      },
      // Answers with nothing but whether it was done, as the reply holds the hidden world, and so can any error that quotes the provider.
      "/saves/:id/world-change": {
        POST: async (req) => {
          const { change } = await parseBody(req, WorldChangeRequest);
          const { id } = req.params;
          const basedOn = saves.latestMessageId(id);
          const release = turns.hold(id);
          try {
            const before = saves.latestState(id);
            // The PC's looks as they stand, so a change to them keeps all they don't change.
            const looksNow = pcNow(saves.read(id).pc, before).physicalTraits ?? "";
            const { world_brief, summary, facts, npc_summaries, npc_looks, pc_looks, inventory, status, ...update } = await changeWorld(options, { ...before, pcAppearance: looksNow }, change, req.signal);
            if (saves.latestMessageId(id) !== basedOn) throw new StaleTurn();
            const journal: WorldEdit[] = [
              ...(world_brief === null ? [] : [{ edit: "worldBrief" as const, text: world_brief }]),
              ...(summary === null ? [] : [{ edit: "summary" as const, text: summary }]),
              ...facts.map((fact) => ({ edit: "fact" as const, ...fact })),
              ...npc_summaries.map(({ name, summary }) => ({ edit: "npcSummary" as const, name, text: summary })),
              ...(inventory === null ? [] : [{ edit: "inventory" as const, ...inventory }]),
              ...(status === null ? [] : [{ edit: "status" as const, ...status }]),
            ];
            const looks = [
              ...npc_looks.map(({ name, appearance }) => ({ edit: "npcLooks" as const, name, appearance })),
              ...(pc_looks === null ? [] : [{ edit: "pcLooks" as const, appearance: pc_looks }]),
            ];
            for (const edit of [{ edit: "world" as const, update }, ...looks, ...journal]) saves.addEdit(id, edit);
            const after = saves.latestState(id);
            images.restyled(id, restyledBy(before, after), after.inventory.wearing);
            // Counts only, so that the log never repeats the world.
            log.info("world", "World Change applied", () => ({
              lore: update.lore_entries.length,
              removed: update.removed_lore.length,
              rules: update.world_rules.length,
              threads: update.plot_threads.length,
              journal: journal.length,
              looks: looks.length,
            }));
            return Response.json({});
          } catch (error) {
            if (!(error instanceof TurnFailed)) throw error;
            (error.failure === "refused" ? log.warning : log.error)("world", "A World Change failed", { failure: error.failure, message: error.message });
            return Response.json({ error: error.message }, { status: error.failure === "refused" ? 422 : 502 });
          } finally {
            release();
          }
        },
      },
      "/saves/:id/duplicate": {
        POST: async (req) => {
          const { fromMessage } = await parseBody(req, DuplicateRequest);
          return Response.json({ id: saves.duplicate(req.params.id, fromMessage) }, { status: 201 });
        },
      },
      "/saves/:id/turns": {
        POST: async (req) => {
          const { input } = await parseBody(req, NewTurnRequest);
          const { id } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), input), (emit, signal) =>
            playTurn(saves, engine, id, input, signal, emit),
          );
        },
      },
      "/saves/:id/opening": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), ""), (emit, signal) =>
            playOpening(saves, engine, id, signal, emit),
          );
        },
      },
      "/saves/:id/turn": {
        GET: (req) => Response.json(turns.status(req.params.id)),
        DELETE: (req) => new Response(null, { status: turns.stop(req.params.id) ? 204 : 404 }),
      },
      "/saves/:id/decide": {
        POST: async (req) => {
          const { draft } = await parseBody(req, DecideRequest);
          const { id } = req.params;
          const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
          return Response.json({ text: await decideForPc(options, story, req.signal, draft) });
        },
      },
      "/saves/:id/questions": {
        POST: async (req) => {
          const { question } = await parseBody(req, QuestionRequest);
          const { id } = req.params;
          const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
          return Response.json({ text: await answerQuestion(options, story, question, req.signal) });
        },
      },
      "/saves/:id/messages": {
        GET: (req) => Response.json({ messages: saves.messages(req.params.id) }),
      },
      "/saves/:id/images": {
        // shortcut: the caption is Narrator free text, kept clean only by its prompt, screen it if models leak.
        GET: (req) => Response.json({ images: saves.sceneImages(req.params.id), ...images.status(req.params.id) }),
      },
      "/saves/:id/requested-images": {
        GET: (req) => Response.json({ images: saves.requestedImages(req.params.id), drawing: images.drawing(req.params.id) }),
        // Answers at once, as the player can go on while it's written and drawn. What it's drawn from is read now, as this moment is the one they meant.
        POST: async (req) => {
          const { words } = await parseBody(req, ImageRequest);
          const ask = words || "the whole scene, as the latest Message leaves it";
          const { id } = req.params;
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          turns.assertIdle(id);
          const messageId = saves.latestMessageId(id);
          if (messageId === 0) return Response.json({ error: "There's no story to draw from yet." }, { status: 409 });
          const story = { save: withArtStyleFor(saves.read(id), settings.read()), state: saves.latestState(id), messages: saves.messages(id) };
          const style = promptStyle(settings.read());
          // Only those in the Scene, so a mark can't put anyone else's stored looks in a prompt the player reads.
          const moment = { location: story.state.scene.location, npcs: visibleNpcs(story.state), wearing: story.state.inventory.wearing };
          images.drawRequested(id, messageId, words, moment, (signal) => writeImagePrompt(options, story, ask, style, signal));
          return Response.json({}, { status: 202 });
        },
      },
      "/saves/:id/requested-images/failure": {
        GET: (req) => Response.json({ failure: images.takeRequestFailure(req.params.id) }),
      },
      "/saves/:id/requested-images/:ref/image": {
        GET: (req) => imageResponse(saves.requestedImage(req.params.id, Number(req.params.ref))),
      },
      "/saves/:id/gallery": {
        // An allowlist of fields too, so nothing added to an image reaches the player by default.
        // shortcut: a Scene Image's prompt is Narrator free text, kept clean only by its instructions, screen it if models leak.
        GET: (req) => {
          const { id } = req.params;
          const { pc } = saves.read(id);
          const label = ({ kind, npc, caption }: ReturnType<typeof visibleImages>[number]) =>
            kind === "cover" ? "Cover" : kind === "portrait" || kind === "original" ? (npc ?? pc.name) : caption;
          return Response.json({
            images: visibleImages(id).map((image) => {
              const { kind, ref, prompt, redraws } = image;
              return { kind, ref, label: label(image), prompt, redraws, ...images.redrawState(id, image) };
            }),
            pending: images.status(id).pending,
            canRedraw: images.ready(),
          });
        },
      },
      "/saves/:id/gallery/redraw": {
        POST: async (req) => {
          const { id } = req.params;
          const { prompt, kind, ref } = await parseBody(req, RedrawRequest);
          const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
          if (!image) return Response.json({ error: "Image not found" }, { status: 404 });
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          if (!images.redraw(id, { kind, ref }, image.messageId, prompt)) {
            return Response.json({ error: "This image is already being redrawn." }, { status: 409 });
          }
          return Response.json({}, { status: 202 });
        },
      },
      // A Redraw from a new Image Prompt, written from the story as it stands, by the same allowlist as the first.
      "/saves/:id/gallery/update": {
        POST: async (req) => {
          const { id } = req.params;
          const { kind, ref, nudge } = await parseBody(req, UpdateRequest);
          const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
          if (!image) return Response.json({ error: "Image not found" }, { status: 404 });
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          const { pc, title, theme, artStyle } = saves.read(id);
          const state = saves.latestState(id);
          const { inventory, npcs, scene, worldBrief, pcKnown } = state;
          const looksOf = (name: string) => npcs.find((npc) => npc.name === name)?.appearance.trim() ?? "";
          const pcLooksNow = pcLooks(pcNow(pc, state), inventory.wearing);
          // shortcut: the Important Characters aren't kept in a Save, so a Cover shows the PC and those met lately, keep them if covers miss them.
          const met = [...new Set([...scene.visibleCast, ...saves.recentCast(id)])].filter((name) => pcKnown.npcs.includes(name)).slice(0, COVER_NPCS);
          const setting = { theme, world: worldBrief, artStyle, ...(nudge && { nudge }) };
          const ask: PictureAsk =
            kind === "cover"
              ? { kind, title, ...setting, people: [pcLooksNow, ...met.map(looksOf)].filter(Boolean) }
              : { kind: "portrait", ...setting, looks: image.npc === null ? pcLooksNow : looksOf(image.npc) };
          if (ask.kind === "portrait" && !ask.looks) return Response.json({ error: "There are no looks to draw this from." }, { status: 409 });
          if (!images.redraw(id, { kind, ref }, image.messageId, ask)) {
            return Response.json({ error: "This image is already being redrawn." }, { status: 409 });
          }
          return Response.json({}, { status: 202 });
        },
      },
      // The player's own picture in place of a Cover or portrait. It keeps the old prompt, for a Redraw to go back to drawing.
      "/saves/:id/gallery/:kind/:ref": {
        PUT: async (req) => {
          const { id, kind } = req.params;
          const ref = Number(req.params.ref);
          const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
          if (!image || (kind !== "cover" && kind !== "portrait" && kind !== "original")) return Response.json({ error: "Image not found" }, { status: 404 });
          if (images.redrawState(id, { kind, ref }).redrawing) {
            return Response.json({ error: "This image is being redrawn. Try again when it's done." }, { status: 409 });
          }
          saves.replaceImage(id, { kind, ref }, image.prompt, await uploaded(req));
          log.info("images", "Image uploaded", { save: id, kind });
          return Response.json({});
        },
      },
      "/saves/:id/gallery/delete": {
        POST: async (req) => {
          const { id } = req.params;
          const { kind, ref } = await parseBody(req, DeleteImageRequest);
          if (!visibleImages(id).some((candidate) => candidate.kind === kind && candidate.ref === ref)) {
            return Response.json({ error: "Image not found" }, { status: 404 });
          }
          if (images.redrawState(id, { kind, ref }).redrawing) {
            return Response.json({ error: "This image is being redrawn. Try again when it's done." }, { status: 409 });
          }
          saves.deleteImage(id, { kind, ref });
          return Response.json({});
        },
      },
      "/saves/:id/messages/:messageId/image": {
        GET: (req) => imageResponse(saves.sceneImage(req.params.id, Number(req.params.messageId))),
      },
      "/saves/:id/portraits/:portraitId": {
        GET: (req) => {
          const { id } = req.params;
          const portraitId = Number(req.params.portraitId);
          if (!knownPortraits(id).some((portrait) => portrait.id === portraitId)) throw new PortraitNotFound();
          return imageResponse(saves.portrait(id, portraitId));
        },
      },
      "/saves/:id/portraits/:portraitId/original": {
        GET: (req) => {
          const { id } = req.params;
          const portraitId = Number(req.params.portraitId);
          const bytes = knownPortraits(id).some((portrait) => portrait.id === portraitId) && saves.original(id, portraitId);
          if (!bytes) throw new PortraitNotFound();
          return imageResponse(bytes);
        },
      },
      "/saves/:id/messages/:messageId/snapshot": {
        GET: (req) => {
          // An allowlist, so a new secret section can never reach the player by default.
          const { inventory, status, pcKnown } = saves.snapshot(req.params.id, Number(req.params.messageId));
          return Response.json({ inventory, status, pcKnown });
        },
      },
      "/saves/:id/messages/:messageId/rewrite": {
        POST: async (req) => {
          const { feedback } = await parseBody(req, RewriteRequest);
          const { id, messageId } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), feedback, Number(messageId)), (emit, signal) =>
            replaceResponse(saves, engine, id, Number(messageId), feedback, signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/edit": {
        POST: async (req) => {
          const { text } = await parseBody(req, EditRequest);
          const { id, messageId } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), text, Number(messageId)), (emit, signal) =>
            editResponse(saves, engine, id, Number(messageId), text, signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/regenerate": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id, messageId } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), "", Number(messageId)), (emit, signal) =>
            replaceResponse(saves, engine, id, Number(messageId), undefined, signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/revert": {
        GET: (req) => Response.json(saves.revertPreview(req.params.id, Number(req.params.messageId))),
        POST: async (req) => {
          await parseBody(req, NoFields);
          const deleted = saves.revert(req.params.id, Number(req.params.messageId));
          images.forget(req.params.id, Number(req.params.messageId), "revert");
          return Response.json(deleted);
        },
      },
    }),
    fetch: () => {
      log.verbose("http", "No such route");
      return Response.json({ error: "Not found" }, { status: 404 });
    },
    error: errorResponse,
  });
}
