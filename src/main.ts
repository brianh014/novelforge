import { randomInt } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { fakeImages, fakeTextProvider } from "./fake-services";
import { openRouterImages } from "./image-adapter";
import { defaultLevelFor, log, startLog } from "./logger";
import { startServer } from "./rest-api";
import { settingsStore } from "./settings-store";
import { textProvider } from "./text-provider";

// Under `bun run`, execPath is Bun itself, so keep dev Saves in the project rather than beside Bun.
const isCompiled = basename(process.execPath, ".exe") !== "bun";
// A Mac app can't keep Saves inside itself, which macOS may run from a read-only copy.
const inMacApp = isCompiled && process.execPath.includes(".app/Contents/MacOS/");
const appDir = inMacApp ? join(homedir(), "Library", "Application Support", "NovelForge") : isCompiled ? dirname(process.execPath) : process.cwd();

// The download is the app: one player on this computer, a browser that opens by itself, and Quit in the Menu.
// Otherwise it's a server, for the network, until it's stopped. --app tries the app without a build.
const app = isCompiled || process.argv.includes("--app");
const port = Number(process.env.PORT ?? 4600);

// --fake swaps the Text Provider and image model for local stand-ins, in a folder of their own, so trying the app
// needs no key, costs nothing, and never touches a real Save or the real Settings.
const fake = process.argv.includes("--fake");
const dataDir = fake ? join(appDir, "fake") : appDir;
mkdirSync(dataDir, { recursive: true });

startLog(defaultLevelFor(isCompiled), join(dataDir, "logs"));

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
  Bun.spawn([opener, url], { stdio: ["ignore", "ignore", "ignore"] });
}

// Opened again while it runs: show the one running. It asks, as Windows lets a second copy listen on the same port.
if (app && (await fetch(`http://127.0.0.1:${port}/settings`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false))) {
  openBrowser(`http://127.0.0.1:${port}/`);
  process.exit(0);
}

const server = startServer({
  savesDir: join(dataDir, "Saves"),
  settings,
  textProvider: fake ? fakeTextProvider : textProvider(settings),
  imageAdapter: fake ? fakeImages : openRouterImages(settings, "https://openrouter.ai/api/v1"),
  dice: () => randomInt(1, 21),
  nearMissMargin: z.coerce.number().int().min(0).parse(process.env.NEAR_MISS_MARGIN ?? 2),
  port,
  // shortcut: anyone on the network can play, change Settings and spend the saved keys, add accounts if the server leaves a trusted LAN.
  hostname: process.env.HOST ?? (app ? "127.0.0.1" : "0.0.0.0"),
  quittable: app,
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
