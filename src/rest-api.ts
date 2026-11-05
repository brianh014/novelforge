import { z } from "zod";
import type { Dice } from "./check-resolver";
import { InvalidWorkflow, parseWorkflow } from "./comfy-workflow";
import { comfyImages, comfyModels, randomSeed } from "./comfyui";
import { chosenModels, drawSteps, localIsSetUp } from "./graph-builder";
import { estimateTokens } from "./lore-activation";
import type { ImageAdapter } from "./image-adapter";
import { coverPrompt, imagePipeline, shownFailure } from "./image-pipeline";
import {
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
import { ContentRefused, playOpening, playTurn, replaceResponse, type TextProvider, TextProviderFailed, TurnFailed, type TurnEvents } from "./turn-engine";
import spa from "./web/index.html";
import { decideForPc, ENHANCE_FIELDS, enhance, fitPc, generateWorld, PC_FIELDS, pickForMe, pickPc, type World, type WorldChoices } from "./world-creation";

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: PcDetails.extend({ name: z.string().trim().min(1) }),
  inventory: z.array(z.string().trim().min(1)).default([]),
  artStyle: z.string().optional(),
  startingHook: z.string().optional(),
  worldId: z.string().optional(),
});

const WorldRequest = z.object({
  title: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1),
  worldBrief: z.string().trim().min(1),
  startingHook: z.string().trim(),
  artStyle: z.string().optional(),
});

const PickRequest = z.object({
  theme: z.string().trim().min(1),
  title: z.string().trim().max(80),
  worldBrief: z.string().trim(),
  startingHook: z.string().trim().optional(),
});

const PcBoxes = z.record(z.enum(PC_FIELDS), z.string().trim());

const PcPickRequest = WorldRequest.extend({ pc: PcBoxes });

// The other boxes may still be empty: Enhance needs only its own.
const EnhanceRequest = z.object({
  field: z.enum(ENHANCE_FIELDS),
  text: z.string().trim().min(1),
  theme: z.string().trim(),
  title: z.string().trim(),
  worldBrief: z.string().trim(),
  startingHook: z.string().trim(),
  pc: PcBoxes.optional(),
});

class WorldNotFound extends Error {}

const IMAGES_OFF = "Images are turned off or not set up in Settings.";

/** A failure falls back on the cover before it, whose prompt stands too. */
type DrawnCover = { prompt: string; bytes?: Uint8Array<ArrayBuffer>; failure?: string };

const NewTurnRequest = z.object({ input: z.string().min(1) });

const NoFields = z.object({});

const RewriteRequest = z.object({ feedback: z.string().trim().min(1) });

const PromptRequest = z.object({ prompt: z.string().trim().min(1) });

const RedrawRequest = PromptRequest.extend({ kind: z.enum(["cover", "portrait", "scene"]), ref: z.number().int().nonnegative() });

const NoteRequest = z.object({ text: z.string().trim().min(1) });

// shortcut: Notes are addressed by position, so a second tab can change the wrong one, give them ids if that ever matters.
function spliceNote(notes: string[], index: string, ...replacement: string[]) {
  const position = Number(index);
  if (notes[position] === undefined) throw new NoteNotFound();
  return notes.toSpliced(position, 1, ...replacement);
}

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
  if (error instanceof WorldNotFound) {
    return Response.json({ error: "This world is no longer held. Go back to your choices and generate it again." }, { status: 404 });
  }
  if (error instanceof StaleTurn) return Response.json({ error: "The story changed during this Turn" }, { status: 409 });
  if (error instanceof TurnFailed) {
    console.error(error);
    const { message, failure, input } = error;
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

/** Answers with the committed Messages, as one JSON body or, if the client asks, as a stream of the Turn. */
async function turnResponse(req: Request, run: (emit?: TurnEvents) => Promise<Message[]>) {
  if (!req.headers.get("accept")?.includes("text/event-stream")) {
    return Response.json({ messages: await run() }, { status: 201 });
  }
  const stream = new ReadableStream({
    async start(controller) {
      // A client that leaves aborts the signal, which stops the Turn, and its stream takes no more events.
      const send = (event: string, data: object) => {
        if (!req.signal.aborted) controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        send("done", { messages: await run(send) });
      } catch (error) {
        // In this log, as the client's copy is gone once the page moves on, and it may repeat the story.
        if (!req.signal.aborted) console.error("A Turn failed:", error);
        const response = errorResponse(error);
        send("error", { status: response.status, ...((await response.json()) as object) });
      }
      if (!req.signal.aborted) controller.close();
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
  const { settings } = options;
  // Held here, not in Settings, as it's only how the last job went. It's safe to show, unlike the log.
  // shortcut: a restart clears it and an open Settings screen doesn't update, poll or store it if players miss failures.
  let workflowProblem = "";
  const local = comfyImages(settings, undefined, (problem) => (workflowProblem = problem));
  const images = imagePipeline(saves, { openrouter: options.imageAdapter, local }, settings);
  const engine = { ...options, images };
  // Held here between the wizard's steps because a Save needs a PC, and so that the client never holds the secrets.
  // shortcut: an abandoned world and its cover stay until the app restarts, evict them if that ever adds up.
  const worlds = new Map<string, World & { title: string }>();
  const covers = new Map<string, { drawn: Promise<DrawnCover>; artStyle: string; stop: AbortController }>();

  /** Replaces any unfinished cover, and never rejects: a failure falls back on `before`, so a failed Redraw leaves the old cover. */
  function drawCover(id: string, prompt: string, artStyle: string, before: DrawnCover | Promise<DrawnCover>) {
    covers.get(id)?.stop.abort();
    const stop = new AbortController();
    const drawn = images.drawCover(prompt, artStyle, stop.signal).then(
      (bytes): DrawnCover => ({ prompt, bytes: bytes as Uint8Array<ArrayBuffer> | undefined }),
      async (error: unknown): Promise<DrawnCover> => {
        if (stop.signal.aborted) return before;
        console.error(error);
        return { ...(await before), failure: shownFailure(error) };
      },
    );
    covers.set(id, { drawn, artStyle, stop });
    return drawn;
  }

  /** In the background, so a slow image never holds up the world, and a regenerated world's cover replaces the unfinished one. */
  function startCover(id: string, { title, theme, artStyle = "" }: WorldChoices, overview: string) {
    const prompt = coverPrompt({ title, theme, overview });
    drawCover(id, prompt, artStyle, { prompt });
  }

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
          const { worldId, inventory, ...save } = await parseBody(req, NewSaveRequest);
          if (worldId === undefined) {
            const id = saves.create(save);
            images.saveCreated(id);
            return Response.json({ id }, { status: 201 });
          }
          const world = worlds.get(worldId);
          if (!world) throw new WorldNotFound();
          const { opening, worldChanged } = await fitPc(options, world, save, inventory, req.signal);
          // shortcut: held until now so a failure can retry, which lets a double submit pay for two fits, lock the world if that happens.
          if (!worlds.has(worldId)) throw new WorldNotFound();
          const id = saves.create({ ...save, opening, title: world.title });
          worlds.delete(worldId);
          images.saveCreated(id);
          // Often still drawing. The Save may be gone by the time it lands, and a story without a cover loses nothing.
          covers.get(worldId)?.drawn.then(({ bytes, prompt }) => bytes && saves.setCover(id, bytes, prompt)).catch(console.error);
          covers.delete(worldId);
          return Response.json({ id, worldChanged }, { status: 201 });
        },
      },
      "/worlds": {
        POST: async (req) => {
          const choices = await parseBody(req, WorldRequest);
          const { overview, world } = await generateWorld(options, choices, req.signal);
          const id = crypto.randomUUID();
          worlds.set(id, { ...world, title: choices.title });
          startCover(id, choices, overview);
          return Response.json({ id, overview }, { status: 201 });
        },
      },
      "/worlds/:id/cover": {
        // Answers once the cover is done, so an img tag can simply wait for it.
        GET: async (req) => {
          const bytes = (await covers.get(req.params.id)?.drawn)?.bytes;
          return bytes ? imageResponse(bytes) : Response.json({ error: "This world has no cover" }, { status: 404 });
        },
        // Answers when the Redraw is done, and the Accept that may come first takes whichever cover wins.
        POST: async (req) => {
          const { id } = req.params;
          const { prompt } = await parseBody(req, PromptRequest);
          const cover = covers.get(id);
          if (!cover) throw new WorldNotFound();
          if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
          const { failure } = await drawCover(id, prompt, cover.artStyle, cover.drawn);
          return Response.json(failure ? { error: failure } : {}, { status: failure ? 502 : 200 });
        },
      },
      "/worlds/:id/cover/details": {
        // Answers once the cover is done, like the image.
        GET: async (req) => {
          const cover = await covers.get(req.params.id)?.drawn;
          if (!cover) throw new WorldNotFound();
          const { prompt, bytes, failure = "" } = cover;
          return Response.json({ prompt, hasCover: bytes !== undefined, failure, canRedraw: images.ready() });
        },
      },
      "/worlds/pick": {
        POST: async (req) => Response.json(await pickForMe(options, await parseBody(req, PickRequest), req.signal)),
      },
      "/enhance": {
        POST: async (req) => Response.json({ text: await enhance(options, await parseBody(req, EnhanceRequest), req.signal) }),
      },
      "/pc/pick": {
        POST: async (req) => Response.json(await pickPc(options, await parseBody(req, PcPickRequest), req.signal)),
      },
      "/worlds/:id/regenerate": {
        POST: async (req) => {
          const { id } = req.params;
          const choices = await parseBody(req, WorldRequest);
          if (!worlds.has(id)) throw new WorldNotFound();
          const { overview, world } = await generateWorld(options, choices, req.signal);
          worlds.set(id, { ...world, title: choices.title });
          startCover(id, choices, overview);
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
      "/saves/:id/duplicate": {
        POST: async (req) => {
          const { fromMessage } = await parseBody(req, DuplicateRequest);
          return Response.json({ id: saves.duplicate(req.params.id, fromMessage) }, { status: 201 });
        },
      },
      "/saves/:id/turns": {
        POST: async (req) => {
          const { input } = await parseBody(req, NewTurnRequest);
          return turnResponse(req, (emit) => playTurn(saves, engine, req.params.id, input, req.signal, emit));
        },
      },
      "/saves/:id/opening": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          return turnResponse(req, (emit) => playOpening(saves, engine, req.params.id, req.signal, emit));
        },
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
          return turnResponse(req, (emit) =>
            replaceResponse(saves, engine, id, Number(messageId), feedback, req.signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/regenerate": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id, messageId } = req.params;
          return turnResponse(req, (emit) =>
            replaceResponse(saves, engine, id, Number(messageId), undefined, req.signal, emit),
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
