import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { googleImages, type ImagePayload } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { PNG, png, tempFolder } from "./support";

const drawn = () =>
  Response.json({
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: PNG.toString("base64") }] }],
  });

/** A local stand-in for Google's Interactions API, so the real client code path runs. */
function fakeGoogle(reply: () => Response = drawn) {
  const requests: { key: string | null; body: any }[] = [];
  const server = Bun.serve({
    port: 0,
    routes: {
      "/v1/interactions": async (req) => {
        requests.push({ key: req.headers.get("x-goog-api-key"), body: await req.json() });
        return reply();
      },
    },
  });
  return { requests, baseUrl: new URL("/v1", server.url).href, stop: () => server.stop(true) };
}

const payload = (aspect_ratio = "16:9", reference_images: ImagePayload["reference_images"] = []): ImagePayload => ({
  prompt: "A flooded street",
  negative_prompt: "text",
  aspect_ratio,
  reference_images,
  style_preset: "Woodcut",
});

const reference = (mark: number) => ({ role: "pc" as const, bytes: png(mark), mediaType: "image/png" });
const never = new AbortController().signal;

let folder: ReturnType<typeof tempFolder>;
let google: ReturnType<typeof fakeGoogle>;
let settings: ReturnType<typeof settingsStore>;

const adapterFor = (reply?: () => Response) => {
  google = fakeGoogle(reply);
  return googleImages(settings, google.baseUrl);
};

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ imageProvider: "google", imageModel: "gemini-nano-banana-2.1", imageApiKey: "google-key-value", imageResolution: "2k" });
});

afterEach(() => {
  google.stop();
  folder.remove();
});

test("a request carries the key, the prompt, the references inline and the size, keeps nothing on Google, and answers with the bytes", async () => {
  const adapter = adapterFor();

  const bytes = await adapter(payload("16:9", [reference(1)]), never);

  expect(bytes).toEqual(new Uint8Array(PNG));
  const [{ key, body }] = google.requests as [{ key: string; body: any }];
  expect(key).toBe("google-key-value");
  expect(body).toEqual({
    model: "gemini-nano-banana-2.1",
    input: [
      { type: "text", text: "A flooded street\nWoodcut\nAvoid: text." },
      { type: "image", mime_type: "image/png", data: Buffer.from(png(1)).toString("base64") },
    ],
    response_format: { type: "image", image_size: "2K", aspect_ratio: "16:9" },
    store: false,
  });
});

test("1.5K takes Google's smaller size, and a ratio Google doesn't take is left to the model", async () => {
  settings.update({ imageResolution: "1.5k" });
  const adapter = adapterFor();

  await adapter(payload("7:5"), never);

  expect(google.requests[0]!.body.response_format).toEqual({ type: "image", image_size: "1K" });
});

test("a reply with no picture, such as one Google's safety filter stopped, throws with the key removed", async () => {
  const adapter = adapterFor(() => Response.json({ status: "failed", steps: [], error: { message: "Blocked for google-key-value" } }));

  const failure = (await adapter(payload(), never).catch((error) => error)) as Error;

  expect(failure.message).toContain("Image API error");
  expect(failure.message).toContain("failed");
  expect(failure.message).not.toContain("google-key-value");
});
