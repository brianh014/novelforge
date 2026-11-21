import { expect, test } from "bun:test";
import { promptStyle } from "../src/graph-builder";
import { chestUp, expandMarks, markNames, portraitsDue, restyledBy } from "../src/image-pipeline";
import { assemblePrompt, IN_ITS_WORLD_AND_STYLE, REQUESTED_IMAGE_PROMPT } from "../src/prompt-assembler";
import { applyOperations, openingState } from "../src/state-applier";

const npcs = [
  { name: "Hesper", appearance: "a tall woman in oilskins" },
  { name: "Orin", appearance: "" },
];
const pc = "Ash Vane";

test("a mark gets the skin, hair and beard of someone's looks that its phrase leaves out, once, and nothing else of them", () => {
  const vik = { name: "Vik", appearance: "a big man with fair skin, a ragged blond beard and frostbitten fingers, in a torn smock" };

  expect(expandMarks("[Vik: a gaunt bearded man in a grey coat] stops. [Vik] waves.", [vik], pc, ["Vik"]).prompt).toBe(
    "the person from image 1, a gaunt bearded man in a grey coat, fair skin, a ragged blond beard, stops. the same person waves.",
  );
  expect(expandMarks("[Vik: a man with fair skin and a ragged blond beard] stops.", [vik], pc).prompt).toBe(
    "a man with fair skin and a ragged blond beard stops.",
  );
});

test("each mark becomes the Narrator's own phrase, beside what they do, and says who is pictured", () => {
  expect(expandMarks("[Hesper: a tall woman in black] waves at [Ash Vane: a short man with a tin badge] on the quay", npcs, pc)).toEqual({
    prompt: "a tall woman in black waves at a short man with a tin badge on the quay",
    pictured: ["Hesper", null],
  });
});

test("a sentence the Narrator repeats goes in once", () => {
  const likeness = "The people are the same people.";
  const looped = `[Hesper: a tall woman] waves. Fog fills the yard. {${likeness}} ${likeness} ${likeness}`;
  expect(expandMarks(looped, npcs, pc, ["Hesper"]).prompt).toBe(`the person from image 1, a tall woman, waves. Fog fills the yard. ${likeness}`);
});

test("anything written after the closing likeness sentence is cut", () => {
  expect(expandMarks("[Hesper: a tall woman] waves. {The people are the same people.} Fill in all fields.", npcs, pc, ["Hesper"]).prompt).toBe(
    "the person from image 1, a tall woman, waves. The people are the same people.",
  );
  // However long, and with a brace of its own, as notes on the reply's fields and its length were drawn.
  for (const stray of [
    " | hidden_information: secret plot content | false | context=benign_fiction",
    " → make it ≤150 words: adjust.} → The prompt above is too long; trim.",
  ])
    expect(expandMarks(`[Hesper: a tall woman] waves. {The people are the same people.}${stray}`, npcs, pc, ["Hesper"]).prompt).toBe(
      "the person from image 1, a tall woman, waves. The people are the same people.",
    );
});

test("JSON written after the likeness sentence is cut", () => {
  const prompt = '[Hesper: a tall woman] waves. {The people are the same people.}\n{"location":"The net loft","visibleCast":["Hesper"]}';
  expect(expandMarks(prompt, npcs, pc, ["Hesper"]).prompt).toBe("the person from image 1, a tall woman, waves. The people are the same people.");
});

test("the PC can be marked by their first name", () => {
  expect(expandMarks("[Ash] sits", npcs, pc).pictured).toEqual([null]);
});

test("a person goes in once, and neither an unknown name nor a missing phrase reaches the model", () => {
  expect(expandMarks("[Hesper: a tall woman] turns, and [Hesper] sighs", npcs, pc)).toEqual({
    prompt: "a tall woman turns, and the same person sighs",
    pictured: ["Hesper"],
  });
  // A described mark after a bare one keeps its words, as "the same person" there was drawn as someone else.
  expect(expandMarks("[Orin: an old man] beckons [Hesper] in. [Hesper: a tall woman] sits", npcs, pc, ["Orin", "Hesper"]).prompt).toBe(
    "the person from image 1, an old man, beckons the person from image 2 in. the person from image 2, a tall woman, sits",
  );
  expect(expandMarks("[Tobin] waits", npcs, pc)).toEqual({ prompt: "a person waits", pictured: [] });
  expect(expandMarks("[Orin] waits", npcs, pc)).toEqual({ prompt: "a person waits", pictured: ["Orin"] });
});

test("part of a name finds someone only when it can mean nobody else", () => {
  const people = [
    { name: "Dana Reyes", appearance: "a woman in a grey blazer" },
    { name: "Woman with notebook", appearance: "a woman with a notebook" },
    { name: "Woman with mesh sleeve", appearance: "a woman in mesh" },
  ];
  expect(expandMarks("[Dana: a woman in grey] waits", people, pc)).toEqual({ prompt: "a woman in grey waits", pictured: ["Dana Reyes"] });
  expect(expandMarks("[dana reyes] waits", people, pc).pictured).toEqual(["Dana Reyes"]);
  expect(expandMarks("[Woman] waits", people, pc)).toEqual({ prompt: "a person waits", pictured: [] });
});

test("a person named without a mark is marked, so their portrait goes in and their name never reaches the model", () => {
  const written = "Ash Vane, a short man, waves at Hesper. Hesper's boat bobs. Ashore, [Orin: an old man] naps by Orin. {Keep each face.}";
  const marked = markNames(written, npcs, pc);
  expect(marked).toBe("[Ash Vane], a short man, waves at [Hesper]. Hesper's boat bobs. Ashore, [Orin: an old man] naps by [Orin]. {Keep each face.}");
  expect(expandMarks(marked, npcs, pc, [null, "Hesper"]).prompt).toBe(
    "the person from image 1, a short man, waves at the person from image 2. Hesper's boat bobs. Ashore, an old man naps by the same person. Keep each face.",
  );
  expect(markNames("Vane nods", npcs, pc)).toBe("[Vane] nods");
  // An article, a title or a place in someone's name is no name of its own.
  const titled = [
    { name: "The Ferryman", appearance: "" },
    { name: "Mira of Westhold", appearance: "" },
    { name: "Captain Rook", appearance: "" },
  ];
  expect(markNames("The harbour of Westhold, where the Captain waits for Rook and Mira", titled, pc)).toBe(
    "The harbour of Westhold, where the Captain waits for [Rook] and [Mira]",
  );
});

test("no stored looks are ever added, as the Narrator writes the whole prompt to its length", () => {
  expect(expandMarks("[Hesper: a tall woman in black] nods", npcs, pc).prompt).toBe("a tall woman in black nods");
  expect(expandMarks("[Tobin: a thin boy] sits", npcs, pc)).toEqual({ prompt: "a thin boy sits", pictured: [] });
});

test("each person with a portrait is pointed at their image by number, and the likeness sentence stays only then", () => {
  const prompt = "[Hesper: a tall woman] waves at [Ash: a short man] by [Orin: an old man]. {Keep each face.}";
  // The PC's portrait goes first, so Ash is image 1 though marked second, and Orin has no portrait.
  expect(expandMarks(prompt, npcs, pc, [null, "Hesper"]).prompt).toBe(
    "the person from image 2, a tall woman, waves at the person from image 1, a short man, by an old man. Keep each face.",
  );
  expect(expandMarks(prompt, npcs, pc).prompt).toBe("a tall woman waves at a short man by an old man.");
  expect(expandMarks("They wave at [Hesper: a tall woman].", npcs, pc, ["Hesper"]).prompt).toBe("They wave at the person from image 1, a tall woman.");
  // Models sometimes leave off the closing brace at the end.
  expect(expandMarks("[Hesper: a tall woman] waves. {Keep each face.", npcs, pc).prompt).toBe("a tall woman waves.");
  expect(expandMarks("[Hesper: a tall woman] waves. {Keep each face.", npcs, pc, ["Hesper"]).prompt).toBe(
    "the person from image 1, a tall woman, waves. Keep each face.",
  );
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

test("the Narrator ends with a likeness sentence in braces, which asks to keep each face but not the portrait's clothing", () => {
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("end the prompt with one short sentence in curly braces");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("the same people with their faces preserved");
});

test("an Image Prompt puts each person once in what they do, keeps props plain and sized, and holds to a real era", () => {
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("Make each mark the subject of the sentence that says what that person does");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("never in a list of who is there");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("keep their hands empty otherwise");
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain(
    "Picture only people physically there at this moment, as the narration has it, and at most three, leaving anyone else out of view.",
  );
  expect(REQUESTED_IMAGE_PROMPT.prose).toContain("say plainly where each body is, where each one's arms go and where each head is");
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

test("someone's looks keep what lasts, not what they hold or where they are, and only a change a portrait shows redraws it", () => {
  const coat = "a broad man in his fifties with a grey moustache, in a dark blue coat";
  const before = { ...openingState, npcs: [{ name: "Price", appearance: coat }] };
  const passing = `${coat}, hat in hand, gone out into the rain, kneeling at the hearth, a lamp held high`;
  const { next } = applyOperations(before, [{ op: "update_npc", name: "Price", appearance: passing }]);
  expect(next.npcs[0]!.appearance).toBe(coat);
  // Soot on his wrists is below a portrait's frame, so it draws nothing new.
  const sooty = applyOperations(before, [{ op: "update_npc", name: "Price", appearance: `${coat}, soot to the wrists` }]).next;
  expect(sooty.npcs[0]!.appearance).toBe(`${coat}, soot to the wrists`);
  expect(restyledBy(before, sooty)).toEqual([]);
  const scarred = applyOperations(before, [{ op: "update_npc", name: "Price", appearance: `${coat}, a fresh scar on his cheek` }]).next;
  expect(restyledBy(before, scarred)).toEqual([scarred.npcs[0]!]);
});

test("someone's looks keep no weather, dust or thing carried, which pass with the scene", () => {
  const coat = "a broad man in his fifties with a grey moustache, in a dark blue coat";
  const before = { ...openingState, npcs: [{ name: "Price", appearance: coat }] };
  const passing = `${coat}, rain-dark shoulders, boots grey with road dust, a ledger carried hard against his ribs, soaked through, hair dripping, barefoot`;
  const { next } = applyOperations(before, [{ op: "update_npc", name: "Price", appearance: passing }]);
  expect(next.npcs[0]!.appearance).toBe(coat);
});

test("someone's looks keep no caked dirt, passing pallor, bonds or garment taken off and put down, but keep what they wear", () => {
  const coat = "a broad man in his fifties with a grey moustache, in a dark blue coat";
  const before = { ...openingState, npcs: [{ name: "Price", appearance: coat }] };
  const passing = `${coat}, heavy boots caked at the treads with pale sand, drained grey now, his wrists bound before him with rope, coat off and folded over a barrel, his hat left below on a chair`;
  const { next } = applyOperations(before, [{ op: "update_npc", name: "Price", appearance: passing }]);
  expect(next.npcs[0]!.appearance).toBe(coat);
  // Nor what they carry on an arm, as "another man's coat under his arm" stayed in a constable's looks.
  const carried = `${coat}, and a stranger's black coat under his arm, a bundle tucked close, a shawl over one arm`;
  expect(applyOperations(before, [{ op: "update_npc", name: "Price", appearance: carried }]).next.npcs[0]!.appearance).toBe(coat);
  const lasting = `${coat}, hair tied back, a scar left on his cheek, an anchor inked on his arm`;
  expect(applyOperations(before, [{ op: "update_npc", name: "Price", appearance: lasting }]).next.npcs[0]!.appearance).toBe(lasting);
});

test("the era is set once, and a later set_era is ignored rather than failing the Turn, so pictures never drift", () => {
  const first = applyOperations(openingState, [{ op: "set_era", era: "early medieval Arabia" }]);
  const again = applyOperations(first.next, [{ op: "set_era", era: "1870s American West" }]);
  expect(again.next.era).toBe("early medieval Arabia");
  expect(again.refused).toEqual([]);
});

test("someone the story names as a body or corpse is given no portrait, as one drawn alive", () => {
  const living = { name: "Owen Price", appearance: "a broad constable" };
  const dead = [
    { name: "Tobias Crane's body", appearance: "a drowned man" },
    { name: "The corpse", appearance: "a still form" },
  ];
  const after = { ...openingState, npcs: [living, ...dead], scene: { location: "The loft", visibleCast: ["Owen Price", "Tobias Crane's body", "The corpse"] } };

  expect(portraitsDue(openingState, after)).toEqual([living]);
});

test("someone whose own Lore Entry the world keys as a body is given no portrait, though named plainly", () => {
  const living = { name: "Owen Price", appearance: "a broad constable" };
  const drowned = { name: "Tobias Crane", appearance: "a lean old man, soaked" };
  const worldBible = [{ title: "Tobias Crane", keywords: ["Crane", "body"], content: "The harbourmaster.", alwaysOn: false }];
  const after = { ...openingState, worldBible, npcs: [living, drowned], scene: { location: "The loft", visibleCast: ["Owen Price", "Tobias Crane"] } };

  expect(portraitsDue(openingState, after)).toEqual([living]);
});

test("someone known and heard from out of view is due no portrait again each Turn, but is on coming into view", () => {
  const voice = { name: "Owen Price", appearance: "a broad constable" };
  const known = { ...openingState, npcs: [voice], pcKnown: { facts: [], npcs: ["Owen Price"] }, scene: { location: "The loft", visibleCast: [] } };

  expect(portraitsDue(known, known, ["Owen Price"])).toEqual([]);
  expect(portraitsDue(known, { ...known, scene: { location: "The loft", visibleCast: ["Owen Price"] } })).toEqual([voice]);
});
