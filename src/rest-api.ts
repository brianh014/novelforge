import { z } from "zod";
import type { Dice } from "./check-resolver";
import { MessageNotFound, SaveNotFound, saveStore, StaleTurn } from "./save-store";
import { type SettingsStore, SettingsUpdate } from "./settings-store";
import { playTurn, type TextProvider, TurnFailed } from "./turn-engine";
import spa from "./web/index.html";

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: z.object({ name: z.string().min(1) }),
});

const NewTurnRequest = z.object({ input: z.string().min(1) });

const RevertRequest = z.object({});

const DuplicateRequest = z.object({ fromMessage: z.number().optional() });

// Requiring JSON also stops other websites posting here, since a cross-site JSON POST needs a CORS preflight.
async function parseBody<T>(req: Request, schema: z.ZodType<T>) {
  const isJson = req.headers.get("content-type")?.startsWith("application/json");
  return schema.parse(isJson ? await req.json().catch(() => undefined) : undefined);
}

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: z.prettifyError(error) }, { status: 400 });
  if (error instanceof SaveNotFound) return Response.json({ error: "Save not found" }, { status: 404 });
  if (error instanceof MessageNotFound) return Response.json({ error: "Message not found" }, { status: 404 });
  if (error instanceof StaleTurn) return Response.json({ error: "The story changed during this Turn" }, { status: 409 });
  if (error instanceof TurnFailed) {
    console.error(error);
    const { message, failure, input } = error;
    return Response.json({ error: message, failure, input }, { status: failure === "refused" ? 422 : 502 });
  }
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
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

  // An allowlist, so the API key can never reach a response.
  const publicSettings = () => {
    const { textBaseUrl, textModel, textApiKey, modelInstructions } = settings.read();
    return { textBaseUrl, textModel, hasTextApiKey: textApiKey !== "", modelInstructions };
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
        POST: async (req) => {
          const id = saves.create(await parseBody(req, NewSaveRequest));
          return Response.json({ id }, { status: 201 });
        },
      },
      "/saves/:id": {
        GET: (req) => {
          // An allowlist, so a secret added to the Save can never reach the player by default.
          const { worldBrief, pc } = saves.read(req.params.id);
          return Response.json({ worldBrief, pc: { name: pc.name } });
        },
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
      "/saves/:id/duplicate": {
        POST: async (req) => {
          const { fromMessage } = await parseBody(req, DuplicateRequest);
          return Response.json({ id: saves.duplicate(req.params.id, fromMessage) }, { status: 201 });
        },
      },
      "/saves/:id/turns": {
        POST: async (req) => {
          const { input } = await parseBody(req, NewTurnRequest);
          if (!req.headers.get("accept")?.includes("text/event-stream")) {
            const messages = await playTurn(saves, options, req.params.id, input, req.signal);
            return Response.json({ messages }, { status: 201 });
          }
          const stream = new ReadableStream({
            async start(controller) {
              // A client that leaves aborts the signal, which stops the Turn, and its stream takes no more events.
              const send = (event: string, data: object) => {
                if (!req.signal.aborted) controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
              };
              try {
                send("done", { messages: await playTurn(saves, options, req.params.id, input, req.signal, send) });
              } catch (error) {
                const response = errorResponse(error);
                send("error", { status: response.status, ...((await response.json()) as object) });
              }
              if (!req.signal.aborted) controller.close();
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
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
      "/saves/:id/messages/:messageId/revert": {
        GET: (req) => Response.json(saves.revertPreview(req.params.id, Number(req.params.messageId))),
        POST: async (req) => {
          await parseBody(req, RevertRequest);
          return Response.json(saves.revert(req.params.id, Number(req.params.messageId)));
        },
      },
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error: errorResponse,
  });
}
