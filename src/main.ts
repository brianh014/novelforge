import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { openRouterImages } from "./image-adapter";
import { defaultLevelFor, log, startLog } from "./logger";
import { startServer } from "./rest-api";
import { settingsStore } from "./settings-store";
import { textProvider } from "./text-provider";

// Under `bun run`, execPath is Bun itself, so keep dev Saves in the project rather than beside Bun.
const isCompiled = basename(process.execPath, ".exe") !== "bun";
const appDir = isCompiled ? dirname(process.execPath) : process.cwd();

startLog(defaultLevelFor(isCompiled), join(appDir, "logs"));

const settings = settingsStore(join(appDir, "settings.json"));

const server = startServer({
  savesDir: join(appDir, "Saves"),
  settings,
  textProvider: textProvider(settings),
  imageAdapter: openRouterImages(settings, "https://openrouter.ai/api/v1"),
  dice: () => randomInt(1, 21),
  nearMissMargin: z.coerce.number().int().min(0).parse(process.env.NEAR_MISS_MARGIN ?? 2),
  port: Number(process.env.PORT ?? 4600),
  // shortcut: anyone on the network can play, change Settings and spend the saved keys, add accounts if the app leaves a trusted LAN.
  hostname: process.env.HOST ?? "0.0.0.0",
});

// A listening address of 0.0.0.0 is no use in a browser.
log.startup(`NovelForge is running at ${server.url.href.replace("0.0.0.0", "127.0.0.1")}`);
if (server.hostname === "0.0.0.0") {
  for (const address of Object.values(networkInterfaces()).flat()) {
    if (address?.family === "IPv4" && !address.internal) log.startup(`On your network: http://${address.address}:${server.port}/`);
  }
}
