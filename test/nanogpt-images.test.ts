import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { type ImagePayload, nanoGptImages, nanoGptSize } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { PNG, png, tempFolder } from "./support";

// Shaped like NanoGPT's live listing, which differs from its docs: plain lists, and the reference limit as max_input_images.
const seedream = {
  id: "bytedance/seedream-v5.5",
  architecture: { input_modalities: ["text", "image"] },
  supported_parameters: { resolutions: ["1k", "1.5k", "2k"], aspect_ratio: ["auto", "1:1", "16:9"], max_input_images: 1 },
};
const textOnly = { id: "text/only", architecture: { input_modalities: ["text"] }, supported_parameters: { resolutions: ["1024*1024", "1280*720"] } };

const inline = () => Response.json({ created: 1, data: [{ b64_json: PNG.toString("base64") }] });

/** A local stand-in for NanoGPT's Image API, so the real client code path runs. */
function fakeNanoGpt(reply: (url: URL) => Response = inline) {
  const sent: { key: string | null; body: any }[] = [];
  const server = Bun.serve({
    port: 0,
    routes: {
      "/api/v1/images/models": () => Response.json({ object: "list", data: [seedream, textOnly] }),
      "/api/v1/images": async (req): Promise<Response> => {
        sent.push({ key: req.headers.get("authorization"), body: await req.json() });
        return reply(new URL(server.url));
      },
      "/out/0.png": () => new Response(PNG),
    },
  });
  return { sent, baseUrl: new URL("/api/v1", server.url).href, stop: () => server.stop(true) };
}

const payload = (reference_images: ImagePayload["reference_images"] = []): ImagePayload => ({
  prompt: "A flooded street",
  negative_prompt: "text",
  aspect_ratio: "16:9",
  reference_images,
  style_preset: "Woodcut",
});

const reference = (mark: number) => ({ role: "pc" as const, bytes: png(mark), mediaType: "image/png" });
const never = new AbortController().signal;

let folder: ReturnType<typeof tempFolder>;
let nano: ReturnType<typeof fakeNanoGpt>;
let settings: ReturnType<typeof settingsStore>;

const adapterFor = (reply?: (url: URL) => Response) => {
  nano = fakeNanoGpt(reply);
  return nanoGptImages(settings, nano.baseUrl);
};

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ imageProvider: "nanogpt", imageModel: "bytedance/seedream-v5.5", imageApiKey: "nano-key-value", imageResolution: "1.5k" });
});

afterEach(() => {
  nano.stop();
  folder.remove();
});

test("a request carries the key, the prompt, the model's own size and ratio, and its references up to its limit", async () => {
  const adapter = adapterFor();

  const bytes = await adapter(payload([reference(1), reference(2)]), never);

  expect(bytes).toEqual(new Uint8Array(PNG));
  expect(nano.sent[0]!.key).toBe("Bearer nano-key-value");
  expect(nano.sent[0]!.body).toEqual({
    model: "bytedance/seedream-v5.5",
    prompt: "A flooded street\nWoodcut\nAvoid: text.",
    n: 1,
    resolution: "1.5k",
    aspect_ratio: "16:9",
    input_references: [{ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(png(1)).toString("base64")}` } }],
  });
});

test("a model sized in pixels gets the one nearest the shape, and a text-only model no references", async () => {
  settings.update({ imageModel: "text/only", imageResolution: "1k" });
  const adapter = adapterFor();

  await adapter(payload([reference(1)]), never);

  expect(nano.sent[0]!.body).toEqual({ model: "text/only", prompt: "A flooded street\nWoodcut\nAvoid: text.", n: 1, resolution: "1280*720" });
});

test.each([
  [["1k", "2k"], "1k", "1:1", "1k"],
  [["1024*1024", "1280*720", "720*1280"], "1k", "9:16", "720*1280"],
  [["1024*1024", "2048*2048"], "2k", "1:1", "2048*2048"],
  [["auto"], "1k", "1:1", undefined],
] as const)("from %j, %s at %s takes %s", (sizes, resolution, aspect, size) => {
  expect(nanoGptSize([...sizes], resolution, aspect)).toBe(size);
});

test("a picture sent as a link is downloaded", async () => {
  const adapter = adapterFor((url) => Response.json({ data: [{ url: new URL("/out/0.png", url).href }] }));

  expect(await adapter(payload(), never)).toEqual(new Uint8Array(PNG));
});

test("an error throws with the key removed", async () => {
  const adapter = adapterFor(() => Response.json({ error: { message: "Bad key nano-key-value", code: "invalid_api_key" } }, { status: 401 }));

  const failure = (await adapter(payload(), never).catch((error) => error)) as Error;

  expect(failure.message).toContain("401");
  expect(failure.message).not.toContain("nano-key-value");
});
