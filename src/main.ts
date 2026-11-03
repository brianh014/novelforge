import { randomInt } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { startServer } from "./rest-api";
import { settingsStore } from "./settings-store";
import { textProvider } from "./text-provider";

// Under `bun run`, execPath is Bun itself, so keep dev Saves in the project rather than beside Bun.
const isCompiled = basename(process.execPath, ".exe") !== "bun";
const appDir = isCompiled ? dirname(process.execPath) : process.cwd();

const settings = settingsStore(join(appDir, "settings.json"));

const server = startServer({
  savesDir: join(appDir, "Saves"),
  settings,
  textProvider: textProvider(settings),
  dice: () => randomInt(1, 21),
  nearMissMargin: z.coerce.number().int().min(0).parse(process.env.NEAR_MISS_MARGIN ?? 2),
  port: Number(process.env.PORT ?? 4600),
});

console.log(`NovelForge is running at ${server.url}`);
