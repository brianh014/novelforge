import { z } from "zod";
import type { Dice } from "./check-resolver";
import { InvalidWorkflow } from "./comfy-workflow";
import type { ImageAdapter, ImageModelList } from "./image-adapter";
import type { ImagePipeline, PictureWriter } from "./image-pipeline";
import { LONG_TEXT } from "./limits";
import type { liveTurns } from "./live-turns";
import { TurnRunning, WorldChanging } from "./live-turns";
import { errorFields, log, withLogContext } from "./logger";
import {
  EditNotFound,
  imageType,
  InvalidSave,
  MessageNotFound,
  NameTaken,
  NoteNotFound,
  PortraitNotFound,
  type SaveStore,
  SaveNotFound,
  StaleTurn,
} from "./save-store";
import type { SettingsStore } from "./settings-store";
import { type TextProvider, TurnFailed } from "./turn-engine";
import { UpdateFailed } from "./updater";

/** What every route module shares: the request checks, the error answers, and the server's parts. */

export type ServerOptions = {
  savesDir: string;
  textProvider: TextProvider;
  imageAdapter: ImageAdapter;
  /** For Wiro and Google. Without one, that provider draws with `imageAdapter`, as tests do. */
  imageAdapters?: { wiro?: ImageAdapter; google?: ImageAdapter; nanogpt?: ImageAdapter };
  /** For the Image model dropdown. Without it, Settings lists none and keeps the text box. */
  imageModels?: ImageModelList;
  /** Loopback unless the caller opens the app to the network, which has no accounts to protect it. */
  hostname?: string;
  dice: Dice;
  nearMissMargin: number;
  settings: SettingsStore;
  port: number;
  /** How a Cover's or portrait's prompt is written. By default the text model writes it. */
  writePicture?: PictureWriter;
  /**
   * The downloaded app, which the Menu's Quit ends, as does `idleMs` with no page open, since closing the browser
   * leaves nothing else to. A server can't be quit from a page.
   */
  quittable?: { idleMs: number };
  /** Where the newest release is asked for. GitHub's by default; tests serve their own. */
  latestRelease?: string;
};

/** The one of each a server runs on, which every area's routes share. */
export type ServerContext = { options: ServerOptions; saves: SaveStore; turns: ReturnType<typeof liveTurns>; images: ImagePipeline };

/** A table of routes outside `Bun.serve`, typed the same, so each handler still knows its path's params. */
export const routes = <Route extends string>(table: Bun.Serve.Routes<undefined, Route>) => table;

/** A multiline box of the New Story form, which holds at most this much. */
export const longText = z.string().trim().max(LONG_TEXT);

export const someWords = z.string().trim().min(1);
/** The player's own few words for one picture's new prompt, such as "smiling". */
export const Nudge = z.string().trim().max(200).default("");

export const NoFields = z.object({});

export const PromptRequest = z.object({ prompt: z.string().trim().min(1) });

export const ArtStyleRequest = z.object({ artStyle: z.string().max(LONG_TEXT) });

export class WorldNotFound extends Error {}

export class UploadRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** A picture the player chose themselves. Sent as a type no form can send, so other websites need a CORS preflight, like an import. */
export async function uploaded(req: Request) {
  if (req.headers.get("content-type") !== "application/octet-stream") throw new UploadRefused("A picture must be sent as application/octet-stream", 415);
  // Refused before reading, as the server takes bodies up to an import's size.
  // shortcut: a chunked body has no length and is still read whole, up to the import limit; stream it if server mode needs it.
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES) throw new UploadRefused("That picture is over 10 MB.", 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadRefused("That picture is over 10 MB.", 413);
  if (!imageType(bytes)) throw new UploadRefused("That picture isn't a PNG, JPEG or WebP.", 415);
  return bytes;
}

export const IMAGES_OFF = "Images are turned off or not set up in Settings.";

// Requiring JSON also stops other websites posting here, since a cross-site JSON POST needs a CORS preflight.
export async function parseBody<T>(req: Request, schema: z.ZodType<T>) {
  const isJson = req.headers.get("content-type")?.startsWith("application/json");
  return schema.parse(isJson ? await req.json().catch(() => undefined) : undefined);
}

export function errorResponse(error: unknown) {
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
  if (error instanceof NameTaken) return Response.json({ error: "Someone already has that name" }, { status: 409 });
  if (error instanceof WorldNotFound) {
    return Response.json({ error: "This world is no longer held. Go back to your choices and generate it again." }, { status: 404 });
  }
  if (error instanceof UpdateFailed) return Response.json({ error: error.message }, { status: 502 });
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
export const imageResponse = (bytes: Uint8Array<ArrayBuffer>) =>
  new Response(bytes, {
    headers: { "Content-Type": imageType(bytes) ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" },
  });

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export const isLoopback = (hostname: string) => LOOPBACK_HOST.test(hostname) || hostname === "::1";

/**
 * Every route, logged by its pattern as a real path holds ids and could hold anything. Each line a request causes,
 * however long after, names its route and any Save, so a Save id needn't be passed down to everything that logs.
 * `loopback`: only this computer's own names may reach the routes, so a page rebinding its domain to 127.0.0.1 can't read the Saves or spend the keys.
 */
export function logged<Route extends string>(routes: Bun.Serve.Routes<undefined, Route>, loopback: boolean) {
  const wrap = (route: string, method: string, handler: (req: Bun.BunRequest) => Response | Promise<Response>) => (req: Bun.BunRequest) => {
    const { id } = req.params as { id?: string };
    // Not `/worlds/:id`, whose id is a story's before it has a Save, which then gets another.
    const save = route.startsWith("/saves/") && z.uuid().safeParse(id).success ? id : undefined;
    return withLogContext({ route, save }, async () => {
      // shortcut: a server open to the network takes any Host, so rebinding can still reach it there; check against a configured name if that matters.
      if (loopback && !LOOPBACK_HOST.test(req.headers.get("host") ?? "")) return Response.json({ error: "Not found" }, { status: 404 });
      const started = performance.now();
      const response = await Promise.resolve()
        .then(() => handler(req))
        .catch(errorResponse);
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
