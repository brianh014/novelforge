import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { type ImagePayload, openRouterImages } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { PNG, png, scriptedTextProvider, startGame, tempFolder } from "./support";

const generated = () => Response.json({ data: [{ b64_json: PNG.toString("base64"), media_type: "image/png" }] });

/** A local stand-in for OpenRouter's Image API, so the real client code path runs. */
function fakeOpenRouter(models: unknown, reply: () => Response | Promise<Response> = generated) {
  const requests: { path: string; body: any; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    routes: {
      "/v1/images/models": (req) => {
        requests.push({ path: "models", body: undefined, authorization: req.headers.get("authorization") });
        return models instanceof Response ? models.clone() : Response.json(models);
      },
      "/v1/images": async (req) => {
        requests.push({ path: "images", body: await req.json(), authorization: req.headers.get("authorization") });
        return reply();
      },
    },
  });
  return { requests, baseUrl: new URL("/v1", server.url).href, stop: () => server.stop(true) };
}

const listing = (architecture: string[], supported_parameters: object) => ({
  data: [
    { id: "other/model", architecture: { input_modalities: ["text"] }, supported_parameters: {} },
    { id: "fake/image", architecture: { input_modalities: architecture, output_modalities: ["image"] }, supported_parameters },
  ],
});

const payload = (reference_images: ImagePayload["reference_images"] = []): ImagePayload => ({
  prompt: "A flooded street",
  negative_prompt: "text",
  aspect_ratio: "16:9",
  reference_images,
  style_preset: "Woodcut",
});

const previous = (mark: number) => ({ role: "previous_scene" as const, bytes: png(mark), mediaType: "image/png" });

const never = new AbortController().signal;

let folder: ReturnType<typeof tempFolder>;
let provider: ReturnType<typeof fakeOpenRouter>;
let settings: ReturnType<typeof settingsStore>;

const adapterFor = (models: unknown, reply?: () => Response | Promise<Response>) => {
  provider = fakeOpenRouter(models, reply);
  return openRouterImages(settings, provider.baseUrl);
};

const sent = () => provider.requests.find(({ path }) => path === "images")!;

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ imageModel: "fake/image", imageApiKey: "image-key-value", textApiKey: "text-key-value" });
});

afterEach(() => {
  provider.stop();
  folder.remove();
});

test("a request carries the image key, the model and one prompt with the Art Style, and answers with the bytes", async () => {
  const adapter = adapterFor(listing(["text"], { aspect_ratio: { type: "enum", values: ["1:1", "16:9"] } }));

  const bytes = await adapter(payload(), never);

  expect(bytes).toEqual(new Uint8Array(PNG));
  expect(provider.requests.map(({ authorization }) => authorization)).toEqual([
    "Bearer image-key-value",
    "Bearer image-key-value",
  ]);
  expect(sent().body).toEqual({
    model: "fake/image",
    prompt: "Woodcut\nA flooded street\nAvoid: text.",
    aspect_ratio: "16:9",
  });
});

test("a model that takes image input gets its references as data URLs", async () => {
  const adapter = adapterFor(listing(["text", "image"], {}));

  await adapter(payload([previous(1)]), never);

  const [reference] = sent().body.input_references;
  expect(reference.type).toBe("image_url");
  expect(reference.image_url.url).toBe(`data:image/png;base64,${Buffer.from(png(1)).toString("base64")}`);
});

test("references are trimmed to the model's limit, keeping the first", async () => {
  const adapter = adapterFor(listing(["text", "image"], { input_references: { type: "range", min: 0, max: 1 } }));

  await adapter(payload([previous(1), previous(2)]), never);

  expect(sent().body.input_references).toHaveLength(1);
  expect(sent().body.input_references[0].image_url.url).toContain(Buffer.from(png(1)).toString("base64"));
});

test("a text-only model gets no references, and fields it doesn't support are dropped", async () => {
  const adapter = adapterFor(listing(["text"], {}));

  await adapter(payload([previous(1)]), never);

  expect(Object.keys(sent().body).toSorted()).toEqual(["model", "prompt"]);
});

test("a ratio the model doesn't list is dropped too", async () => {
  const adapter = adapterFor(listing(["text"], { aspect_ratio: { type: "enum", values: ["1:1"] } }));

  await adapter(payload(), never);

  expect(sent().body.aspect_ratio).toBeUndefined();
});

test.each([
  ["480p", ["768", "1K", "2K"], "768"],
  ["480p", ["1K", "2K"], "1K"],
  ["720p", ["768", "1K", "1.5K", "2K", "4K"], "1K"],
  ["1080p", ["1K", "1.5K", "2K", "4K"], "2K"],
  ["4k", ["1K", "2K", "4K"], "4K"],
  ["4k", ["1K", "2K"], "2K"],
  ["720p", ["2K", "4K"], "2K"],
] as const)("%s on a model with %j asks for %s", async (imageResolution, values, resolution) => {
  settings.update({ imageResolution });
  const adapter = adapterFor(listing(["text"], { resolution: { type: "enum", values } }));

  await adapter(payload(), never);

  expect(sent().body.resolution).toBe(resolution);
});

test("a model without sizes, or with none this can read, is sent no resolution", async () => {
  await adapterFor(listing(["text"], {}))(payload(), never);
  expect(sent().body.resolution).toBeUndefined();

  provider.stop();
  await adapterFor(listing(["text"], { resolution: { type: "enum", values: ["auto"] } }))(payload(), never);
  expect(sent().body.resolution).toBeUndefined();
});

test("without a model listing the image still generates plainly, and the listing is asked for again", async () => {
  const adapter = adapterFor(new Response("down", { status: 503 }));

  await adapter(payload([previous(1)]), never);
  await adapter(payload([previous(1)]), never);

  expect(Object.keys(sent().body).toSorted()).toEqual(["model", "prompt"]);
  expect(provider.requests.filter(({ path }) => path === "models")).toHaveLength(2);
});

test("a listing is asked for once per model", async () => {
  const adapter = adapterFor(listing(["text"], {}));

  await adapter(payload(), never);
  await adapter(payload(), never);

  expect(provider.requests.filter(({ path }) => path === "models")).toHaveLength(1);
});

test("an API error throws with the key removed", async () => {
  const adapter = adapterFor(listing(["text"], {}), () =>
    Response.json({ error: { message: "Bad key image-key-value", code: 401 } }, { status: 401 }),
  );

  const failure = (await adapter(payload(), never).catch((error) => error)) as Error;

  expect(failure.message).toContain("401");
  expect(failure.message).not.toContain("image-key-value");
});

test("a success with no image throws", async () => {
  const adapter = adapterFor(listing(["text"], {}), () => Response.json({ data: [] }));

  await expect(adapter(payload(), never)).rejects.toThrow("Image API error");
});

test("the abort signal reaches the request, so a replaced response stops generating", async () => {
  const controller = new AbortController();
  const adapter = adapterFor(listing(["text"], {}), () => {
    controller.abort();
    return new Promise(() => {});
  });

  await expect(adapter(payload(), controller.signal)).rejects.toThrow();
});

test("a whole Turn through the real adapter stores the image and logs no key", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const adapter = adapterFor(listing(["text"], {}));
  const reply = JSON.stringify({
    check: null,
    narration: "The tide rises.",
    state_operations: [{ op: "set_scene", location: "The street", visible_cast: [] }],
    scene_changed: true,
    visual_description: "A flooded street",
  });
  const game = startGame(join(folder.path, "Saves"), scriptedTextProvider(reply).textProvider, undefined, undefined, adapter);
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I wade forward." });
  for (let tries = 0; tries < 200; tries++) {
    const { pending } = (await game.get(`/saves/${id}/images`).then((r) => r.json())) as { pending: boolean };
    if (!pending) break;
    await Bun.sleep(5);
  }

  expect((await game.get(`/saves/${id}/messages/2/image`)).status).toBe(200);
  expect(sent().body.prompt).toContain("A flooded street");
  expect(sent().authorization).toBe("Bearer image-key-value");
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
  await game.stop();
});
