// What the NovelForge shortcut runs (see install-launcher.ts): starts the server and opens it in the browser.
// Extra arguments pass through, so `bun scripts/launch.ts --fake` works too.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// main.ts keeps Saves and Settings in the working folder, which a shortcut can't be trusted to set.
process.chdir(join(import.meta.dir, ".."));
const port = Number(process.env.PORT ?? 4600);

// A stopped bun can keep holding the port on Windows, so free it first, but only from bun.
if (process.platform === "win32") {
  spawnSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } | Where-Object Name -eq 'bun' | Stop-Process -Force`]);
}

try {
  await import("../src/main");
} catch (error) {
  console.error(error);
  prompt("NovelForge could not start. Press Enter to close.");
  process.exit(1);
}

const url = `http://127.0.0.1:${port}/`;
const opener = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
Bun.spawn([opener, url], { stdio: ["ignore", "ignore", "ignore"] });
