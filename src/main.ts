import { randomInt } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { fakeImages, fakeTextProvider } from "./fake-services";
import { googleImages, imageModelLists, nanoGptImages, openRouterImages, wiroImages } from "./image-adapter";
import { defaultLevelFor, log, startLog } from "./logger";
import { startServer } from "./rest-api";
import { settingsStore } from "./settings-store";
import { textProvider } from "./text-provider";
import { isCompiled, removeReplacedPrograms } from "./updater";

// A Mac app can't keep Saves inside itself, which macOS may run from a read-only copy.
const inMacApp = isCompiled && process.execPath.includes(".app/Contents/MacOS/");
// Under `bun run`, keep dev Saves in the project rather than beside Bun.
const appDir = inMacApp ? join(homedir(), "Library", "Application Support", "NovelForge") : isCompiled ? dirname(process.execPath) : process.cwd();

// The download is the app: one player on this computer, a browser that opens by itself, and Quit in the Menu.
// Otherwise it's a server, for the network, until it's stopped. --app tries the app without a build. The Server
// downloads are built as servers (see scripts/build-release.ts), and --server makes any download one.
const serverMode = process.argv.includes("--server") || process.env.NOVELFORGE_MODE === "server";
const app = (isCompiled || process.argv.includes("--app")) && !serverMode;
const port = Number(process.env.PORT ?? 4600);

// --fake swaps the Text Provider and image model for local stand-ins, in a folder of their own, so trying the app
// needs no key, costs nothing, and never touches a real Save or the real Settings.
const fake = process.argv.includes("--fake");
const dataDir = fake ? join(appDir, "fake") : appDir;
mkdirSync(dataDir, { recursive: true });

startLog(defaultLevelFor(isCompiled), join(dataDir, "logs"));
removeReplacedPrograms();

const settingsPath = join(dataDir, "settings.json");
const firstFakeRun = fake && !existsSync(settingsPath);
const settings = settingsStore(settingsPath);
// Filled in once, so play and pictures work at the start, and anything changed in Settings afterwards stays. The
// address is the closed discard port, so model listings come back empty at once instead of reaching a real server.
if (firstFakeRun) settings.update({ textBaseUrl: "http://127.0.0.1:9/v1", textModel: "fake-narrator", imageModel: "fake-images", imageApiKey: "fake-key" });

function openBrowser(url: string) {
  // Tests run the app many times over.
  if (process.env.NO_BROWSER) return;
  const opener = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([opener, url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // A Linux machine with no desktop has no xdg-open, and the server must run on without a browser.
    log.startup(`Couldn't open a browser here, so open ${url} in one yourself`);
  }
}

// Opened again while it runs: show the one running. It asks, as Windows lets a second copy listen on the same port.
if (
  app &&
  (await fetch(`http://127.0.0.1:${port}/settings`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  ))
) {
  openBrowser(`http://127.0.0.1:${port}/`);
  process.exit(0);
}

const server = startServer({
  savesDir: join(dataDir, "Saves"),
  settings,
  textProvider: fake ? fakeTextProvider : textProvider(settings),
  imageAdapter: fake
    ? fakeImages
    : {
        openrouter: openRouterImages(settings, "https://openrouter.ai/api/v1"),
        wiro: wiroImages(settings, "https://api.wiro.ai/v1"),
        google: googleImages(settings, "https://generativelanguage.googleapis.com/v1"),
        nanogpt: nanoGptImages(settings, "https://api.nano-gpt.com/api/v1"),
      },
  imageModels: fake
    ? async () => ["fake-images", "fake/other-images"]
    : imageModelLists(settings, {
        openRouter: "https://openrouter.ai/api/v1",
        wiro: "https://api.wiro.ai/v1",
        google: "https://generativelanguage.googleapis.com/v1beta",
        nanoGpt: "https://api.nano-gpt.com/api/v1",
      }),
  dice: () => randomInt(1, 21),
  nearMissMargin: z.coerce
    .number()
    .int()
    .min(0)
    .parse(process.env.NEAR_MISS_MARGIN ?? 2),
  port,
  // shortcut: anyone on the network can play, change Settings and spend the saved keys, add accounts if the server leaves a trusted LAN.
  hostname: process.env.HOST ?? (app ? "127.0.0.1" : "0.0.0.0"),
  quittable: app ? { idleMs: Number(process.env.IDLE_QUIT_MS ?? 5 * 60_000) } : undefined,
  // Only to try an update against a release served by hand.
  latestRelease: process.env.NOVELFORGE_LATEST_RELEASE,
});

// A listening address of 0.0.0.0 is no use in a browser.
const url = server.url.href.replace("0.0.0.0", "127.0.0.1");
log.startup(`NovelForge is running at ${url}`);
if (app || process.argv.includes("--open")) openBrowser(url);
if (fake) log.startup(`Using fake text and images, with Saves and Settings in ${dataDir}`);
if (server.hostname === "0.0.0.0") {
  for (const address of Object.values(networkInterfaces()).flat()) {
    if (address?.family === "IPv4" && !address.internal) log.startup(`On your network: http://${address.address}:${server.port}/`);
  }
}
