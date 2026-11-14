import { expect, test } from "bun:test";
import { fillWorkflow, parseWorkflow, WORKFLOW_EXAMPLE } from "../src/comfy-workflow";
import type { ImagePayload } from "../src/image-adapter";

const payload: ImagePayload = {
  prompt: "A harbour",
  negative_prompt: "text",
  aspect_ratio: "16:9",
  reference_images: [],
  style_preset: "Ink wash",
};

const unused = async () => "unused";

const workflow = (inputs: object, extra = {}) => JSON.stringify({ "1": { class_type: "Node", inputs: { text: "{{prompt}}", ...inputs }, ...extra } });

const fill = async (inputs: object, change: Partial<ImagePayload> = {}) =>
  (await fillWorkflow(workflow(inputs), { ...payload, ...change }, 7, unused, "1k"))["1"]!.inputs;

test("each payload field reaches its placeholder", async () => {
  const inputs = await fill({
    negative: "{{negative_prompt}}",
    style: "{{art_style}}",
    ratio: "{{aspect_ratio}}",
  });

  expect(inputs).toEqual({ text: "A harbour", negative: "text", style: "Ink wash", ratio: "16:9" });
});

test("a placeholder that is the whole value keeps its number, as ComfyUI wants one", async () => {
  const inputs = await fill({ seed: "{{seed}}", width: "{{width}}", height: "{{height}}" });

  expect(inputs).toEqual({ text: "A harbour", seed: 7, width: 1360, height: 768 });
});

test("the width and height follow the resolution", async () => {
  const graph = await fillWorkflow(workflow({ width: "{{width}}", height: "{{height}}" }), payload, 7, unused, "2k");

  expect(graph["1"]!.inputs).toMatchObject({ width: 2736, height: 1536 });
});

test("a placeholder inside longer text joins it", async () => {
  expect(await fill({ text: "{{art_style}}, {{prompt}}, seed {{seed}}" })).toEqual({ text: "Ink wash, A harbour, seed 7" });
});

test.each([
  ["quotes and braces", 'He said "stop"}, {"2": {"class_type": "Evil"}}'],
  ["text that looks like another placeholder", "{{seed}} and {{negative_prompt}}"],
  ["a replacement pattern", "$& $1 $`"],
])("prompt text with %s stays plain text", async (_name, prompt) => {
  const graph = await fillWorkflow(workflow({ text: "{{prompt}}!" }), { ...payload, prompt }, 7, unused, "1k");

  expect(Object.keys(graph)).toEqual(["1"]);
  expect(graph["1"]!.inputs.text).toBe(`${prompt}!`);
});

test("only inputs are filled, so the Narrator's words can't change what a node is", async () => {
  const graph = await fillWorkflow(workflow({}, { class_type: "{{prompt}}", _meta: { title: "{{prompt}}" } }), payload, 7, unused, "1k");

  expect(graph["1"]).toMatchObject({ class_type: "{{prompt}}", _meta: { title: "{{prompt}}" } });
});

test("links and nested values survive, with placeholders inside them filled", async () => {
  expect(await fill({ model: ["4", 0], nested: { list: ["{{seed}}"], on: true, none: null } })).toEqual({
    text: "A harbour",
    model: ["4", 0],
    nested: { list: [7], on: true, none: null },
  });
});

test("a missing negative prompt is empty", async () => {
  expect(await fill({ negative: "{{negative_prompt}}" }, { negative_prompt: undefined })).toMatchObject({ negative: "" });
});

test.each([
  ["nothing", "  \n", "Paste a workflow"],
  ["broken JSON", '{"1": ', "isn't valid JSON"],
  ["a list", "[]", "isn't a ComfyUI workflow"],
  ["an empty object", "{}", "isn't a ComfyUI workflow"],
  ["the UI format", JSON.stringify({ nodes: [{ id: 1 }], links: [] }), "Export (API)"],
  ["a node with no class_type", JSON.stringify({ "3": { inputs: {} } }), 'Node "3"'],
  ["a node with no inputs", JSON.stringify({ "3": { class_type: "Node" } }), 'Node "3"'],
  ["a node that isn't an object", JSON.stringify({ "3": 1 }), 'Node "3"'],
  ["no prompt", workflow({ text: "A fixed picture" }), "{{prompt}}"],
  ["an unknown placeholder", workflow({ bad: "{{promt}}" }), "{{promt}}"],
  ["a wrong case", workflow({ bad: "{{Prompt}}" }), "{{Prompt}}"],
  ["a slot zero", workflow({ bad: "{{npc_0}}" }), "{{npc_0}}"],
  ["an object's own property name", workflow({ bad: "{{constructor}}" }), "{{constructor}}"],
])("%s is refused and says why", (_name, text, reason) => {
  expect(() => parseWorkflow(text)).toThrow(reason);
});

test("every unknown placeholder is named at once", () => {
  expect(() => parseWorkflow(workflow({ one: "{{a}}", two: "{{b}}" }))).toThrow("{{a}}, {{b}}");
});

test("the example shown to players is valid", () => {
  expect(Object.keys(parseWorkflow(WORKFLOW_EXAMPLE))).toHaveLength(7);
});

const image = (role: ImagePayload["reference_images"][number]["role"], mark: number) => ({
  role,
  bytes: Uint8Array.of(mark),
  mediaType: "image/png",
});

const cast = [image("npc", 1), image("npc", 2), image("previous_scene", 3), image("pc", 4)];

async function withReferences(inputs: object, reference_images: ImagePayload["reference_images"]) {
  const stored: Uint8Array[] = [];
  const store = async ({ bytes }: { bytes: Uint8Array }) => {
    stored.push(bytes);
    return `stored-${bytes[0]}`;
  };
  const graph = await fillWorkflow(workflow(inputs), { ...payload, reference_images }, 7, store, "1k");
  return { inputs: graph["1"]!.inputs, stored };
}

test("references are reached by role and position", async () => {
  const { inputs } = await withReferences(
    {
      first: "{{npc_1}}",
      second: "{{npc_2}}",
      scene: "{{previous_scene}}",
      pc: "{{pc}}",
      any: "{{reference_3}}",
    },
    cast,
  );

  expect(inputs).toMatchObject({ first: "stored-1", second: "stored-2", scene: "stored-3", pc: "stored-4", any: "stored-3" });
});

test("references past the workflow's slots aren't uploaded", async () => {
  const { stored } = await withReferences({ one: "{{npc_1}}" }, cast);

  expect(stored).toEqual([Uint8Array.of(1)]);
});

test("a slot with no image this time gets the blank image and its switch says so", async () => {
  const { inputs, stored } = await withReferences({ image: "{{npc_2}}", weight: "{{has_npc_2}}", there: "{{has_npc_1}}" }, [image("npc", 1)]);

  expect(inputs).toMatchObject({ weight: 0, there: 1 });
  expect(stored).toHaveLength(1);
  expect(Buffer.from(stored[0]!).subarray(1, 4).toString()).toBe("PNG");
  // VAEEncode trims to multiples of 8, so a smaller blank would leave it nothing.
  expect(Buffer.from(stored[0]!).readUInt32BE(16)).toBe(64);
});

test("a workflow that only asks whether a reference exists uploads nothing", async () => {
  expect((await withReferences({ on: "{{has_pc}}" }, cast)).stored).toEqual([]);
});
