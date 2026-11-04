import { dimensions, type Graph } from "./graph-builder";
import type { ImagePayload } from "./image-adapter";

/** A workflow the player can paste as it is, once it names one of their checkpoints. */
export const WORKFLOW_EXAMPLE = `{
  "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "your_model.safetensors" } },
  "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{art_style}}, {{prompt}}", "clip": ["1", 1] } },
  "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{negative_prompt}}", "clip": ["1", 1] } },
  "4": { "class_type": "EmptyLatentImage", "inputs": { "width": "{{width}}", "height": "{{height}}", "batch_size": 1 } },
  "5": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["1", 0],
      "positive": ["2", 0],
      "negative": ["3", 0],
      "latent_image": ["4", 0],
      "seed": "{{seed}}",
      "steps": 25,
      "cfg": 7,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1
    }
  },
  "6": { "class_type": "VAEDecode", "inputs": { "samples": ["5", 0], "vae": ["1", 2] } },
  "7": { "class_type": "PreviewImage", "inputs": { "images": ["6", 0] } }
}`;

export class InvalidWorkflow extends Error {}

// shortcut: all double braces are ours, so a custom node's own {{...}} syntax is refused, add an escape if a workflow needs one.
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const PAYLOAD_FIELDS = ["prompt", "negative_prompt", "art_style", "aspect_ratio", "width", "height", "seed"];
const REFERENCE = /^(?:has_)?(?:(?:reference|npc)_[1-9]\d*|previous_scene|pc)$/;

// Mid grey and 64 pixels wide, because VAEEncode trims an image to multiples of 8 and would leave nothing of a tiny one.
// Text until it's used, as the browser loads this file for the example and has no Buffer.
const BLANK = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAKUlEQVR42u3MQREAAAwCIKMb3RD77SAA6VEEAoFAIBAIBAKBQCAQfA8G320AeXC6efoAAAAASUVORK5CYII=";

type Values = Record<string, string | number>;

const namesIn = (workflow: Graph) => [
  ...new Set(Object.values(workflow).flatMap(({ inputs }) => [...JSON.stringify(inputs).matchAll(PLACEHOLDER)].map(([, name]) => name!))),
];

/** Every check that needs no ComfyUI. It throws an InvalidWorkflow that says what to fix. */
export function parseWorkflow(text: string) {
  if (!text.trim()) throw new InvalidWorkflow("Paste a workflow, or switch back to Simple Mode.");
  let workflow: unknown;
  try {
    workflow = JSON.parse(text);
  } catch (error) {
    throw new InvalidWorkflow(`This workflow isn't valid JSON: ${(error as Error).message}`);
  }
  if (typeof workflow !== "object" || workflow === null || Array.isArray(workflow) || Object.keys(workflow).length === 0) {
    throw new InvalidWorkflow("This isn't a ComfyUI workflow in API format.");
  }
  if (Array.isArray((workflow as { nodes?: unknown }).nodes)) {
    throw new InvalidWorkflow("This is ComfyUI's UI format. In ComfyUI, use Export (API) and paste that file instead.");
  }
  for (const [id, node] of Object.entries(workflow)) {
    if (typeof node?.class_type !== "string" || typeof node.inputs !== "object" || node.inputs === null) {
      throw new InvalidWorkflow(`Node "${id}" needs a class_type and inputs, so this isn't a workflow in API format.`);
    }
  }

  const names = namesIn(workflow as Graph);
  const unknown = names.filter((name) => !PAYLOAD_FIELDS.includes(name) && !REFERENCE.test(name));
  if (unknown.length > 0) {
    throw new InvalidWorkflow(`Unknown placeholders: ${unknown.map((name) => `{{${name}}}`).join(", ")}`);
  }
  if (!names.includes("prompt")) throw new InvalidWorkflow("This workflow doesn't use {{prompt}}, so its images would ignore the story.");
  return workflow as Graph;
}

/** A slot's image, if this request has one. References arrive with NPCs first, then the previous Scene, then the PC. */
function referenceAt(slot: string, references: ImagePayload["reference_images"]) {
  const [, kind, position] = /^(reference|npc)_(\d+)$/.exec(slot) ?? [];
  if (kind) return references.filter(({ role }) => kind === "reference" || role === "npc")[Number(position) - 1];
  return references.find(({ role }) => role === slot);
}

/** Fills parsed values, never the JSON text, in one pass, so what the Narrator wrote stays one plain string. */
function filled(value: unknown, values: Values): unknown {
  if (typeof value === "string") {
    // A placeholder that is the whole value keeps its type, as ComfyUI wants numbers for sizes and seeds.
    const whole = /^\{\{([^{}]*)\}\}$/.exec(value);
    return whole ? values[whole[1]!] : value.replace(PLACEHOLDER, (_, name: string) => String(values[name]));
  }
  if (Array.isArray(value)) return value.map((item) => filled(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filled(item, values)]));
  }
  return value;
}

/**
 * Turns the player's workflow and one image request into the graph ComfyUI's /prompt takes. Only the slots it names are
 * stored. Portraits and first Scenes have no references, so an empty slot gets the blank image to keep its node valid.
 */
export async function fillWorkflow(
  text: string,
  { prompt, negative_prompt = "", aspect_ratio, reference_images, style_preset }: ImagePayload,
  seed: number,
  store: (image: { bytes: Uint8Array; mediaType: string }) => Promise<string>,
) {
  const workflow = parseWorkflow(text);
  const values: Values = {
    prompt,
    negative_prompt,
    art_style: style_preset,
    aspect_ratio,
    seed,
    ...dimensions(aspect_ratio, 1024),
  };
  await Promise.all(
    namesIn(workflow)
      .filter((name) => !PAYLOAD_FIELDS.includes(name))
      .map(async (name) => {
        const slot = name.replace(/^has_/, "");
        const image = referenceAt(slot, reference_images);
        values[name] = name === slot ? await store(image ?? { bytes: Buffer.from(BLANK, "base64"), mediaType: "image/png" }) : Number(image !== undefined);
      }),
  );
  return Object.fromEntries(
    Object.entries(workflow).map(([id, node]) => [id, { ...node, inputs: filled(node.inputs, values) }]),
  ) as Graph;
}
