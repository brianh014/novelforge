import { z } from "zod";
import type { Dice } from "./check-resolver";
import { InvalidWorkflow, parseWorkflow } from "./comfy-workflow";
import { comfyImages, comfyModels, randomSeed } from "./comfyui";
import { chosenModels, drawSteps, localIsSetUp, promptStyle } from "./graph-builder";
import { estimateTokens } from "./lore-activation";
import type { ImageAdapter } from "./image-adapter";
import { coverPrompt, type EarlyImage, type ImageKind, imagePipeline, shownFailure, visibleNpcs } from "./image-pipeline";
import {
  EditNotFound,
  imageType,
  InvalidSave,
  MAX_IMPORT_BYTES,
  type Message,
  MessageNotFound,
  NoteNotFound,
  PcDetails,
  PortraitNotFound,
  SaveNotFound,
  saveStore,
  StaleTurn,
} from "./save-store";
import { type SettingsStore, SettingsUpdate } from "./settings-store";
import { textModels } from "./text-provider";
import { type BegunTurn, liveTurns, TurnRunning, WorldChanging } from "./live-turns";
import { VisibleEdit, type World } from "./state-applier";
import { ContentRefused, playOpening, playTurn, replaceResponse, type TextProvider, TextProviderFailed, TurnFailed, type TurnEvents } from "./turn-engine";
import spa from "./web/index.html";
import { changeWorld, decideForPc, ENHANCE_FIELDS, enhance, generateWorld, PC_FIELDS, pcSheet, pickForMe, type WorldChoices, type WorldPc, writeImagePrompt } from "./world-creation";

const NamedPc = PcDetails.extend({ name: z.string().trim().min(1) });

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: NamedPc,
  artStyle: z.string().optional(),
  startingHook: z.string().optional(),
});

const WorldRequest = z.object({
  title: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1),
  worldBrief: z.string().trim().min(1),
  startingHook: z.string().trim(),
  artStyle: z.string().optional(),
});

/** `id` holds the images already drawn on the form, if any. One the server has lost simply starts again. */
const NewWorldRequest = WorldRequest.extend({
  id: z.string().optional(),
  pc: NamedPc,
  inventory: z.array(z.string().trim().min(1)).default([]),
});

const someWords = z.string().trim().min(1);

// `id` as in `NewWorldRequest`. The form offers these only once their boxes are filled, and this holds it to that.
const DrawRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cover"),
    id: z.string().optional(),
    title: someWords.max(80),
    theme: someWords,
    worldBrief: someWords,
    artStyle: z.string().default(""),
  }),
  z.object({
    kind: z.literal("portrait"),
    id: z.string().optional(),
    name: z.string().trim(),
    physicalTraits: someWords,
    artStyle: z.string().default(""),
  }),
]);

const PcBoxes = z.record(z.enum(PC_FIELDS), z.string().trim());

const PickRequest = z.object({
  theme: z.string().trim().min(1),
  title: z.string().trim().max(80),
  worldBrief: z.string().trim(),
  startingHook: z.string().trim().optional(),
  pc: PcBoxes.optional(),
});

// Any box may be empty, and an empty `text` asks for that box to be written from scratch.
const EnhanceRequest = z.object({
  field: z.enum(ENHANCE_FIELDS),
  text: z.string().trim(),
  theme: z.string().trim(),
  title: z.string().trim(),
  worldBrief: z.string().trim(),
  startingHook: z.string().trim(),
  pc: PcBoxes.optional(),
});

class WorldNotFound extends Error {}

const IMAGES_OFF = "Images are turned off or not set up in Settings.";

/** A failure falls back on the image before it, whose prompt stands too. */
type DrawnImage = EarlyImage & { failure?: string };

const NewTurnRequest = z.object({ input: z.string().min(1) });

const NoFields = z.object({});

const RewriteRequest = z.object({ feedback: z.string().trim().min(1) });

const PromptRequest = z.object({ prompt: z.string().trim().min(1) });

// The form's Art Style can change after a first draw.
const HeldRedrawRequest = PromptRequest.extend({ artStyle: z.string().optional() });

const RedrawRequest = PromptRequest.extend({ kind: z.enum(["cover", "portrait", "scene", "requested"]), ref: z.number().int().nonnegative() });

const ImageRequest = z.object({ words: someWords.max(300) });

const NoteRequest = z.object({ text: z.string().trim().min(1) });

// shortcut: Notes are addressed by position, so a second tab can change the wrong one, give them ids if that ever matters.
function spliceNote(notes: string[], index: string, ...replacement: string[]) {
  const position = Number(index);
  if (notes[position] === undefined) throw new NoteNotFound();
  return notes.toSpliced(position, 1, ...replacement);
}

const WorldChangeRequest = z.object({ change: someWords });

const ArtStyleRequest = z.object({ artStyle: z.string() });

const DuplicateRequest = z.object({ fromMessage: z.number().optional() });

// Requiring JSON also stops other websites posting here, since a cross-site JSON POST needs a CORS preflight.
async function parseBody<T>(req: Request, schema: z.ZodType<T>) {
  const isJson = req.headers.get("content-type")?.startsWith("application/json");
  return schema.parse(isJson ? await req.json().catch(() => undefined) : undefined);
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: z.prettifyError(error) }, { status: 400 });
  if (error instanceof InvalidSave || error instanceof InvalidWorkflow) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof SaveNotFound) return Response.json({ error: "Save not found" }, { status: 404 });
  if (error instanceof MessageNotFound) return Response.json({ error: "Message not found" }, { status: 404 });
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
    // Not the error itself, as its `input` is the story.
    console.error(`A Turn failed (${failure}): ${message}`, error.cause);
    return Response.json({ error: message, failure, input }, { status: failure === "refused" ? 422 : 502 });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

// The type comes from the bytes, and a file put in the Saves folder by hand is never checked, so nothing here can run as a page.
const imageResponse = (bytes: Uint8Array<ArrayBuffer>) =>
  new Response(bytes, {
    headers: { "Content-Type": imageType(bytes) ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" },
  });

// A Turn outlives its request, so the player can switch away. The Text Provider's silence limit still ends a stuck one.
// shortcut: nothing can stop a running Turn, so one the player abandons is still paid for, add a Stop button if that adds up.
const NEVER = new AbortController().signal;

/** Answers with the committed Messages, as one JSON body or, if the client asks, as a stream of the Turn. */
async function turnResponse(req: Request, turn: BegunTurn, run: (emit: TurnEvents) => Promise<Message[]>) {
  const streaming = req.headers.get("accept")?.includes("text/event-stream");
  let client: TurnEvents = () => {};
  // Not started yet, as a reply can begin at once and the stream below must be there to hear it.
  const played = Promise.resolve()
    .then(() =>
      run((event, data) => {
        turn.heard(event, data);
        client(event, data);
      }),
    )
    .then(
      (messages) => {
        turn.end();
        return { messages };
      },
      async (error: unknown) => {
        // In this log, as the client's copy is gone once the page moves on.
        if (!(error instanceof TurnFailed)) console.error("A Turn failed:", error);
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
      if (!there()) console.log("A Turn ended after its client left.");
      if ("messages" in result) send("done", result);
      else send("error", { status: result.status, ...result.body });
      if (there()) controller.close();
    },
    cancel() {
      gone = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
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
}) {
  const saves = saveStore(options.savesDir);
  const turns = liveTurns();
  const { settings } = options;
  // Held here, not in Settings, as it's only how the last job went. It's safe to show, unlike the log.
  // shortcut: a restart clears it and an open Settings screen doesn't update, poll or store it if players miss failures.
  let workflowProblem = "";
  const local = comfyImages(settings, undefined, (problem) => (workflowProblem = problem));
  const images = imagePipeline(saves, { openrouter: options.imageAdapter, local }, settings);
  const engine = { ...options, images };
  // Held here until Begin because a Save holds it all at once, and so that the client never holds the secrets.
  // shortcut: an abandoned world and its images stay until the app restarts, evict them if that ever adds up.
  const worlds = new Map<string, World & WorldChoices & WorldPc & { sheet: Awaited<ReturnType<typeof pcSheet>> }>();
  // By the id a form or its world goes by, as these can be drawn before either a world or a Save exists. The form's text is safe in its tab if a restart loses them.
  const held: Record<ImageKind, Map<string, { drawn: Promise<DrawnImage>; artStyle: string; stop: AbortController }>> = {
    cover: new Map(),
    portrait: new Map(),
  };

  /** Replaces any unfinished image, and never rejects: a failure falls back on `before`, so a failed Redraw leaves the old image. */
  function drawHeld(kind: ImageKind, id: string, prompt: string, artStyle: string, before: DrawnImage | Promise<DrawnImage>) {
    held[kind].get(id)?.stop.abort();
    const stop = new AbortController();
    const drawn = images.drawEarly(kind, prompt, artStyle, stop.signal).then(
      (bytes): DrawnImage => ({ prompt, bytes: bytes as Uint8Array<ArrayBuffer> | undefined }),
      async (error: unknown): Promise<DrawnImage> => {
        if (stop.signal.aborted) return before;
        console.error(error);
        return { ...(await before), failure: shownFailure(error) };
      },
    );
    held[kind].set(id, { drawn, artStyle, stop });
    return drawn;
  }

  /** In the background, so a slow image never holds up the world. An image drawn or drawing stays, and one that came to nothing gets another try. */
  function drawIfMissing(kind: ImageKind, id: string, prompt: string, artStyle: string) {
    const image = held[kind].get(id);
    if (!image) return void drawHeld(kind, id, prompt, artStyle, { prompt });
    void image.drawn.then(({ bytes }) => {
      if (!bytes && held[kind].get(id) === image) drawHeld(kind, id, prompt, artStyle, { prompt });
    });
  }

  function drawWorldImages(id: string, overview: string, { title, theme, artStyle = "" }: WorldChoices) {
    drawIfMissing("cover", id, coverPrompt({ title, theme, world: overview }), artStyle);
    const { pc, sheet } = worlds.get(id)!;
    const portrait = images.pcPortraitPrompt(pc, sheet.inventory.wearing);
    if (portrait) drawIfMissing("portrait", id, portrait, artStyle);
  }

  // Answers once the image is done, so an img tag can simply wait for it.
  const heldImage = async (kind: ImageKind, id: string) => {
    const bytes = (await held[kind].get(id)?.drawn)?.bytes;
    return bytes ? imageResponse(bytes) : Response.json({ error: `This world has no ${kind}` }, { status: 404 });
  };

  // Answers when the Redraw is done, and the Begin that may come first takes whichever image wins.
  const redrawHeld = async (kind: ImageKind, id: string, req: Request) => {
    const { prompt, artStyle } = await parseBody(req, HeldRedrawRequest);
    const image = held[kind].get(id);
    if (!image) throw new WorldNotFound();
    if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
    const { failure } = await drawHeld(kind, id, prompt, artStyle ?? image.artStyle, image.drawn);
    return Response.json(failure ? { error: failure } : {}, { status: failure ? 502 : 200 });
  };

  // Answers once the image is done, like the image.
  const heldDetails = async (kind: ImageKind, id: string) => {
    const image = await held[kind].get(id)?.drawn;
    if (!image) throw new WorldNotFound();
    const { prompt, bytes, failure = "" } = image;
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
      textApiKey,
      modelInstructions,
      imageProvider,
      imageModel,
      imageApiKey,
      imagesEnabled,
      comfyUrl,
      comfyFamily,
      comfySdBase,
      imageResolution,
      comfyCheckpoint,
      comfyDiffusionModel,
      comfyTextEncoder,
      comfyVae,
      comfyLoras,
      comfyMode,
      comfyWorkflow,
      chatStyle,
      fontSize,
      theme,
    } = settings.read();
    return {
      textBaseUrl,
      textModel,
      hasTextApiKey: textApiKey !== "",
      modelInstructions,
      imageProvider,
      imageModel,
      hasImageApiKey: imageApiKey !== "",
      imagesEnabled,
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
      comfyMode,
      comfyWorkflow,
      workflowProblem,
      chatStyle,
      fontSize,
      theme,
    };
  };

  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    // A Turn can stay silent past Bun's default, which would drop the client while the Turn went on to commit.
    idleTimeout: 0,
    // Bun's default of 128 MiB is less than a Save with images. It answers 413 itself past this, before any route runs.
    maxRequestBodySize: MAX_IMPORT_BYTES + 1,
    routes: {
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
          return Response.json(publicSettings());
        },
      },
      // Only ever the saved server, so a key can't reach an address that is still being typed.
      "/settings/text-models": {
        GET: async (req) => Response.json({ models: await textModels(settings, req.signal) }),
      },
      // The prompt and Model Instructions alone, with no schema, so a failure points at the model and not at the game.
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
            console.error(error);
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
            console.error(error);
            // The adapter's messages are written to be shown, but a failed connection is Bun's own, which has a `code`.
            const { code, message } = error as Error & { code?: string };
            return Response.json({ error: code ? "ComfyUI can't be reached at this address. Make sure it's running." : message }, { status: 502 });
          }
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
          const prompt =
            ask.kind === "cover"
              ? coverPrompt({ title: ask.title, theme: ask.theme, world: ask.worldBrief })
              : images.pcPortraitPrompt({ name: ask.name, physicalTraits: ask.physicalTraits }, []);
          drawHeld(ask.kind, id, prompt, artStyle, { prompt });
          return Response.json({ id }, { status: 201 });
        },
      },
      "/worlds/:id/begin": {
        POST: async (req) => {
          const { artStyle } = await parseBody(req, ArtStyleRequest);
          const world = worlds.get(req.params.id);
          if (!world) throw new WorldNotFound();
          const { title, worldBrief, startingHook, pc, worldBible, worldRules, plotThreads, sheet } = world;
          const opening = { worldBible, worldRules, plotThreads, ...sheet };
          const id = saves.create({ title, worldBrief, startingHook, pc, artStyle, opening });
          worlds.delete(req.params.id);
          images.saveCreated(id, held.portrait.get(req.params.id)?.drawn);
          // Often still drawing. The Save may be gone by the time it lands, and a story without a cover loses nothing.
          held.cover.get(req.params.id)?.drawn.then(({ bytes, prompt }) => bytes && saves.setCover(id, bytes, prompt)).catch(console.error);
          held.cover.delete(req.params.id);
          held.portrait.delete(req.params.id);
          return Response.json({ id }, { status: 201 });
        },
      },
      "/worlds/:id/cover": {
        GET: (req) => heldImage("cover", req.params.id),
        POST: (req) => redrawHeld("cover", req.params.id, req),
      },
      "/worlds/:id/cover/details": {
        GET: (req) => heldDetails("cover", req.params.id),
      },
      "/worlds/:id/portrait": {
        GET: (req) => heldImage("portrait", req.params.id),
        POST: (req) => redrawHeld("portrait", req.params.id, req),
      },
      "/worlds/:id/portrait/details": {
        GET: (req) => heldDetails("portrait", req.params.id),
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
          images.forget(req.params.id, -1);
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
          // shortcut: the summary and facts are Narrator free text, kept clean only by its prompt, screen them if models leak.
          const { summary, pcKnown, scene } = saves.latestState(req.params.id);
          return Response.json({
            summary,
            facts: pcKnown.facts,
            npcs: pcKnown.npcs,
            npcSummaries: pcKnown.summaries ?? {},
            // Those in the scene, then the latest met. The filter keeps a visible NPC the PC doesn't know yet hidden.
            recentNpcs: [...new Set([...scene.visibleCast.filter((name) => pcKnown.npcs.includes(name)), ...pcKnown.npcs.toReversed()])],
            portraits: knownPortraits(req.params.id),
            fullLog: saves.messages(req.params.id),
          });
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
            const update = await changeWorld(options, saves.latestState(id), change, req.signal);
            if (saves.latestMessageId(id) !== basedOn) throw new StaleTurn();
            saves.addEdit(id, { edit: "world", update });
            // Counts only, so that the log never repeats the world.
            console.log(
              `World Change applied: ${JSON.stringify({
                lore: update.lore_entries.length,
                removed: update.removed_lore.length,
                rules: update.world_rules.length,
                threads: update.plot_threads.length,
              })}`,
            );
            return Response.json({});
          } catch (error) {
            if (!(error instanceof TurnFailed)) throw error;
            // Not `errorResponse`, which logs the cause, and a provider's can echo the prompt.
            console.error(`A World Change failed (${error.failure}): ${error.message}`);
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
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), input), (emit) =>
            playTurn(saves, engine, id, input, NEVER, emit),
          );
        },
      },
      "/saves/:id/opening": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), ""), (emit) =>
            playOpening(saves, engine, id, NEVER, emit),
          );
        },
      },
      "/saves/:id/turn": {
        GET: (req) => Response.json(turns.status(req.params.id)),
      },
      "/saves/:id/decide": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id } = req.params;
          const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
          return Response.json({ text: await decideForPc(options, story, req.signal) });
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
          const { id } = req.params;
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          turns.assertIdle(id);
          const messageId = saves.latestMessageId(id);
          if (messageId === 0) return Response.json({ error: "There's no story to draw from yet." }, { status: 409 });
          const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
          const style = promptStyle(settings.read());
          // Only those in the Scene, so a mark can't put anyone else's stored looks in a prompt the player reads.
          const moment = { location: story.state.scene.location, npcs: visibleNpcs(story.state), wearing: story.state.inventory.wearing };
          images.drawRequested(id, messageId, words, moment, (signal) => writeImagePrompt(options, story, words, style, signal));
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
            kind === "cover" ? "Cover" : kind === "portrait" ? (npc ?? pc.name) : caption;
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
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), feedback, Number(messageId)), (emit) =>
            replaceResponse(saves, engine, id, Number(messageId), feedback, NEVER, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/regenerate": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id, messageId } = req.params;
          return turnResponse(req, turns.begin(id, saves.latestMessageId(id), "", Number(messageId)), (emit) =>
            replaceResponse(saves, engine, id, Number(messageId), undefined, NEVER, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/revert": {
        GET: (req) => Response.json(saves.revertPreview(req.params.id, Number(req.params.messageId))),
        POST: async (req) => {
          await parseBody(req, NoFields);
          const deleted = saves.revert(req.params.id, Number(req.params.messageId));
          images.forget(req.params.id, Number(req.params.messageId));
          return Response.json(deleted);
        },
      },
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error: errorResponse,
  });
}
