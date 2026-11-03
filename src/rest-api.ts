import { z } from "zod";
import { MessageNotFound, SaveNotFound, saveStore, StaleTurn } from "./save-store";
import { playTurn, type TextProvider, TurnFailed } from "./turn-engine";

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

export function startServer(options: { savesDir: string; textProvider: TextProvider; port: number }) {
  const saves = saveStore(options.savesDir);

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    routes: {
      "/saves": {
        POST: async (req) => {
          const id = saves.create(await parseBody(req, NewSaveRequest));
          return Response.json({ id }, { status: 201 });
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
          const messages = await playTurn(saves, options.textProvider, req.params.id, input);
          return Response.json({ messages }, { status: 201 });
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
    error(error) {
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
    },
  });
}
