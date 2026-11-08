import { expect, test } from "bun:test";
import { promptStyle } from "../src/graph-builder";
import { chestUp, expandMarks, withReferenceRoles } from "../src/image-pipeline";
import { assemblePrompt, IN_ITS_WORLD_AND_STYLE, REQUESTED_IMAGE_PROMPT } from "../src/prompt-assembler";
import { openingState } from "../src/state-applier";

const npcs = [
  { name: "Hesper", appearance: "a tall woman in oilskins" },
  { name: "Orin", appearance: "" },
];
const pc = { name: "Ash Vane", looks: "a short man, wearing a tin badge" };

test("each mark becomes that person's looks, beside what they do, and says who is pictured", () => {
  expect(expandMarks("[Hesper] waves at [Ash Vane] on the quay", npcs, pc)).toEqual({
    prompt: "a tall woman in oilskins waves at a short man, wearing a tin badge on the quay",
    pictured: ["Hesper", null],
  });
});

test("the PC can be marked by their first name", () => {
  expect(expandMarks("[Ash] sits", npcs, pc).pictured).toEqual([null]);
});

test("a person's looks go in once, and neither an unknown name nor missing looks reach the model", () => {
  expect(expandMarks("[Hesper] turns, and [Hesper] sighs", npcs, pc)).toEqual({
    prompt: "a tall woman in oilskins turns, and the same person sighs",
    pictured: ["Hesper"],
  });
  expect(expandMarks("[Tobin] waits", npcs, pc)).toEqual({ prompt: "a person waits", pictured: [] });
  expect(expandMarks("[Orin] waits", npcs, pc)).toEqual({ prompt: "a person waits", pictured: ["Orin"] });
});

test("part of a name finds someone only when it can mean nobody else", () => {
  const people = [
    { name: "Dana Reyes", appearance: "a woman in a grey blazer" },
    { name: "Woman with notebook", appearance: "a woman with a notebook" },
    { name: "Woman with mesh sleeve", appearance: "a woman in mesh" },
  ];
  expect(expandMarks("[Dana] waits", people, pc)).toEqual({ prompt: "a woman in a grey blazer waits", pictured: ["Dana Reyes"] });
  expect(expandMarks("[dana reyes] waits", people, pc).pictured).toEqual(["Dana Reyes"]);
  expect(expandMarks("[Woman] waits", people, pc)).toEqual({ prompt: "a person waits", pictured: [] });
});

test("someone with a reference keeps the short phrase, and anyone else gets their stored looks", () => {
  const text = "[Hesper: a tall woman in black] nods";
  expect(expandMarks(text, npcs, pc, () => true).prompt).toBe("a tall woman in black nods");
  expect(expandMarks(text, npcs, pc, () => false).prompt).toBe("a tall woman in oilskins nods");
});

test("looks too long for a prompt give way to the short phrase, and an unknown name keeps it", () => {
  const long = { name: "Ash Vane", looks: "word ".repeat(61) };
  expect(expandMarks("[Ash: a short man] sits", npcs, long).prompt).toBe("a short man sits");
  expect(expandMarks("[Tobin: a thin boy] sits", npcs, pc)).toEqual({ prompt: "a thin boy sits", pictured: [] });
});

test.each([
  [{ imageProvider: "local", comfyMode: "simple", comfyFamily: "sd" }, "keywords"],
  [{ imageProvider: "local", comfyMode: "simple", comfyFamily: "flux2" }, "prose"],
  [{ imageProvider: "local", comfyMode: "advanced", comfyFamily: "sd" }, "prose"],
  [{ imageProvider: "openrouter", comfyMode: "simple", comfyFamily: "sd" }, "prose"],
] as const)("%o words its prompts as %s", (settings, style) => {
  expect(promptStyle(settings)).toBe(style);
});

const systemPrompt = (style: Parameters<typeof assemblePrompt>[0]["promptStyle"]) =>
  assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: openingState,
    messages: [],
    modelInstructions: "",
    input: "I look around.",
    responseSchema: "{}",
    promptStyle: style,
  })[0]!.content;

test("the Narrator is asked for a prompt in the Prompt Style, which stands alone and opens with the Art Style", () => {
  const prose = systemPrompt("prose");
  const keywords = systemPrompt("keywords");
  expect(prose).toContain("connected sentences");
  expect(prose).toContain("Mark each person you picture as [Name: phrase]");
  expect(keywords).toContain("comma-separated keyword phrases");
  expect(keywords).not.toContain("[Name: phrase]");
  for (const system of [prose, keywords]) {
    expect(system).toContain("someone who has never read it");
    expect(system).toContain("Open the prompt with the picture's art style");
    expect(system).toContain('"art_style":');
    expect(system).toContain("40 to 60 words");
  }
});

test("with images off the Narrator writes no prompt", () => {
  const system = systemPrompt(null);
  expect(system).toContain("Images are off");
  expect(system).not.toContain("connected sentences");
});

test("the image model is told the portraits are only for faces, so it copies no clothing from them", () => {
  expect(withReferenceRoles("A quay at dusk.", [])).toBe("A quay at dusk.");
  expect(withReferenceRoles("A quay at dusk", [{ role: "npc" }])).toBe("A quay at dusk. The portraits show only each person's face and hair: dress and pose everyone as written here.");
  expect(withReferenceRoles("A quay.", [{ role: "pc" }])).toContain("The portraits show only");
});

test("an Image Prompt puts each person once in what they do, keeps props plain and sized, and holds to a real era", () => {
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("Make each mark the subject of the sentence that says what that person does");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("never in a list of who is there");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("keep their hands empty otherwise");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("Picture at most four people and leave anyone else out of view.");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("Leave out poses where people carry, lift or hold each other or share a seat or a horse");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("each named plainly with its size, material and place");
  expect(IN_ITS_WORLD_AND_STYLE).toContain("Say which real era and region the place, buildings and clothing resemble");
  expect(IN_ITS_WORLD_AND_STYLE).toContain("in a world set before about 1600, such as an ancient or medieval one, never write coat");
  expect(IN_ITS_WORLD_AND_STYLE).toContain("or for a future or invented world which real styles it borrows from");
});

test("a portrait's template keeps only what a head and shoulders frame shows", () => {
  const seren =
    "a woman in her late twenties, gaunt and hollow-cheeked, with long dark hair, pale bare feet streaked with mud, swallowed in a hooded brown wool cloak, her wrists bound behind her back";
  expect(chestUp(seren)).toBe("a woman in her late twenties, gaunt and hollow-cheeked, with long dark hair, swallowed in a hooded brown wool cloak");
  expect(chestUp("a man with charms on a thong, in those clothes")).toBe("a man with charms on a thong, in those clothes");
});
