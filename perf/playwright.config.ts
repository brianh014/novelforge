import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import e2e from "../playwright.config";

// Its own port and Saves folder, so it can run while the e2e specs or a dev server do. Not in CI: timings vary by machine.
const PORT = 4640;

export default defineConfig({
  ...e2e,
  testDir: ".",
  testMatch: "*.perf.ts",
  timeout: 300_000,
  reporter: "list",
  outputDir: ".results",
  use: { ...e2e.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    ...e2e.webServer!,
    // The command names e2e/serve.ts from the repo root.
    cwd: join(import.meta.dirname, ".."),
    url: `http://127.0.0.1:${PORT}/settings`,
    env: {
      ...(e2e.webServer as { env: Record<string, string> }).env,
      PORT: String(PORT),
      // What players run: the downloads and the launcher serve React's production build.
      NODE_ENV: "production",
      DATA_DIR: join(import.meta.dirname, ".data"),
    },
  },
});
