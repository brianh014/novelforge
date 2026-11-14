import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { imageModelLists } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { tempFolder } from "./support";

const never = new AbortController().signal;
let stop = () => {};
let folder: ReturnType<typeof tempFolder>;
let settings: ReturnType<typeof settingsStore>;

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
});

afterEach(() => {
  stop();
  folder.remove();
});

const ok = () => Response.json({});

/** Stand-ins for each provider's catalog, recording the key each was sent. */
function catalogs({ openRouter = ok, wiro = ok, google = ok, nanoGpt = ok }: Partial<Record<"openRouter" | "wiro" | "google" | "nanoGpt", () => Response>>) {
  const keys: Record<string, string | null> = {};
  const server = Bun.serve({
    port: 0,
    routes: {
      "/or/images/models": (req) => {
        keys.openRouter = req.headers.get("authorization");
        return openRouter();
      },
      "/wiro/Tool/List": async (req) => {
        keys.wiro = req.headers.get("x-api-key");
        expect((await req.json()).categories).toEqual(["text-to-image"]);
        return wiro();
      },
      "/nano/images/models": (req) => {
        keys.nanoGpt = req.headers.get("authorization");
        return nanoGpt();
      },
      "/google/models": (req) => {
        keys.google = req.headers.get("x-goog-api-key");
        return google();
      },
    },
  });
  stop = () => server.stop(true);
  const at = (path: string) => new URL(path, server.url).href;
  return { keys, list: imageModelLists(settings, { openRouter: at("/or"), wiro: at("/wiro"), google: at("/google"), nanoGpt: at("/nano") }) };
}

test("OpenRouter's and Wiro's catalogs list their models by the id the Image model field takes, with no key sent", async () => {
  settings.update({ imageApiKey: "image-key-value" });
  const { keys, list } = catalogs({
    openRouter: () => Response.json({ data: [{ id: "bytedance/seedream-5.5" }, { id: 7 }] }),
    wiro: () => Response.json({ tool: [{ cleanslugowner: "bytedance", cleanslugproject: "seedream-5-5" }, { cleanslugowner: "broken" }] }),
  });

  expect(await list("openrouter", never)).toEqual(["bytedance/seedream-5.5"]);
  expect(await list("wiro", never)).toEqual(["bytedance/seedream-5-5"]);
  expect(keys).toEqual({ openRouter: null, wiro: null });
});

test("NanoGPT's public catalog lists its image models with no key sent", async () => {
  settings.update({ imageApiKey: "image-key-value" });
  const { keys, list } = catalogs({ nanoGpt: () => Response.json({ object: "list", data: [{ id: "bytedance/seedream-v5.5" }, { id: "nano-banana-2.1" }] }) });

  expect(await list("nanogpt", never)).toEqual(["bytedance/seedream-v5.5", "nano-banana-2.1"]);
  expect(keys).toEqual({ nanoGpt: null });
});

test("a catalog that fails or answers nonsense lists nothing", async () => {
  const { list } = catalogs({ openRouter: () => new Response("down", { status: 503 }), wiro: () => new Response("not json") });

  expect(await list("openrouter", never)).toEqual([]);
  expect(await list("wiro", never)).toEqual([]);
});

const googleModels = () =>
  Response.json({ models: [{ name: "models/gemini-3.8-flash" }, { name: "models/gemini-nano-banana-2.1" }, { name: "models/gemini-3.1-flash-image" }] });

test("Google's list, asked with its saved key, keeps only the drawing models", async () => {
  settings.update({ imageProvider: "google", imageApiKey: "google-key-value" });
  const { keys, list } = catalogs({ google: googleModels });

  expect(await list("google", never)).toEqual(["gemini-nano-banana-2.1", "gemini-3.1-flash-image"]);
  expect(keys.google).toBe("google-key-value");
});

test("a key saved for another provider never goes to Google", async () => {
  settings.update({ imageProvider: "openrouter", imageApiKey: "openrouter-key-value" });
  const { keys, list } = catalogs({ google: googleModels });

  expect(await list("google", never)).toEqual([]);
  expect(keys.google).toBeUndefined();
});
