import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { LOG_LEVELS, log } from "./logger";

const Lora = z.object({ name: z.string().min(1), strength: z.number().min(-100).max(100), triggerWords: z.string() });
const Family = z.enum(["sd", "flux2", "qwen21"]);
const Steps = z.number().int().min(1).max(150).nullable();
const Cfg = z.number().min(0).max(30).nullable();
// What the player last chose for a family, so switching back brings it all back.
const FamilyPicks = z.object({
  comfyDiffusionModel: z.string(),
  comfyTextEncoder: z.string(),
  comfyVae: z.string(),
  comfyLoras: z.array(Lora),
  comfySteps: Steps,
  comfyCfg: Cfg,
  // Missing from picks kept before the defaults toggle, so they are optional here.
  comfyDefaults: z.boolean().optional(),
  comfySampler: z.string().optional(),
  comfyScheduler: z.string().optional(),
});
const PicksByFamily = z.partialRecord(Family, FamilyPicks);

export const SettingsUpdate = z
  .object({
    textBaseUrl: z.url({ protocol: /^https?$/ }),
    textApiKey: z.string(),
    textModel: z.string(),
    // OpenRouter only. A named host wins over the routing, which then has nothing left to choose.
    textRouting: z.enum(["price", "throughput", "latency", "default"]),
    textHost: z.string(),
    textHostFallback: z.boolean(),
    modelInstructions: z.string(),
    // Reach only image prompts, as Model Instructions reach only story text.
    imageInstructions: z.string(),
    // Limits on one reply, so a model that never stops can't hang a Turn or run up a bill. The provider stops billing at the token limit.
    textMaxTokens: z.number().int().min(1000).max(200_000),
    // Counted from the first byte, as loading a model can take minutes.
    textReplyMinutes: z.number().positive().max(60),
    // Recent Messages sent in full each Turn. Older ones reach the Narrator as Scene Memories, written in batches of 20, so it can't go below two batches.
    textRecentMessages: z.number().int().min(40).max(400),
    // A Question's answer over this many words is retried. Not below the 80 the prompt asks for.
    answerRejectWords: z.number().int().min(80).max(1000),
    imageProvider: z.enum(["openrouter", "wiro", "local"]),
    imageModel: z.string(),
    imageApiKey: z.string(),
    imagesEnabled: z.boolean(),
    // Only pictures drawn this session open; a load or refresh shows every picture folded.
    openNewImages: z.boolean(),
    // Off, a Turn draws no Scene Image of its own. Pictures the player asks for, and portraits, still come.
    drawScenes: z.boolean(),
    // On, a portrait is drawn again, keeping its face, whenever a Turn changes how that person looks.
    updatePortraits: z.boolean(),
    // By the 1K, 1.5K and 2K that image providers use, each the area of a square that wide. Settings from before name a video size or megapixels.
    imageResolution: z.preprocess(
      (value) => ({ "480p": "1k", "720p": "1k", "1080p": "1.5k", "4k": "2k", "0.5mp": "1k", "1mp": "1k", "2mp": "1.5k" })[value as string] ?? value,
      z.enum(["1k", "1.5k", "2k"]),
    ),
    comfyUrl: z.url({ protocol: /^https?$/ }),
    comfyFamily: Family,
    // A checkpoint file doesn't say which it is, and Settings warns when the resolution is too big for it.
    comfySdBase: z.enum(["sdxl", "sd15"]),
    comfyCheckpoint: z.string(),
    comfyDiffusionModel: z.string(),
    comfyTextEncoder: z.string(),
    comfyVae: z.string(),
    comfyLoras: z.array(Lora),
    // Null draws with the family's own default, so a family switch doesn't keep the old family's number.
    comfySteps: Steps,
    // FLUX.2 runs without CFG, so it ignores this.
    comfyCfg: Cfg,
    // On, the family's own steps, CFG, sampler and schedule are used, and the player's are kept but ignored.
    comfyDefaults: z.boolean(),
    comfySampler: z.string(),
    // Empty is the family's own schedule: Flux2Scheduler for FLUX.2, the Turbo sigmas for Qwen Image 2.1, karras for SD.
    comfyScheduler: z.string(),
    // The picks above are the current family's, and these are the others', kept for when the player switches back.
    comfyFamilyPicks: PicksByFamily,
    comfyMode: z.enum(["simple", "advanced"]),
    // Kept as the player's text and checked when saved, because a bad one here must not stop every read of Settings.
    comfyWorkflow: z.string(),
    // Unloads ComfyUI's models after each picture, so other programs on the same GPU, such as a local text model, get its memory.
    comfyFreeMemory: z.boolean(),
    chatStyle: z.enum(["script", "prose", "bubbles", "stage"]),
    fontSize: z.enum(["small", "medium", "large"]),
    theme: z.enum(["system", "light", "dark"]),
    // Null clears it. Left out of `defaults`, or the first save of anything would pin this build's default for good.
    logLevel: z.enum(LOG_LEVELS).nullable(),
  })
  .partial();

export type SettingsChange = z.infer<typeof SettingsUpdate>;

const defaults = {
  textBaseUrl: "https://openrouter.ai/api/v1",
  textApiKey: "",
  textModel: "",
  textRouting: "price",
  textHost: "",
  textHostFallback: true,
  modelInstructions: "",
  imageInstructions: "",
  // Over twice the longest real reply, reasoning included, so only a runaway reaches it.
  textMaxTokens: 16_000,
  // The slowest real reply so far took five.
  textReplyMinutes: 8,
  textRecentMessages: 80,
  answerRejectWords: 120,
  imageProvider: "openrouter",
  imageModel: "",
  imageApiKey: "",
  imagesEnabled: true,
  openNewImages: true,
  drawScenes: true,
  updatePortraits: false,
  comfyUrl: "http://127.0.0.1:8188",
  comfyFamily: "sd",
  comfySdBase: "sdxl",
  imageResolution: "1k",
  comfyCheckpoint: "",
  comfyDiffusionModel: "",
  comfyTextEncoder: "",
  comfyVae: "",
  comfyLoras: [] as z.infer<typeof Lora>[],
  comfySteps: null,
  comfyCfg: null,
  comfyDefaults: true,
  comfySampler: "",
  comfyScheduler: "",
  comfyFamilyPicks: {} as z.infer<typeof PicksByFamily>,
  comfyMode: "simple",
  comfyWorkflow: "",
  comfyFreeMemory: false,
  chatStyle: "prose",
  fontSize: "medium",
  theme: "system",
} satisfies SettingsChange;

export type SettingsStore = ReturnType<typeof settingsStore>;

/** Per-install settings, including API keys. They live in one file outside the Saves folder, so no Save can carry them. */
export function settingsStore(path: string) {
  const warned = new Set<string>();
  // Field by field, so one bad value falls back to its default instead of breaking every request. A file that isn't
  // JSON still throws, as reading it as empty would let the next save wipe the keys.
  const parse = (raw: unknown) => {
    const fields = z.record(z.string(), z.unknown()).parse(raw);
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      // A field this build doesn't know, from an older one, is dropped quietly, as before. Own keys only, or "constructor" would match.
      if (!Object.hasOwn(SettingsUpdate.shape, key)) continue;
      const result = SettingsUpdate.shape[key as keyof typeof SettingsUpdate.shape].safeParse(value);
      if (result.success) kept[key] = result.data;
      else if (!warned.has(key)) {
        warned.add(key);
        log.warning("settings", "A setting won't read, so its default is used", { field: key });
      }
    }
    // A key must only ever reach the server it was entered for, and that server is no longer known.
    if ("textBaseUrl" in fields && !("textBaseUrl" in kept)) delete kept.textApiKey;
    return kept as SettingsChange;
  };

  const read = () => {
    const stored = parse(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
    // Settings from before the toggle keep a number the player typed by starting with the toggle off.
    const typed = stored.comfySteps != null || stored.comfyCfg != null;
    // The Stage box is no longer offered (its code is kept), so a stored pick of it reads as Prose.
    if (stored.chatStyle === "stage") stored.chatStyle = "prose";
    return { ...defaults, comfyDefaults: !typed, ...stored };
  };

  return {
    read,

    update(change: SettingsChange) {
      const current = read();
      const next = { ...current, ...change };
      // A key must only ever reach the server it was entered for.
      if (next.textBaseUrl !== current.textBaseUrl && change.textApiKey === undefined) next.textApiKey = "";
      if (next.logLevel === null) delete next.logLevel;
      // shortcut: mode does nothing on Windows, so the key has the folder's permissions there, tighten it if Settings ever hold more than local secrets.
      writeFileSync(`${path}.unfinished`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${path}.unfinished`, path);
    },
  };
}
