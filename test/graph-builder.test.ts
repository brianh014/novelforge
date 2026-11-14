import { expect, test } from "bun:test";
import { buildGraph, type GraphChoices, type GraphRequest, type Graph, switchFamily, usableReferences, usesPortraits } from "../src/graph-builder";

const sd: GraphChoices = {
  comfyFamily: "sd",
  comfySdBase: "sdxl",
  imageResolution: "1k",
  comfyCheckpoint: "dream.safetensors",
  comfyDiffusionModel: "",
  comfyTextEncoder: "",
  comfyVae: "",
  comfyLoras: [],
  comfySteps: null,
  comfyCfg: null,
  comfyDefaults: true,
  comfySampler: "",
  comfyScheduler: "",
};
const flux2: GraphChoices = {
  ...sd,
  comfyFamily: "flux2",
  comfyDiffusionModel: "flux2_dev.safetensors",
  comfyTextEncoder: "mistral_3.safetensors",
  comfyVae: "flux2-vae.safetensors",
};
const request: GraphRequest = {
  prompt: "A harbour at dusk",
  negative_prompt: "text, dice",
  aspect_ratio: "16:9",
  style_preset: "Ink wash",
  references: [],
  seed: 77,
};

/** The only node of a class, so a test reads the wiring rather than the ids. */
const only = (graph: Graph, classType: string) => {
  const found = all(graph, classType);
  expect(found).toHaveLength(1);
  return found[0]!;
};
const all = (graph: Graph, classType: string) => Object.values(graph).filter((node) => node.class_type === classType);
/** The node an input is wired to. */
const source = (graph: Graph, link: unknown) => graph[(link as [string, number])[0]]!;
const slot = (link: unknown) => (link as [string, number])[1];

test("SD draws from an empty latent with the checkpoint's own model, CLIP and VAE, at SDXL's size", () => {
  const graph = buildGraph(sd, request);

  expect(only(graph, "CheckpointLoaderSimple").inputs).toEqual({ ckpt_name: "dream.safetensors" });
  const sampler = only(graph, "KSampler");
  expect(sampler.inputs).toMatchObject({ seed: 77, denoise: 1 });
  expect(source(graph, sampler.inputs.model).class_type).toBe("CheckpointLoaderSimple");
  expect(slot(sampler.inputs.model)).toBe(0);

  const positive = source(graph, sampler.inputs.positive);
  const negative = source(graph, sampler.inputs.negative);
  expect(positive.inputs.text).toBe("Ink wash\nA harbour at dusk");
  expect(negative.inputs.text).toBe("text, dice");
  expect(source(graph, positive.inputs.clip).class_type).toBe("CheckpointLoaderSimple");
  expect(slot(positive.inputs.clip)).toBe(1);

  const latent = source(graph, sampler.inputs.latent_image);
  expect(latent).toEqual({ class_type: "EmptyLatentImage", inputs: { width: 1360, height: 768, batch_size: 1 } });

  const decode = only(graph, "VAEDecode");
  expect(source(graph, decode.inputs.samples).class_type).toBe("KSampler");
  expect(slot(decode.inputs.vae)).toBe(2);
  expect(source(graph, only(graph, "PreviewImage").inputs.images).class_type).toBe("VAEDecode");
});

test.each([
  ["0.5k", "16:9", 688, 384],
  ["1k", "16:9", 1360, 768],
  ["1.5k", "16:9", 2048, 1152],
  ["2k", "16:9", 2736, 1536],
  ["1k", "1:1", 1024, 1024],
] as const)("%s at %s is %i by %i, whichever the family", (imageResolution, aspect_ratio, width, height) => {
  const graph = buildGraph({ ...sd, imageResolution }, { ...request, aspect_ratio });
  const flux = buildGraph({ ...flux2, imageResolution }, { ...request, aspect_ratio });

  expect(only(graph, "EmptyLatentImage").inputs).toMatchObject({ width, height });
  expect(only(flux, "EmptyFlux2LatentImage").inputs).toMatchObject({ width, height });
});

test("the Checkpoint type doesn't change the size", () => {
  const graph = buildGraph({ ...sd, comfySdBase: "sd15" }, request);

  expect(only(graph, "EmptyLatentImage").inputs).toMatchObject({ width: 1360, height: 768 });
});

test("SD uses the previous Scene Image through img2img, at the output size and part denoised", () => {
  const graph = buildGraph(sd, { ...request, references: ["scene.png [temp]"] });

  const sampler = only(graph, "KSampler");
  expect(sampler.inputs.denoise).toBeGreaterThan(0);
  expect(sampler.inputs.denoise).toBeLessThan(1);
  expect(all(graph, "EmptyLatentImage")).toEqual([]);

  const encode = source(graph, sampler.inputs.latent_image);
  expect(encode.class_type).toBe("VAEEncode");
  expect(slot(encode.inputs.vae)).toBe(2);
  const scale = source(graph, encode.inputs.pixels);
  expect(scale).toMatchObject({ class_type: "ImageScale", inputs: { width: 1360, height: 768, crop: "center" } });
  expect(source(graph, scale.inputs.image)).toEqual({ class_type: "LoadImage", inputs: { image: "scene.png [temp]" } });
});

test("SD LoRAs chain in order through both the model and CLIP, and trigger words open the prompt", () => {
  const graph = buildGraph(
    {
      ...sd,
      comfyLoras: [
        { name: "ink.safetensors", strength: 0.8, triggerWords: "inkstyle" },
        { name: "sea.safetensors", strength: 0.5, triggerWords: "" },
        { name: "salt.safetensors", strength: 1, triggerWords: "salt crust" },
      ],
    },
    request,
  );

  const sampler = only(graph, "KSampler");
  const last = source(graph, sampler.inputs.model);
  expect(last).toMatchObject({
    class_type: "LoraLoader",
    inputs: { lora_name: "salt.safetensors", strength_model: 1, strength_clip: 1 },
  });
  const middle = source(graph, last.inputs.model);
  expect(middle.inputs).toMatchObject({ lora_name: "sea.safetensors", strength_model: 0.5, strength_clip: 0.5 });
  expect(source(graph, last.inputs.clip)).toBe(middle);
  expect(slot(last.inputs.clip)).toBe(1);
  const first = source(graph, middle.inputs.model);
  expect(first.inputs).toMatchObject({ lora_name: "ink.safetensors", strength_model: 0.8 });
  expect(source(graph, first.inputs.model).class_type).toBe("CheckpointLoaderSimple");
  expect(source(graph, first.inputs.clip).class_type).toBe("CheckpointLoaderSimple");

  const positive = source(graph, sampler.inputs.positive);
  expect(positive.inputs.text).toBe("inkstyle, salt crust\nInk wash\nA harbour at dusk");
  expect(source(graph, positive.inputs.clip)).toBe(last);
  expect(source(graph, source(graph, sampler.inputs.negative).inputs.clip)).toBe(last);
});

test("FLUX.2 wires ComfyUI's own recipe, with no negative prompt as its guider has none", () => {
  const graph = buildGraph(flux2, request);

  expect(only(graph, "UNETLoader").inputs).toEqual({ unet_name: "flux2_dev.safetensors", weight_dtype: "default" });
  expect(only(graph, "CLIPLoader").inputs).toEqual({ clip_name: "mistral_3.safetensors", type: "flux2", device: "default" });
  expect(only(graph, "VAELoader").inputs).toEqual({ vae_name: "flux2-vae.safetensors" });

  const sampler = only(graph, "SamplerCustomAdvanced");
  expect(source(graph, sampler.inputs.noise)).toEqual({ class_type: "RandomNoise", inputs: { noise_seed: 77 } });
  expect(source(graph, sampler.inputs.sampler)).toEqual({ class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } });
  expect(source(graph, sampler.inputs.sigmas)).toEqual({
    class_type: "Flux2Scheduler",
    inputs: { steps: 20, width: 1360, height: 768 },
  });
  expect(source(graph, sampler.inputs.latent_image)).toEqual({
    class_type: "EmptyFlux2LatentImage",
    inputs: { width: 1360, height: 768, batch_size: 1 },
  });

  const guider = source(graph, sampler.inputs.guider);
  expect(guider.class_type).toBe("BasicGuider");
  expect(source(graph, guider.inputs.model).class_type).toBe("UNETLoader");
  const guidance = source(graph, guider.inputs.conditioning);
  expect(guidance).toMatchObject({ class_type: "FluxGuidance", inputs: { guidance: 4 } });
  const text = source(graph, guidance.inputs.conditioning);
  expect(text.inputs.text).toBe("A harbour at dusk\nInk wash");
  expect(source(graph, text.inputs.clip).class_type).toBe("CLIPLoader");

  const decode = only(graph, "VAEDecode");
  expect(source(graph, decode.inputs.samples).class_type).toBe("SamplerCustomAdvanced");
  expect(slot(decode.inputs.samples)).toBe(0);
  expect(source(graph, decode.inputs.vae).class_type).toBe("VAELoader");
  expect(source(graph, only(graph, "PreviewImage").inputs.images).class_type).toBe("VAEDecode");
  expect(JSON.stringify(graph)).not.toContain("text, dice");
});

test("FLUX.2 chains a ReferenceLatent per reference, each loaded, scaled and encoded with the VAE", () => {
  const graph = buildGraph(flux2, { ...request, references: ["npc.png [temp]", "scene.png [temp]"] });

  const guider = only(graph, "BasicGuider");
  const outer = source(graph, guider.inputs.conditioning);
  const inner = source(graph, outer.inputs.conditioning);
  expect([outer.class_type, inner.class_type]).toEqual(["ReferenceLatent", "ReferenceLatent"]);
  expect(source(graph, inner.inputs.conditioning).class_type).toBe("FluxGuidance");

  const loaded = (node: Graph[string]) => {
    const encode = source(graph, node.inputs.latent);
    expect(encode.class_type).toBe("VAEEncode");
    expect(source(graph, encode.inputs.vae).class_type).toBe("VAELoader");
    const scale = source(graph, encode.inputs.pixels);
    expect(scale).toMatchObject({
      class_type: "ImageScaleToTotalPixels",
      inputs: { upscale_method: "lanczos", megapixels: 1, resolution_steps: 1 },
    });
    return source(graph, scale.inputs.image).inputs.image;
  };
  expect([loaded(inner), loaded(outer)]).toEqual(["npc.png [temp]", "scene.png [temp]"]);
});

test("FLUX.2 LoRAs chain on the model only, and trigger words open the prompt", () => {
  const graph = buildGraph(
    {
      ...flux2,
      comfyLoras: [
        { name: "ink.safetensors", strength: 0.8, triggerWords: "inkstyle" },
        { name: "sea.safetensors", strength: 0.5, triggerWords: "" },
      ],
    },
    request,
  );

  const last = source(graph, only(graph, "BasicGuider").inputs.model);
  expect(last).toMatchObject({
    class_type: "LoraLoaderModelOnly",
    inputs: { lora_name: "sea.safetensors", strength_model: 0.5 },
  });
  const first = source(graph, last.inputs.model);
  expect(first.inputs).toMatchObject({ lora_name: "ink.safetensors", strength_model: 0.8 });
  expect(source(graph, first.inputs.model).class_type).toBe("UNETLoader");
  expect(only(graph, "CLIPTextEncode").inputs.text).toBe("inkstyle\nA harbour at dusk\nInk wash");
});

test("every link in a graph points at a node's real output", () => {
  const outputs: Record<string, number> = { CheckpointLoaderSimple: 3, LoadImage: 2, LoraLoader: 2, SamplerCustomAdvanced: 2 };
  const loras = [{ name: "ink.safetensors", strength: 1, triggerWords: "" }];
  for (const graph of [
    buildGraph({ ...sd, comfyLoras: loras }, { ...request, references: ["a.png [temp]"] }),
    buildGraph({ ...flux2, comfyLoras: loras }, { ...request, references: ["a.png [temp]", "b.png [temp]"] }),
  ]) {
    for (const node of Object.values(graph)) {
      for (const value of Object.values(node.inputs)) {
        if (!Array.isArray(value)) continue;
        expect(graph).toHaveProperty(value[0]);
        expect(value[1]).toBeLessThan(outputs[graph[value[0]]!.class_type] ?? 1);
      }
    }
  }
});

const image = (role: "npc" | "previous_scene" | "pc", mark: number) => ({
  role,
  bytes: Uint8Array.of(mark),
  mediaType: "image/png",
});

test("SD keeps only the previous Scene Image, so NPC and PC references are dropped", () => {
  const references = [image("npc", 1), image("previous_scene", 2), image("pc", 3)];

  expect(usableReferences(sd, references).map(({ role }) => role)).toEqual(["previous_scene"]);
  expect(usableReferences(sd, [image("npc", 1), image("pc", 3)])).toEqual([]);
});

test("FLUX.2 keeps the first ten references, in their order of priority", () => {
  const references = [...Array.from({ length: 11 }, (_, mark) => image("npc", mark)), image("pc", 99)];

  const kept = usableReferences(flux2, references);

  expect(kept).toHaveLength(10);
  expect(kept[9]!.bytes).toEqual(Uint8Array.of(9));
});

test("FLUX.2 Klein keeps the first four references, as BFL lists that as its limit", () => {
  const references = [...Array.from({ length: 4 }, (_, mark) => image("npc", mark)), image("pc", 99)];

  const kept = usableReferences({ ...flux2, comfyDiffusionModel: "flux-2-klein-9b.safetensors" }, references);

  expect(kept.map(({ bytes }) => bytes[0])).toEqual([0, 1, 2, 3]);
});

test("Klein 9B draws in 8 steps, and its base model and FLUX.2 Dev keep 20", () => {
  const steps = (comfyDiffusionModel: string) => only(buildGraph({ ...flux2, comfyDiffusionModel }, request), "Flux2Scheduler").inputs.steps;

  expect(steps("flux-2-klein-9b.safetensors")).toBe(8);
  expect(steps("flux-2-klein-9b-Q4_K_M.gguf")).toBe(8);
  expect(steps("flux-2-klein-base-9b.safetensors")).toBe(20);
  expect(steps("flux2_dev_fp8mixed.safetensors")).toBe(20);
});

test("the player's steps and CFG replace the family's defaults", () => {
  const own = { comfyDefaults: false, comfySteps: 6, comfyCfg: 1.5, comfySampler: "euler_a", comfyScheduler: "simple" };
  expect(only(buildGraph({ ...sd, ...own }, request), "KSampler").inputs).toMatchObject({ steps: 6, cfg: 1.5, sampler_name: "euler_a", scheduler: "simple" });
  expect(only(buildGraph(sd, request), "KSampler").inputs).toMatchObject({ steps: 25, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras" });
  // With the defaults on, what the player typed is kept but not drawn with.
  expect(only(buildGraph({ ...sd, ...own, comfyDefaults: true }, request), "KSampler").inputs).toMatchObject({ steps: 25, cfg: 7 });

  const klein = { ...flux2, comfyDiffusionModel: "flux-2-klein-9b.safetensors", comfyDefaults: false, comfySteps: 4 };
  expect(only(buildGraph(klein, request), "Flux2Scheduler").inputs.steps).toBe(4);
  const named = buildGraph({ ...klein, comfySampler: "dpmpp_2m", comfyScheduler: "beta" }, request);
  expect(only(named, "BasicScheduler").inputs).toMatchObject({ scheduler: "beta", steps: 4, denoise: 1 });
  expect(only(named, "KSamplerSelect").inputs).toEqual({ sampler_name: "dpmpp_2m" });
  expect(all(named, "Flux2Scheduler")).toHaveLength(0);
});

const qwen21: GraphChoices = {
  ...flux2,
  comfyFamily: "qwen21",
  comfyDiffusionModel: "qwen_image_2.1_turbo_int8_convrot.safetensors",
  comfyTextEncoder: "qwen3vl_8b_int8_convrot.safetensors",
  comfyVae: "qwen_image_2.1_vae_bf16.safetensors",
};

test("Qwen Image 2.1 wires ComfyUI's Turbo template, at the request's size in multiples of 32", () => {
  const graph = buildGraph(qwen21, request);

  expect(only(graph, "CLIPLoader").inputs).toEqual({ clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image", device: "default" });
  const sampler = only(graph, "SamplerCustomAdvanced");
  expect(source(graph, sampler.inputs.noise).inputs).toEqual({ noise_seed: 77 });
  expect(source(graph, sampler.inputs.sampler).inputs).toEqual({ sampler_name: "euler" });
  expect(source(graph, sampler.inputs.sigmas)).toEqual({
    class_type: "ManualSigmas",
    inputs: { sigmas: "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0" },
  });
  expect(source(graph, sampler.inputs.latent_image)).toEqual({
    class_type: "EmptyLatentImage",
    inputs: { width: 1376, height: 768, batch_size: 1 },
  });

  const guider = source(graph, sampler.inputs.guider);
  expect(guider).toMatchObject({ class_type: "CFGGuider", inputs: { cfg: 1 } });
  expect(source(graph, guider.inputs.model).class_type).toBe("UNETLoader");
  expect([slot(guider.inputs.positive), slot(guider.inputs.negative)]).toEqual([0, 1]);
  const encode = source(graph, guider.inputs.positive);
  expect(source(graph, guider.inputs.negative)).toBe(encode);
  expect(encode).toMatchObject({
    class_type: "TextEncodeQwenImage21",
    inputs: { prompt: "A harbour at dusk\nInk wash", negative_prompt: "text, dice", resolution: 1024 },
  });
  expect(source(graph, encode.inputs.vae).class_type).toBe("VAELoader");
  expect(source(graph, only(graph, "VAEDecode").inputs.samples).class_type).toBe("SamplerCustomAdvanced");
});

test("Qwen Image 2.1 gives its encoder each reference in order, and a set Steps uses a scheduler", () => {
  const graph = buildGraph({ ...qwen21, comfyDefaults: false, comfySteps: 25, comfyCfg: 4 }, { ...request, references: ["pc.png [temp]", "npc.png [temp]"] });

  const encode = only(graph, "TextEncodeQwenImage21");
  expect([encode.inputs["images.image_1"], encode.inputs["images.image_2"]].map((link) => source(graph, link).inputs.image)).toEqual([
    "pc.png [temp]",
    "npc.png [temp]",
  ]);
  expect(only(graph, "BasicScheduler").inputs).toMatchObject({ scheduler: "simple", steps: 25, denoise: 1 });
  expect(all(graph, "ManualSigmas")).toHaveLength(0);
  expect(only(graph, "CFGGuider").inputs.cfg).toBe(4);
});

test("Qwen Image 2.1 keeps up to ten references and uses portraits", () => {
  const references = Array.from({ length: 12 }, (_, mark) => image("npc", mark));

  expect(usableReferences(qwen21, references)).toHaveLength(10);
  expect(usesPortraits({ imageProvider: "local", comfyMode: "simple", comfyFamily: "qwen21" })).toBe(true);
});

test("switching family keeps the old family's picks and brings back the new one's, or starts it empty", () => {
  const klein = { ...flux2, comfySteps: 8, comfyLoras: [{ name: "klein.safetensors", strength: 0.8, triggerWords: "" }], comfyFamilyPicks: {} };

  const toQwen = { ...klein, ...switchFamily(klein, "qwen21") };
  expect(toQwen).toMatchObject({ comfyFamily: "qwen21", comfyDiffusionModel: "", comfyVae: "", comfyLoras: [], comfySteps: null, comfyCfg: null });

  const picked = { ...toQwen, comfyDiffusionModel: "qwen.safetensors", comfyCfg: 1 };
  const back = { ...picked, ...switchFamily(picked, "flux2") };
  expect(back).toMatchObject({
    comfyFamily: "flux2",
    comfyDiffusionModel: "flux2_dev.safetensors",
    comfyTextEncoder: "mistral_3.safetensors",
    comfySteps: 8,
    comfyLoras: klein.comfyLoras,
  });

  expect({ ...back, ...switchFamily(back, "qwen21") }).toMatchObject({ comfyDiffusionModel: "qwen.safetensors", comfyCfg: 1 });
  expect(switchFamily(back, "flux2")).toEqual({});
});

test("Qwen Turbo's own schedule is drawn at 8 steps whether typed or left to the defaults, and any other count uses simple", () => {
  const custom = { ...qwen21, comfyDefaults: false, comfyCfg: 1, comfySampler: "euler" };

  expect(all(buildGraph({ ...custom, comfySteps: 8 }, request), "ManualSigmas")).toHaveLength(1);
  expect(only(buildGraph({ ...custom, comfySteps: 12 }, request), "BasicScheduler").inputs).toMatchObject({ scheduler: "simple", steps: 12 });
  expect(only(buildGraph({ ...custom, comfySteps: 8, comfyScheduler: "beta" }, request), "BasicScheduler").inputs).toMatchObject({ scheduler: "beta" });
});
