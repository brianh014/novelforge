import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

// Its own port: 4600 is the player's server, 4610 and 4620 are the dev servers.
const PORT = 4630;
// Playwright runs under Node, and Windows' cmd can miss npm's `bun` shim by name, so find the file on PATH.
const bun =
  process.env
    .PATH!.split(delimiter)
    .flatMap((dir) => ["bun.exe", "bun.cmd"].map((file) => join(dir, file)))
    .find(existsSync) ?? "bun";

export default defineConfig({
  testDir: "e2e",
  // One fake server and one Saves folder shared by every test, so files run one at a time.
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  outputDir: "e2e/.results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${bun}" e2e/serve.ts`,
    url: `http://127.0.0.1:${PORT}/settings`,
    // The fake Narrator streams fast here, as nothing watches it type.
    env: { ...(process.env as Record<string, string>), PORT: String(PORT), HOST: "127.0.0.1", NO_BROWSER: "1", FAKE_STREAM_MS: "1" },
    reuseExistingServer: false,
  },
});
