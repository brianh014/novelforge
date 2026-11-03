import { basename, dirname, join } from "node:path";
import { startServer } from "./rest-api";
import type { TextProvider } from "./turn-engine";

// shortcut: canned narration so the executable can play a Turn, replace with the OpenRouter client in ticket 07.
const placeholderTextProvider: TextProvider = async () =>
  JSON.stringify({ narration: "The Narrator is not connected yet." });

// Under `bun run`, execPath is Bun itself, so keep dev Saves in the project rather than beside Bun.
const isCompiled = basename(process.execPath, ".exe") !== "bun";
const appDir = isCompiled ? dirname(process.execPath) : process.cwd();

const server = startServer({
  savesDir: join(appDir, "Saves"),
  textProvider: placeholderTextProvider,
  port: Number(process.env.PORT ?? 4600),
});

console.log(`NovelForge is running at ${server.url}`);
