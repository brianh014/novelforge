import { z } from "zod";
import { SaveNotFound, saveStore } from "./save-store";
import { NarratorError, playTurn, type TextProvider } from "./turn-engine";

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: z.object({ name: z.string().min(1) }),
});

const NewTurnRequest = z.object({ input: z.string().min(1) });

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
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error(error) {
      if (error instanceof z.ZodError) return Response.json({ error: z.prettifyError(error) }, { status: 400 });
      if (error instanceof SaveNotFound) return Response.json({ error: "Save not found" }, { status: 404 });
      if (error instanceof NarratorError) {
        console.error(error);
        return Response.json({ error: error.message }, { status: 502 });
      }
      console.error(error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    },
  });
}
