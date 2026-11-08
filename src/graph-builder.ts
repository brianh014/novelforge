import type { ImagePayload } from "./image-adapter";
import type { SettingsStore } from "./settings-store";

type Settings = ReturnType<SettingsStore["read"]>;
export type GraphChoices = Pick<
  Settings,
  "comfyFamily" | "comfySdBase" | "imageResolution" | "comfyCheckpoint" | "comfyDiffusionModel" | "comfyTextEncoder" | "comfyVae" | "comfyLoras"
>;
/** `references` are the names ComfyUI gave the uploaded images, in the order of `usableReferences`. */
export type GraphRequest = Omit<ImagePayload, "reference_images"> & { references: string[]; seed: number };
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

type Link = [node: string, output: number];
type Add = (classType: string, inputs: Record<string, unknown>) => Link;

// ComfyUI's FLUX.2 page gives this as the most references the model keeps consistent.
const MOST_FLUX2_REFERENCES = 10;
// BFL's prompt reference lists Klein 4B and 9B at up to 4.
const MOST_KLEIN_REFERENCES = 4;

// The side of a square with each resolution's pixels, so every shape of image gets the same area.
const SQUARE = { "480p": 640, "720p": 960, "1080p": 1440, "4k": 2880 };

// Keeps the previous Scene's layout and palette but leaves room for what has changed in it.
const IMG2IMG_DENOISE = 0.65;

// shortcut: a model is only known by its filename, so a renamed Klein 9B draws at 20 steps, add a setting if that matters.
const fluxSteps = (model: string) => (/klein.*9b/i.test(model) && !/base/i.test(model) ? 8 : 20);

/** How many steps Simple Mode draws these choices in. */
export const drawSteps = ({ comfyFamily, comfyDiffusionModel }: GraphChoices) =>
  comfyFamily === "flux2" ? fluxSteps(comfyDiffusionModel) : 25;

/** How an Image Prompt is worded. Only Simple Mode knows its family, so OpenRouter and a workflow get prose, which every model can read. */
export type PromptStyle = "prose" | "keywords";
export const promptStyle = ({ imageProvider, comfyMode, comfyFamily }: Pick<Settings, "imageProvider" | "comfyMode" | "comfyFamily">): PromptStyle =>
  imageProvider === "local" && comfyMode === "simple" && comfyFamily === "sd" ? "keywords" : "prose";

/** Whether a portrait is sure to reach the model. OpenRouter's models and a workflow may ignore one, so those need the words. */
export const usesPortraits = ({ imageProvider, comfyMode, comfyFamily }: Pick<Settings, "imageProvider" | "comfyMode" | "comfyFamily">) =>
  imageProvider === "local" && comfyMode === "simple" && comfyFamily === "flux2";

/** What a family needs chosen before it can draw. */
export const chosenModels = (choices: GraphChoices) =>
  choices.comfyFamily === "flux2"
    ? [choices.comfyDiffusionModel, choices.comfyTextEncoder, choices.comfyVae]
    : [choices.comfyCheckpoint];

/** Whether Local has what it needs to draw. A workflow brings its own models. */
export const localIsSetUp = (choices: GraphChoices & Pick<Settings, "comfyMode" | "comfyWorkflow">) =>
  choices.comfyMode === "advanced" ? choices.comfyWorkflow !== "" : chosenModels(choices).every(Boolean);

/** The references a family can use, in the payload's order of priority. */
export function usableReferences({ comfyFamily, comfyDiffusionModel }: GraphChoices, references: ImagePayload["reference_images"]) {
  return comfyFamily === "flux2"
    ? references.slice(0, /klein/i.test(comfyDiffusionModel) ? MOST_KLEIN_REFERENCES : MOST_FLUX2_REFERENCES)
    : references.filter(({ role }) => role === "previous_scene").slice(0, 1);
}

/** The resolution's area at any aspect ratio, in multiples of 16, which suits every family's latent. */
export function dimensions(aspectRatio: string, resolution: GraphChoices["imageResolution"]) {
  const square = SQUARE[resolution];
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

  const size = dimensions(request.aspect_ratio, choices.imageResolution);
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
    steps: drawSteps(choices),
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

  const size = dimensions(request.aspect_ratio, choices.imageResolution);
  const samples = add("SamplerCustomAdvanced", {
    noise: add("RandomNoise", { noise_seed: request.seed }),
    guider: add("BasicGuider", { model, conditioning }),
    sampler: add("KSamplerSelect", { sampler_name: "euler" }),
    sigmas: add("Flux2Scheduler", { steps: drawSteps(choices), ...size }),
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
  // FLUX.2 cuts a long prompt from the end and weighs the start most, so what the image shows goes before how it's drawn.
  const written = choices.comfyFamily === "flux2" ? [request.prompt, request.style_preset] : [request.style_preset, request.prompt];
  const text = [triggerWords, ...written].filter(Boolean).join("\n");
  const draw = choices.comfyFamily === "flux2" ? flux2Image : sdImage;
  // Preview, not Save: the Save keeps the image, so it shouldn't also pile up in the player's ComfyUI output folder.
  add("PreviewImage", { images: draw(add, choices, request, text) });
  return graph;
}
