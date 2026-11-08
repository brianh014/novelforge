// One-off: draws the Art Style examples that the wizard bundles.
// Run it yourself, from the project folder, so that the API key stays with you:
//   bun run scripts/draw-style-examples.ts <output folder> [--local flux2|qwen21] [style number...]
// Without --local it draws on the OpenRouter model in Settings. With it, it draws free on local ComfyUI with the models last
// picked in Settings for that family, on its defaults and without LoRAs, in the wording that family gets, on one seed so only the wording differs.
// A style whose file already exists is skipped, so a rerun only pays for what is missing. Delete a file to redraw it.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comfyImages } from "../src/comfyui";
import { switchFamily } from "../src/graph-builder";
import { openRouterImages } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { ART_STYLES, artStyleFor } from "../src/web/art-styles";

const SUBJECT =
  "Waist-up portrait of a hooded traveller looking back over one shoulder, with the face clearly visible. The figure fills only the left third of the frame. The rest of the frame is a wide, detailed view of the place behind them: an old road winding through open hills toward a distant town under a dramatic sky.";
const AVOID = "text, captions, letters, numbers, signatures, watermarks, dice";
const SEED = 4242;

const args = process.argv.slice(2);
const at = args.indexOf("--local");
const family = at === -1 ? null : args.splice(at, 2)[1];
if (family !== null && family !== "flux2" && family !== "qwen21") throw new Error("--local takes flux2 or qwen21");
const [out, ...numbers] = args;
if (!out) throw new Error("Give an output folder");
mkdirSync(out, { recursive: true });

const settings = settingsStore("settings.json");
const draw = family ? comfyImages(localSettings(family)) : openRouterImages(settings, "https://openrouter.ai/api/v1");

/** A throwaway copy of Settings switched to `local`, so the player's own Settings are never touched. */
function localSettings(local: "flux2" | "qwen21") {
  const current = settings.read();
  const copy = settingsStore(join(mkdtempSync(join(tmpdir(), "style-examples-")), "settings.json"));
  copy.update({ ...current, ...switchFamily(current, local), imageProvider: "local", comfyMode: "simple", comfyLoras: [], comfyDefaults: true });
  if (!copy.read().comfyDiffusionModel) throw new Error(`Pick ${local}'s models in Settings first`);
  return copy;
}

const styles = Object.entries(ART_STYLES);
const wanted = numbers.length > 0 ? numbers.map((number) => Number(number) - 1) : styles.keys().toArray();

for (const index of wanted) {
  const [name, description] = styles[index] ?? [];
  if (!name) throw new Error(`No style number ${index + 1}`);
  const path = join(out, `${String(index + 1).padStart(2, "0")}.img`);
  if (existsSync(path)) continue;
  console.log(`Drawing ${index + 1} of ${styles.length}: ${name}`);
  try {
    const style = `${name}: ${description}`;
    // A real Image Prompt opens with the Art Style, as the text model writes it in.
    const payload = family
      ? { prompt: `${artStyleFor(style, family)}\n${SUBJECT}`, negative_prompt: AVOID, aspect_ratio: "16:9", reference_images: [], style_preset: "", seed: SEED }
      : { prompt: SUBJECT, negative_prompt: AVOID, aspect_ratio: "16:9", reference_images: [], style_preset: style };
    writeFileSync(path, await draw(payload, AbortSignal.timeout(5 * 60 * 1000)));
  } catch (error) {
    // Keep going, as the images already paid for are safe and a rerun retries this one.
    console.error(`Failed: ${name}: ${error}`);
  }
}
console.log("Done");
