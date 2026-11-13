// Starts the app with --fake in a fresh folder of its own, so each run begins with no Saves and default Settings.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// The perf suite passes its own folder, so it can run beside the e2e specs.
const dir = process.env.DATA_DIR ?? join(import.meta.dir, ".data");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
process.chdir(dir);
process.argv.push("--fake");
await import("../src/main");
