// One-off: draws the Art Style examples that the wizard bundles, on the image model in Settings.
// Run it yourself, from the project folder, so that the API key stays with you:
//   bun run scripts/draw-style-examples.ts <output folder> [style number...]
// A style whose file already exists is skipped, so a rerun only pays for what is missing. Delete a file to redraw it.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRouterImages } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { ART_STYLES } from "../src/web/art-styles";

const SUBJECT =
  "Waist-up portrait of a hooded traveller looking back over one shoulder, with the face clearly visible. The figure fills only the left third of the frame. The rest of the frame is a wide, detailed view of the place behind them: an old road winding through open hills toward a distant town under a dramatic sky.";
const AVOID = "text, captions, letters, numbers, signatures, watermarks, dice";

const [out, ...numbers] = process.argv.slice(2);
if (!out) throw new Error("Give an output folder");
mkdirSync(out, { recursive: true });

const settings = settingsStore("settings.json");
const draw = openRouterImages(settings, "https://openrouter.ai/api/v1");

const styles = Object.entries(ART_STYLES);
const wanted = numbers.length > 0 ? numbers.map((number) => Number(number) - 1) : styles.keys().toArray();

for (const index of wanted) {
  const [name, description] = styles[index] ?? [];
  if (!name) throw new Error(`No style number ${index + 1}`);
  const path = join(out, `${String(index + 1).padStart(2, "0")}.img`);
  if (existsSync(path)) continue;
  console.log(`Drawing ${index + 1} of ${styles.length}: ${name}`);
  try {
    const payload = { prompt: SUBJECT, negative_prompt: AVOID, aspect_ratio: "16:9", reference_images: [], style_preset: `${name}: ${description}` };
    writeFileSync(path, await draw(payload, AbortSignal.timeout(5 * 60 * 1000)));
  } catch (error) {
    // Keep going, as the images already paid for are safe and a rerun retries this one.
    console.error(`Failed: ${name}: ${error}`);
  }
}
console.log("Done");
