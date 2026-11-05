import type { ImagePayload } from "./image-adapter";
import type { SettingsStore } from "./settings-store";

type Settings = ReturnType<SettingsStore["read"]>;
export type GraphChoices = Pick<
  Settings,
  "comfyFamily" | "comfySdBase" | "comfyCheckpoint" | "comfyDiffusionModel" | "comfyTextEncoder" | "comfyVae" | "comfyLoras"
>;
/** `references` are the names ComfyUI gave the uploaded images, in the order of `usableReferences`. */
export type GraphRequest = Omit<ImagePayload, "reference_images"> & { references: string[]; seed: number };
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

type Link = [node: string, output: number];
type Add = (classType: string, inputs: Record<string, unknown>) => Link;

// ComfyUI's FLUX.2 page gives this as the most references the model keeps consistent.
const MOST_FLUX2_REFERENCES = 10;

// The output side of a square image each base is trained for.
const SQUARE = { sd15: 512, sdxl: 1024, flux2: 1024 };

// Keeps the previous Scene's layout and palette but leaves room for what has changed in it.
const IMG2IMG_DENOISE = 0.65;

// shortcut: a model is only known by its filename, so a renamed Klein 9B draws at 20 steps, add a setting if that matters.
const fluxSteps = (model: string) => (/klein.*9b/i.test(model) && !/base/i.test(model) ? 8 : 20);

/** What a family needs chosen before it can draw. */
export const chosenModels = (choices: GraphChoices) =>
  choices.comfyFamily === "flux2"
    ? [choices.comfyDiffusionModel, choices.comfyTextEncoder, choices.comfyVae]
    : [choices.comfyCheckpoint];

/** Whether Local has what it needs to draw. A workflow brings its own models. */
export const localIsSetUp = (choices: GraphChoices & Pick<Settings, "comfyMode" | "comfyWorkflow">) =>
  choices.comfyMode === "advanced" ? choices.comfyWorkflow !== "" : chosenModels(choices).every(Boolean);

/** The references a family can use, in the payload's order of priority. */
export function usableReferences({ comfyFamily }: GraphChoices, references: ImagePayload["reference_images"]) {
  return comfyFamily === "flux2"
    ? references.slice(0, MOST_FLUX2_REFERENCES)
    : references.filter(({ role }) => role === "previous_scene").slice(0, 1);
}

/** The same area as the square at any aspect ratio, in multiples of 16, which suits every family's latent. */
export function dimensions(aspectRatio: string, square: number) {
  const [wide = 1, tall = 1] = aspectRatio.split(":").map(Number);
  const snapped = (side: number) => Math.round(side / 16) * 16;
  return { width: snapped(square * Math.sqrt(wide / tall)), height: snapped(square * Math.sqrt(tall / wide)) };
}

function sdImage(add: Add, choices: GraphChoices, request: GraphRequest, text: string) {
  const checkpoint = add("CheckpointLoaderSimple", { ckpt_name: choices.comfyCheckpoint });
  const vae: Link = [checkpoint[0], 2];
  let model = checkpoint;
  let clip: Link = [checkpoint[0], 1];
  for (const { name, strength } of choices.comfyLoras) {
    const lora = add("LoraLoader", {
      model,
      clip,
      lora_name: name,
      strength_model: strength,
      strength_clip: strength,
    });
    model = lora;
    clip = [lora[0], 1];
  }

  const size = dimensions(request.aspect_ratio, SQUARE[choices.comfySdBase]);
  const [previous] = request.references;
  const latent_image = previous
    ? add("VAEEncode", {
        pixels: add("ImageScale", {
          image: add("LoadImage", { image: previous }),
          upscale_method: "lanczos",
          ...size,
          crop: "center",
        }),
        vae,
      })
    : add("EmptyLatentImage", { ...size, batch_size: 1 });

  const samples = add("KSampler", {
    model,
    positive: add("CLIPTextEncode", { text, clip }),
    negative: add("CLIPTextEncode", { text: request.negative_prompt ?? "", clip }),
    latent_image,
    seed: request.seed,
    steps: 25,
    cfg: 7,
    sampler_name: "dpmpp_2m",
    scheduler: "karras",
    denoise: previous ? IMG2IMG_DENOISE : 1,
  });
  return add("VAEDecode", { samples, vae });
}

/** ComfyUI's own FLUX.2 Dev template, with its reference step repeated for each reference. */
function flux2Image(add: Add, choices: GraphChoices, request: GraphRequest, text: string) {
  let model = add("UNETLoader", { unet_name: choices.comfyDiffusionModel, weight_dtype: "default" });
  for (const { name, strength } of choices.comfyLoras) {
    model = add("LoraLoaderModelOnly", { model, lora_name: name, strength_model: strength });
  }
  const clip = add("CLIPLoader", { clip_name: choices.comfyTextEncoder, type: "flux2", device: "default" });
  const vae = add("VAELoader", { vae_name: choices.comfyVae });

  let conditioning = add("FluxGuidance", { conditioning: add("CLIPTextEncode", { text, clip }), guidance: 4 });
  for (const image of request.references) {
    const pixels = add("ImageScaleToTotalPixels", {
      image: add("LoadImage", { image }),
      upscale_method: "lanczos",
      megapixels: 1,
      resolution_steps: 1,
    });
    conditioning = add("ReferenceLatent", { conditioning, latent: add("VAEEncode", { pixels, vae }) });
  }

  const size = dimensions(request.aspect_ratio, SQUARE.flux2);
  const samples = add("SamplerCustomAdvanced", {
    noise: add("RandomNoise", { noise_seed: request.seed }),
    guider: add("BasicGuider", { model, conditioning }),
    sampler: add("KSamplerSelect", { sampler_name: "euler" }),
    sigmas: add("Flux2Scheduler", { steps: fluxSteps(choices.comfyDiffusionModel), ...size }),
    latent_image: add("EmptyFlux2LatentImage", { ...size, batch_size: 1 }),
  });
  return add("VAEDecode", { samples, vae });
}

/** Turns the player's choices and one image request into the graph ComfyUI's /prompt takes. It never touches a server. */
export function buildGraph(choices: GraphChoices, request: GraphRequest) {
  const graph: Graph = {};
  const add: Add = (class_type, inputs) => {
    const id = String(Object.keys(graph).length + 1);
    graph[id] = { class_type, inputs };
    return [id, 0];
  };

  const triggerWords = choices.comfyLoras.map(({ triggerWords }) => triggerWords.trim()).filter(Boolean).join(", ");
  const text = [triggerWords, request.style_preset, request.prompt].filter(Boolean).join("\n");
  const draw = choices.comfyFamily === "flux2" ? flux2Image : sdImage;
  // Preview, not Save: the Save keeps the image, so it shouldn't also pile up in the player's ComfyUI output folder.
  add("PreviewImage", { images: draw(add, choices, request, text) });
  return graph;
}
