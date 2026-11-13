import { z } from "zod";
import { comfyImages } from "./comfyui";
import { galleryRoutes } from "./gallery-routes";
import { errorResponse, isLoopback, logged, NoFields, parseBody, type ServerContext, type ServerOptions } from "./http";
import { imagePipeline } from "./image-pipeline";
import { liveTurns } from "./live-turns";
import { errorFields, log, setLogLevel } from "./logger";
import { saveRoutes } from "./save-routes";
import { MAX_IMPORT_BYTES, saveStore } from "./save-store";
import { settingsRoutes } from "./settings-routes";
import { turnRoutes } from "./turn-routes";
import { relaunch, updater } from "./updater";
import spa from "./web/index.html";
import { writePicturePrompt } from "./world-creation";
import { worldRoutes } from "./world-routes";

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

/** One server, its routes put together by area. Each area is its own module, which shares only the Saves, Turns and images. */
export function startServer(options: ServerOptions) {
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
  const workflow = { problem: "" };
  const local = comfyImages(settings, undefined, (problem) => (workflow.problem = problem));
  const images = imagePipeline(
    saves,
    { openrouter: options.imageAdapter, local },
    settings,
    options.writePicture ?? ((ask, style, _template, signal) => writePicturePrompt(options, ask, style, signal)),
  );

  // Requests in flight, a Turn's save among them, finish first.
  const quit = (why: string) => {
    log.startup(`NovelForge is closing: ${why}`);
    void server.stop().finally(() => process.exit(0));
  };
  const updates = updater(options.latestRelease);

  // Pages check in, and the app quits once none has for `idleMs`, after any Turn or picture is done.
  let pageSeen = Date.now();
  if (options.quittable) {
    const { idleMs } = options.quittable;
    const every = Math.min(30_000, idleMs / 3);
    let ticked = Date.now();
    setInterval(() => {
      const now = Date.now();
      // The computer slept, pages and all, so they get the time to check in again.
      if (now - ticked > every * 2) pageSeen = now;
      ticked = now;
      // A request still running, such as a world being built, would lose its work, so it finishes first.
      const working = turns.busy() || images.busy() || server.pendingRequests > 0;
      if (now - pageSeen > idleMs && !working) quit("no page has been open for a while");
    }, every).unref();
  }

  const context: ServerContext = { options, saves, turns, images };

  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    // Not hot reload, whose client copies an uncaught page error's words to the terminal, and they can quote the story.
    development: process.env.NODE_ENV !== "production" && { hmr: false },
    // A Turn can stay silent past Bun's default, which would drop the client while the Turn went on to commit.
    idleTimeout: 0,
    // Bun's default of 128 MiB is less than a Save with images. It answers 413 itself past this, before any route runs.
    maxRequestBodySize: MAX_IMPORT_BYTES + 1,
    routes: logged(
      {
        "/": spa,
        // The download has no window to close, so the Menu's Quit ends it. A server doesn't quit, as everyone on the network shares it.
        "/quit": {
          POST: () => {
            if (!options.quittable) return Response.json({ error: "Not found" }, { status: 404 });
            quit("the player quit");
            return new Response(null, { status: 204 });
          },
        },
        // A new version: whether there is one, and installing it, which restarts the server once this answer is sent.
        "/update": {
          GET: async () => Response.json(await updates.status()),
          POST: async (req) => {
            await parseBody(req, NoFields);
            if (turns.busy() || images.busy()) return Response.json({ error: "Wait for the story and its pictures to finish, then update." }, { status: 409 });
            const installed = await updates.install();
            void server.stop().finally(relaunch);
            return Response.json(installed, { status: 202 });
          },
        },
        "/alive": {
          POST: () => {
            pageSeen = Date.now();
            return new Response(null, { status: 204 });
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
        ...settingsRoutes(context, local, workflow),
        ...worldRoutes(context),
        ...saveRoutes(context),
        ...turnRoutes(context),
        ...galleryRoutes(context),
      },
      isLoopback(options.hostname ?? "127.0.0.1"),
    ),
    fetch: () => {
      log.verbose("http", "No such route");
      return Response.json({ error: "Not found" }, { status: 404 });
    },
    error: errorResponse,
  });
  return server;
}
