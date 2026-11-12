// Starts the app with --fake in a fresh folder of its own, so each e2e run begins with no Saves and default Settings.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, ".data");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
process.chdir(dir);
process.argv.push("--fake");
await import("../src/main");
