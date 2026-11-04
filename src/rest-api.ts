import { z } from "zod";
import type { Dice } from "./check-resolver";
import { InvalidSave, type Message, MessageNotFound, NoteNotFound, PcDetails, SaveNotFound, saveStore, StaleTurn } from "./save-store";
import { type SettingsStore, SettingsUpdate } from "./settings-store";
import { playTurn, replaceResponse, type TextProvider, TurnFailed, type TurnEvents } from "./turn-engine";
import spa from "./web/index.html";
import { fitPc, generateWorld, PC_FIELDS, pickForMe, pickPc, type World } from "./world-creation";

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: PcDetails.extend({ name: z.string().trim().min(1) }),
  inventory: z.array(z.string().trim().min(1)).default([]),
  artStyle: z.string().optional(),
  startingHook: z.string().optional(),
  worldId: z.string().optional(),
});

const WorldRequest = z.object({
  theme: z.string().trim().min(1),
  worldBrief: z.string().trim().min(1),
  startingHook: z.string().trim(),
});

const PickRequest = z.object({
  field: z.enum(["worldBrief", "startingHook"]),
  theme: z.string().trim().min(1),
  worldBrief: z.string().trim(),
});

const PcPickRequest = WorldRequest.extend({ pc: z.record(z.enum(PC_FIELDS), z.string().trim()) });

class WorldNotFound extends Error {}

const NewTurnRequest = z.object({ input: z.string().min(1) });

const NoFields = z.object({});

const RewriteRequest = z.object({ feedback: z.string().trim().min(1) });

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
  if (error instanceof InvalidSave) return Response.json({ error: error.message }, { status: 422 });
  if (error instanceof SaveNotFound) return Response.json({ error: "Save not found" }, { status: 404 });
  if (error instanceof MessageNotFound) return Response.json({ error: "Message not found" }, { status: 404 });
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
  dice: Dice;
  nearMissMargin: number;
  settings: SettingsStore;
  port: number;
}) {
  const saves = saveStore(options.savesDir);
  const { settings } = options;
  // Held here between the wizard's steps because a Save needs a PC, and so that the client never holds the secrets.
  // shortcut: an abandoned world stays until the app restarts, evict them if that ever adds up.
  const worlds = new Map<string, World>();

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
      chatStyle,
      fontSize,
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
      chatStyle,
      fontSize,
    };
  };

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    // A Turn can stay silent past Bun's default, which would drop the client while the Turn went on to commit.
    idleTimeout: 0,
    routes: {
      "/": spa,
      "/settings": {
        GET: () => Response.json(publicSettings()),
        PATCH: async (req) => {
          settings.update(await parseBody(req, SettingsUpdate));
          return Response.json(publicSettings());
        },
      },
      "/saves": {
        GET: () => Response.json({ saves: saves.list() }),
        POST: async (req) => {
          const { worldId, inventory, ...save } = await parseBody(req, NewSaveRequest);
          if (worldId === undefined) return Response.json({ id: saves.create(save) }, { status: 201 });
          const world = worlds.get(worldId);
          if (!world) throw new WorldNotFound();
          const { opening, worldChanged } = await fitPc(options, world, save, inventory, req.signal);
          // shortcut: held until now so a failure can retry, which lets a double submit pay for two fits, lock the world if that happens.
          if (!worlds.has(worldId)) throw new WorldNotFound();
          const id = saves.create({ ...save, opening });
          worlds.delete(worldId);
          return Response.json({ id, worldChanged }, { status: 201 });
        },
      },
      "/worlds": {
        POST: async (req) => {
          const choices = await parseBody(req, WorldRequest);
          const { overview, world } = await generateWorld(options, choices, req.signal);
          const id = crypto.randomUUID();
          worlds.set(id, world);
          return Response.json({ id, overview }, { status: 201 });
        },
      },
      "/worlds/pick": {
        POST: async (req) => {
          const pick = await parseBody(req, PickRequest);
          return Response.json({ text: await pickForMe(options, pick, req.signal) });
        },
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
          worlds.set(id, world);
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
          const { worldBrief, pc, artStyle, startingHook } = saves.read(req.params.id);
          return Response.json({ worldBrief, pc: { name: pc.name }, artStyle, startingHook });
        },
        PATCH: async (req) => {
          const { artStyle } = await parseBody(req, ArtStyleRequest);
          saves.setArtStyle(req.params.id, artStyle);
          return Response.json({ artStyle });
        },
        DELETE: (req) => {
          saves.delete(req.params.id);
          return new Response(null, { status: 204 });
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
          const { summary, pcKnown } = saves.latestState(req.params.id);
          return Response.json({
            summary,
            facts: pcKnown.facts,
            npcs: pcKnown.npcs,
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
          return turnResponse(req, (emit) => playTurn(saves, options, req.params.id, input, req.signal, emit));
        },
      },
      "/saves/:id/messages": {
        GET: (req) => Response.json({ messages: saves.messages(req.params.id) }),
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
            replaceResponse(saves, options, id, Number(messageId), feedback, req.signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/regenerate": {
        POST: async (req) => {
          await parseBody(req, NoFields);
          const { id, messageId } = req.params;
          return turnResponse(req, (emit) =>
            replaceResponse(saves, options, id, Number(messageId), undefined, req.signal, emit),
          );
        },
      },
      "/saves/:id/messages/:messageId/revert": {
        GET: (req) => Response.json(saves.revertPreview(req.params.id, Number(req.params.messageId))),
        POST: async (req) => {
          await parseBody(req, NoFields);
          return Response.json(saves.revert(req.params.id, Number(req.params.messageId)));
        },
      },
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error: errorResponse,
  });
}
