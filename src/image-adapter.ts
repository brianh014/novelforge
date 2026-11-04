import type { SettingsStore } from "./settings-store";

/** The shared payload every Image Adapter formats for its backend. The first references are kept when a model takes fewer. */
export type ImagePayload = {
  prompt: string;
  negative_prompt?: string;
  aspect_ratio: string;
  reference_images: { role: "npc" | "previous_scene" | "pc"; bytes: Uint8Array; mediaType: string }[];
  style_preset: string;
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

// An image can take minutes, but one that never answers must not hold up the Save's next image forever.
const GIVE_UP_MS = 5 * 60 * 1000;

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

  return async ({ prompt, negative_prompt, aspect_ratio, reference_images, style_preset }, signal) => {
    const { imageModel, imageApiKey } = settings.read();
    const headers = { Authorization: `Bearer ${imageApiKey}` };
    const redacted = (detail: string) => detail.replaceAll(imageApiKey, "[key]");
    const limited = AbortSignal.any([signal, AbortSignal.timeout(GIVE_UP_MS)]);

    const info = await modelInfo(imageModel, headers, limited);
    const parameters = info?.supported_parameters ?? {};
    const ratios = parameters.aspect_ratio;
    const takesRatio = ratios && (ratios.values?.includes(aspect_ratio) ?? true);
    const takesImages = info?.architecture?.input_modalities?.includes("image");
    const references = takesImages
      ? reference_images.slice(0, parameters.input_references?.max ?? MOST_REFERENCES)
      : [];

    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: limited,
      body: JSON.stringify({
        model: imageModel,
        // The Image API has no fields for these, so the model reads them as part of the prompt.
        prompt: [style_preset, prompt, negative_prompt && `Avoid: ${negative_prompt}.`].filter(Boolean).join("\n"),
        ...(takesRatio && { aspect_ratio }),
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
      throw new Error(redacted(`Image API error: ${JSON.stringify({ status: response.status, error: reply.error })}`));
    }
    return new Uint8Array(Buffer.from(encoded, "base64"));
  };
}
