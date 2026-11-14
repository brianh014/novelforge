import { dimensions } from "./graph-builder";
import type { SettingsStore } from "./settings-store";

/** The shared payload every Image Adapter formats for its backend. The first references are kept when a model takes fewer. */
export type ImagePayload = {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio: string;
  reference_images: { role: "npc" | "previous_scene" | "pc"; bytes: Uint8Array; mediaType: string }[];
  style_preset: string;
  /** Chosen by the adapter when left out. */
  seed?: number;
};

/** Resolves to the image's bytes, which the caller still has to check. Anything it throws is a failed image. */
export type ImageAdapter = (payload: ImagePayload, signal: AbortSignal) => Promise<Uint8Array>;

type Capability = { values?: string[]; max?: number };
type ImageModel = {
  id: string;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: Record<string, Capability>;
};

// The most that POST /images accepts. A model's own limit, where it has one, is its input_references descriptor.
const MOST_REFERENCES = 16;

// The tier each resolution aims for, as OpenRouter's and Wiro's sizes go by 0.5K (512), 1K, 1.5K and 2K.
const TIER_TARGETS = { "0.5k": 500, "1k": 1000, "1.5k": 1500, "2k": 2000 };

// Wiro writes some as 1k. A size that is a ratio or a video size reads as no number, so it is never chosen.
const tierPixels = (tier: string) => (/k$/i.test(tier) ? Number.parseFloat(tier) * 1000 : Number(tier));

/** The size this model lists nearest the resolution, as a tier it doesn't list would be refused. */
function closestTier(tiers: string[] = [], resolution: keyof typeof TIER_TARGETS) {
  const gap = (tier: string) => Math.abs(tierPixels(tier) - TIER_TARGETS[resolution]);
  return tiers.filter((tier) => !Number.isNaN(tierPixels(tier))).toSorted((a, b) => gap(a) - gap(b))[0];
}

// An image can take minutes, but one that never answers must not hold up the Save's next image forever.
const GIVE_UP_MS = 5 * 60 * 1000;

/** `text` with the key taken out, as an image API's error can repeat what it was sent. */
const withoutKey = (key: string, text: string) => (key ? text.replaceAll(key, "[key]") : text);

/** An Image API error that is safe to log. */
const apiError = (key: string, message: string, status: number) => Object.assign(new Error(withoutKey(key, message)), { status });

/** One prompt with the Art Style, and what to avoid unless the model has a field of its own for that. */
const promptWith = ({ prompt, style_preset, negative_prompt }: ImagePayload, avoidElsewhere = false) =>
  [prompt, style_preset, !avoidElsewhere && negative_prompt && `Avoid: ${negative_prompt}.`].filter(Boolean).join("\n");

// Goes into a path sent with the key, so nothing that could climb out of it or add a query.
const WIRO_MODEL = /^[\w.-]+\/[\w.-]+$/;

/** The OpenRouter Image Adapter, using the Settings at the time of each call. */
export function openRouterImages(settings: SettingsStore, baseUrl: string): ImageAdapter {
  // shortcut: held until the app restarts, so a model that gains image input needs one, refresh it if that ever matters.
  const known = new Map<string, ImageModel | undefined>();

  async function modelInfo(model: string, headers: Record<string, string>, signal: AbortSignal) {
    if (known.has(model)) return known.get(model);
    const response = await fetch(`${baseUrl}/images/models`, { headers, signal }).catch(() => undefined);
    const { data } = ((await response?.json().catch(() => ({}))) ?? {}) as { data?: ImageModel[] };
    // Without an answer the image still generates plainly, so ask again next time.
    if (!response?.ok || !data) return undefined;
    const info = data.find(({ id }) => id === model);
    known.set(model, info);
    return info;
  }

  return async (payload, signal) => {
    const { aspect_ratio, reference_images } = payload;
    const { imageModel, imageApiKey, imageResolution } = settings.read();
    const headers = { Authorization: `Bearer ${imageApiKey}` };
    const limited = AbortSignal.any([signal, AbortSignal.timeout(GIVE_UP_MS)]);

    const info = await modelInfo(imageModel, headers, limited);
    const parameters = info?.supported_parameters ?? {};
    const ratios = parameters.aspect_ratio;
    const takesRatio = ratios && (ratios.values?.includes(aspect_ratio) ?? true);
    const resolution = closestTier(parameters.resolution?.values, imageResolution);
    const takesImages = info?.architecture?.input_modalities?.includes("image");
    const references = takesImages ? reference_images.slice(0, parameters.input_references?.max ?? MOST_REFERENCES) : [];

    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: limited,
      body: JSON.stringify({
        model: imageModel,
        // The Image API has no fields for these, so the model reads them as part of the prompt.
        prompt: promptWith(payload),
        ...(takesRatio && { aspect_ratio }),
        ...(resolution && { resolution }),
        ...(references.length > 0 && {
          input_references: references.map(({ bytes, mediaType }) => ({
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` },
          })),
        }),
      }),
    });
    const reply = (await response.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: unknown };
    const encoded = reply.data?.[0]?.b64_json;
    if (!response.ok || !encoded) {
      throw apiError(imageApiKey, `Image API error: ${JSON.stringify({ status: response.status, error: reply.error })}`, response.status);
    }
    return new Uint8Array(Buffer.from(encoded, "base64"));
  };
}

type WiroField = { id: string; type: string; required?: boolean; defaultvalue?: unknown; options?: { value: string }[]; maxinputlenght?: number };
type WiroTask = { pexit?: string | number; outputs?: { url?: string }[] };

/** The Wiro Image Adapter. Each model names its own fields, so it reads them from the model's details and fills the ones it knows. */
export function wiroImages(settings: SettingsStore, baseUrl: string): ImageAdapter {
  // shortcut: held until the app restarts, so a model whose fields change needs one, refresh it if that ever matters.
  const known = new Map<string, WiroField[]>();

  return async (payload, signal) => {
    const { negative_prompt, aspect_ratio, reference_images } = payload;
    const { imageModel, imageApiKey, imageResolution } = settings.read();
    const headers = { "x-api-key": imageApiKey };
    const limited = AbortSignal.any([signal, AbortSignal.timeout(GIVE_UP_MS)]);
    const failed = (what: string, status: number, detail: unknown) => apiError(imageApiKey, `${what}: ${JSON.stringify({ status, detail })}`, status);
    if (!WIRO_MODEL.test(imageModel)) throw failed("Wiro models are named owner/model", 0, undefined);

    let fields = known.get(imageModel);
    if (!fields) {
      const [slugowner, slugproject] = imageModel.split("/");
      const response = await fetch(`${baseUrl}/Tool/Detail`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        signal: limited,
        body: JSON.stringify({ slugowner, slugproject }),
      });
      const reply = (await response.json().catch(() => ({}))) as { tool?: { parameters?: { items?: WiroField[] }[] }[]; errors?: unknown };
      // Without its fields there is no knowing how to ask, so a model Wiro doesn't describe fails.
      if (!response.ok || !reply.tool?.[0]) throw failed("Wiro has no such model", response.status, reply.errors);
      fields = reply.tool[0].parameters?.flatMap(({ items = [] }) => items) ?? [];
      known.set(imageModel, fields);
    }
    const listed = fields;
    const field = (id: string) => listed.find((each) => each.id === id);
    const withOptions = (ids: string[]) => ids.map(field).find((each) => each?.options?.length);

    const form = new FormData();
    // A field the model requires and this doesn't fill, such as how many to draw, keeps the model's default.
    for (const { id, type, required, defaultvalue } of listed) {
      if (required && !type.includes("file") && defaultvalue !== undefined && defaultvalue !== "") form.set(id, String(defaultvalue));
    }
    const negative = ["negativePrompt", "negative_prompt"].find(field);
    form.set("prompt", promptWith(payload, !!negative));
    if (negative && negative_prompt) form.set(negative, negative_prompt);
    const ratio = withOptions(["aspectRatio", "ratio", "aspect_ratio"]);
    if (ratio?.options?.some(({ value }) => value === aspect_ratio)) form.set(ratio.id, aspect_ratio);
    const size = withOptions(["resolution", "size"]);
    const tier = closestTier(
      size?.options?.map(({ value }) => value),
      imageResolution,
    );
    if (size && tier) form.set(size.id, tier);
    if (field("width") && field("height")) {
      const { width, height } = dimensions(aspect_ratio, imageResolution);
      form.set("width", String(width));
      form.set("height", String(height));
    }
    const input = field("inputImage");
    if (input && reference_images.length > 0) {
      const single = input.type === "fileinput";
      for (const { bytes, mediaType } of reference_images.slice(0, single ? 1 : (input.maxinputlenght ?? MOST_REFERENCES))) {
        form.append("inputImage", new Blob([Buffer.from(bytes)], { type: mediaType }), `reference.${mediaType.split("/")[1]}`);
      }
      // A single file field goes with its URL field empty.
      if (single) form.set("inputImageUrl", "");
    }

    // The sync run answers once the picture is drawn, so there is no task to poll.
    const response = await fetch(`${baseUrl}/Run/${imageModel}/sync`, { method: "POST", headers, signal: limited, body: form });
    const reply = (await response.json().catch(() => ({}))) as { errors?: unknown; tasklist?: WiroTask[] };
    const task = reply.tasklist?.[0];
    // Wiro's docs give the exit code as text, and a number is read the same in case a model sends one.
    const url = String(task?.pexit) === "0" ? task?.outputs?.[0]?.url : undefined;
    if (!response.ok || !url) throw failed("Image API error", response.status, reply.errors ?? { pexit: task?.pexit });
    const image = await fetch(url, { signal: limited });
    if (!image.ok) throw failed("Wiro's picture wouldn't download", image.status, undefined);
    return new Uint8Array(await image.arrayBuffer());
  };
}

// The ratios Google's image models take. Any other is left to the model.
const GOOGLE_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
// Nano Banana takes at most this many reference images.
const GOOGLE_REFERENCES = 14;

type GoogleReply = { status?: string; steps?: { type?: string; content?: { type?: string; data?: string }[] }[]; error?: unknown };

/** The Google AI Studio Image Adapter, on the Interactions API, which takes the references inline with the prompt. */
export function googleImages(settings: SettingsStore, baseUrl: string): ImageAdapter {
  return async (payload, signal) => {
    const { aspect_ratio, reference_images } = payload;
    const { imageModel, imageApiKey, imageResolution } = settings.read();
    const response = await fetch(`${baseUrl}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": imageApiKey, "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(GIVE_UP_MS)]),
      body: JSON.stringify({
        model: imageModel,
        input: [
          // There is no field for these, so the model reads them as part of the prompt.
          { type: "text", text: promptWith(payload) },
          ...reference_images.slice(0, GOOGLE_REFERENCES).map(({ bytes, mediaType }) => ({
            type: "image",
            mime_type: mediaType,
            data: Buffer.from(bytes).toString("base64"),
          })),
        ],
        // 1.5K falls between Google's sizes and takes the smaller, cheaper one.
        response_format: {
          type: "image",
          image_size: closestTier(["1K", "2K"], imageResolution),
          ...(GOOGLE_RATIOS.includes(aspect_ratio) && { aspect_ratio }),
        },
        // Otherwise Google keeps the request and the picture, a day on the free tier and 55 on a paid one.
        store: false,
      }),
    });
    const reply = (await response.json().catch(() => ({}))) as GoogleReply;
    const encoded = reply.steps?.flatMap(({ content = [] }) => content).find(({ type, data }) => type === "image" && data)?.data;
    if (!response.ok || !encoded) {
      throw apiError(imageApiKey, `Image API error: ${JSON.stringify({ status: response.status, state: reply.status, error: reply.error })}`, response.status);
    }
    return new Uint8Array(Buffer.from(encoded, "base64"));
  };
}

/** A provider's image models, by the id its Image model field takes. Empty when it doesn't answer. */
export type ImageModelList = (provider: "openrouter" | "wiro" | "google", signal: AbortSignal) => Promise<string[]>;

// Long enough for a slow catalog, short enough that Settings isn't kept waiting on one that's down.
const LIST_MS = 15_000;

/** OpenRouter's and Wiro's public catalogs, which take no key, so none is sent, and Google's, which only lists for a key. */
export function imageModelLists(settings: SettingsStore, urls: { openRouter: string; wiro: string; google: string }): ImageModelList {
  const asked = async (url: string, signal: AbortSignal, init?: RequestInit) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(LIST_MS)]) }).catch(() => undefined);
    return response?.ok ? response.json().catch(() => ({})) : {};
  };
  return async (provider, signal) => {
    if (provider === "google") {
      const { imageProvider, imageApiKey } = settings.read();
      // A key saved for another provider must not be sent to Google, so this waits until Google's is saved.
      if (imageProvider !== "google" || !imageApiKey) return [];
      const { models } = (await asked(`${urls.google}/models?pageSize=1000`, signal, { headers: { "x-goog-api-key": imageApiKey } })) as {
        models?: { name?: unknown }[];
      };
      // shortcut: told apart by name, as the listing doesn't say which models draw, read a capability if Google adds one.
      return (models ?? []).flatMap(({ name }) => (typeof name === "string" && /image|banana/.test(name) ? [name.replace(/^models\//, "")] : []));
    }
    if (provider === "openrouter") {
      const { data } = (await asked(`${urls.openRouter}/images/models`, signal)) as { data?: { id?: unknown }[] };
      return (data ?? []).map(({ id }) => id).filter((id) => typeof id === "string");
    }
    const { tool } = (await asked(`${urls.wiro}/Tool/List`, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // shortcut: the first 500 drawing models in one page, page through them if Wiro ever lists more.
      body: JSON.stringify({ start: "0", limit: "500", categories: ["text-to-image"], hideworkflows: true, summary: true }),
    })) as { tool?: { cleanslugowner?: unknown; cleanslugproject?: unknown }[] };
    return (tool ?? []).flatMap(({ cleanslugowner, cleanslugproject }) =>
      typeof cleanslugowner === "string" && typeof cleanslugproject === "string" ? [`${cleanslugowner}/${cleanslugproject}`] : [],
    );
  };
}
