import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { type ImagePayload, wiroImages } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { PNG, png, tempFolder } from "./support";

type Field = { id: string; type: string; required?: boolean; defaultvalue?: string; options?: { value: string }[]; maxinputlenght?: number };

const select = (id: string, values: string[], required = false) => ({
  id,
  type: "select",
  required,
  defaultvalue: values[0],
  options: values.map((value) => ({ value })),
});

// Shaped like Seedream 5.5's details on Wiro.
const seedream: Field[] = [
  { id: "inputImage", type: "combinefileinput", maxinputlenght: 1 },
  { id: "prompt", type: "textarea", required: true, defaultvalue: "A sample prompt" },
  select("resolution", ["1k", "1.5k", "2k"], true),
  select("aspectRatio", ["auto", "1:1", "16:9"]),
  select("samples", ["1", "2"], true),
];

// Shaped like FLUX.2 Dev's: a size by width and height, and its own negative prompt.
const flux: Field[] = [
  { id: "prompt", type: "textarea", required: true },
  { id: "negativePrompt", type: "textarea" },
  { id: "width", type: "number" },
  { id: "height", type: "number" },
];

type Run = { path: string; key: string | null; form: FormData };

/** A local stand-in for Wiro's API, so the real client code path runs. */
function fakeWiro(fields: Field[] | undefined, task: object = { pexit: "0" }) {
  const runs: Run[] = [];
  let details = 0;
  const server = Bun.serve({
    port: 0,
    routes: {
      "/v1/Tool/Detail": () => {
        details++;
        return Response.json(
          fields ? { result: true, errors: [], tool: [{ parameters: [{ items: fields }] }] } : { result: false, errors: [{ message: "No tool" }] },
        );
      },
      "/v1/Run/:owner/:model/sync": async (req): Promise<Response> => {
        runs.push({ path: new URL(req.url).pathname, key: req.headers.get("x-api-key"), form: await req.formData() });
        return Response.json({
          result: true,
          errors: [],
          tasklist: [{ outputs: [{ contenttype: "image/png", url: new URL("/out/0.png", server.url).href }], ...task }],
        });
      },
      "/out/0.png": () => new Response(PNG),
    },
  });
  return { runs, details: () => details, baseUrl: new URL("/v1", server.url).href, stop: () => server.stop(true) };
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
let wiro: ReturnType<typeof fakeWiro>;
let settings: ReturnType<typeof settingsStore>;

const adapterFor = (fields: Field[] | undefined, task?: object) => {
  wiro = fakeWiro(fields, task);
  return wiroImages(settings, wiro.baseUrl);
};

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ imageProvider: "wiro", imageModel: "bytedance/seedream-5-5", imageApiKey: "wiro-key-value", imageResolution: "1.5k" });
});

afterEach(() => {
  wiro.stop();
  folder.remove();
});

test("a run carries the key, fills the model's own fields and answers with the downloaded picture", async () => {
  const adapter = adapterFor(seedream);

  const bytes = await adapter(payload([reference(1), reference(2)]), never);

  expect(bytes).toEqual(new Uint8Array(PNG));
  const [run] = wiro.runs;
  expect(run!.path).toBe("/v1/Run/bytedance/seedream-5-5/sync");
  expect(run!.key).toBe("wiro-key-value");
  // Multipart sends its newlines as \r\n.
  expect(String(run!.form.get("prompt")).replaceAll("\r\n", "\n")).toBe("A flooded street\nWoodcut\nAvoid: text.");
  expect(run!.form.get("resolution")).toBe("1.5k");
  expect(run!.form.get("aspectRatio")).toBe("16:9");
  expect(run!.form.get("samples")).toBe("1");
  // The model takes one reference, so the first is kept.
  const files = run!.form.getAll("inputImage") as File[];
  expect(files).toHaveLength(1);
  expect(new Uint8Array(await files[0]!.arrayBuffer())).toEqual(png(1));
});

test("a model sized by width and height gets the Resolution's size, and its own negative prompt", async () => {
  const adapter = adapterFor(flux);

  await adapter(payload([reference(1)]), never);

  const { form } = wiro.runs[0]!;
  expect([form.get("width"), form.get("height")]).toEqual(["2048", "1152"]);
  expect(String(form.get("prompt")).replaceAll("\r\n", "\n")).toBe("A flooded street\nWoodcut");
  expect(form.get("negativePrompt")).toBe("text");
  expect(form.has("inputImage")).toBe(false);
});

test("a model's details are asked for once", async () => {
  const adapter = adapterFor(flux);

  await adapter(payload(), never);
  await adapter(payload(), never);

  expect(wiro.details()).toBe(1);
});

test("a model Wiro doesn't describe fails before anything is run", async () => {
  const adapter = adapterFor(undefined);

  await expect(adapter(payload(), never)).rejects.toThrow("Wiro has no such model");
  expect(wiro.runs).toHaveLength(0);
});

test("a run that fails throws with the key removed", async () => {
  const adapter = adapterFor(flux, { pexit: "1", outputs: [] });

  const failure = (await adapter(payload(), never).catch((error) => error)) as Error;

  expect(failure.message).toContain("Image API error");
  expect(failure.message).not.toContain("wiro-key-value");
});

test("an exit code sent as a number counts the same as one sent as text", async () => {
  const adapter = adapterFor(flux, { pexit: 0 });

  expect(await adapter(payload(), never)).toEqual(new Uint8Array(PNG));
});

test("a model name that isn't owner/model is refused before anything is sent with the key", async () => {
  const adapter = adapterFor(flux);

  for (const imageModel of ["../../Task/Cancel", "bytedance/seedream?x=1", "seedream"]) {
    settings.update({ imageModel });
    await expect(adapter(payload(), never)).rejects.toThrow("Wiro models are named owner/model");
  }
  expect(wiro.details()).toBe(0);
  expect(wiro.runs).toHaveLength(0);
});
