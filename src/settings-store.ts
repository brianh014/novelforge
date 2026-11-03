import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const SettingsUpdate = z
  .object({
    textBaseUrl: z.url({ protocol: /^https?$/ }),
    textApiKey: z.string(),
    textModel: z.string(),
    modelInstructions: z.string(),
  })
  .partial();

const defaults = {
  textBaseUrl: "https://openrouter.ai/api/v1",
  textApiKey: "",
  textModel: "",
  modelInstructions: "",
};

export type SettingsStore = ReturnType<typeof settingsStore>;

/** Per-install settings, including API keys. They live in one file outside the Saves folder, so no Save can carry them. */
export function settingsStore(path: string) {
  const read = () =>
    existsSync(path) ? { ...defaults, ...SettingsUpdate.parse(JSON.parse(readFileSync(path, "utf8"))) } : defaults;

  return {
    read,

    update(change: z.infer<typeof SettingsUpdate>) {
      const current = read();
      const next = { ...current, ...change };
      // A key must only ever reach the server it was entered for.
      if (next.textBaseUrl !== current.textBaseUrl && change.textApiKey === undefined) next.textApiKey = "";
      // shortcut: mode does nothing on Windows, so the key has the folder's permissions there, tighten it if Settings ever hold more than local secrets.
      writeFileSync(`${path}.unfinished`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${path}.unfinished`, path);
    },
  };
}
