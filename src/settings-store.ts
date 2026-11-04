import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

const Lora = z.object({ name: z.string().min(1), strength: z.number().min(-100).max(100), triggerWords: z.string() });

export const SettingsUpdate = z
  .object({
    textBaseUrl: z.url({ protocol: /^https?$/ }),
    textApiKey: z.string(),
    textModel: z.string(),
    modelInstructions: z.string(),
    imageProvider: z.enum(["openrouter", "local"]),
    imageModel: z.string(),
    imageApiKey: z.string(),
    imagesEnabled: z.boolean(),
    comfyUrl: z.url({ protocol: /^https?$/ }),
    comfyFamily: z.enum(["sd", "flux2"]),
    // A checkpoint file doesn't say which it is, and each needs its own image size.
    comfySdBase: z.enum(["sdxl", "sd15"]),
    comfyCheckpoint: z.string(),
    comfyDiffusionModel: z.string(),
    comfyTextEncoder: z.string(),
    comfyVae: z.string(),
    comfyLoras: z.array(Lora),
    comfyMode: z.enum(["simple", "advanced"]),
    // Kept as the player's text and checked when saved, because a bad one here must not stop every read of Settings.
    comfyWorkflow: z.string(),
    // shortcut: Prose is the only Chat style that works, add the others in ticket 22.
    chatStyle: z.enum(["prose"]),
    fontSize: z.enum(["small", "medium", "large"]),
  })
  .partial();

export type SettingsChange = z.infer<typeof SettingsUpdate>;

const defaults = {
  textBaseUrl: "https://openrouter.ai/api/v1",
  textApiKey: "",
  textModel: "",
  modelInstructions: "",
  imageProvider: "openrouter",
  imageModel: "",
  imageApiKey: "",
  imagesEnabled: true,
  comfyUrl: "http://127.0.0.1:8188",
  comfyFamily: "sd",
  comfySdBase: "sdxl",
  comfyCheckpoint: "",
  comfyDiffusionModel: "",
  comfyTextEncoder: "",
  comfyVae: "",
  comfyLoras: [] as z.infer<typeof Lora>[],
  comfyMode: "simple",
  comfyWorkflow: "",
  chatStyle: "prose",
  fontSize: "medium",
} satisfies SettingsChange;

export type SettingsStore = ReturnType<typeof settingsStore>;

/** Per-install settings, including API keys. They live in one file outside the Saves folder, so no Save can carry them. */
export function settingsStore(path: string) {
  const read = () =>
    existsSync(path) ? { ...defaults, ...SettingsUpdate.parse(JSON.parse(readFileSync(path, "utf8"))) } : defaults;

  return {
    read,

    update(change: SettingsChange) {
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
