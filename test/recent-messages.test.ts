import { expect, test } from "bun:test";
import { assemblePrompt, memoryDue } from "../src/prompt-assembler";
import type { Message } from "../src/save-store";
import { openingState } from "../src/state-applier";

const story = (count: number): Message[] =>
  Array.from({ length: count }, (_, index) => ({ id: index + 1, role: index % 2 ? "narrator" : "player", text: `Message ${index + 1}.` }));

// Past every Message, as in a Save upgraded with more than its window, so nothing before the window is held back for a memory.
const sent = (messages: Message[], windowMessages?: number) =>
  assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: structuredClone(openingState),
    messages,
    memoryStart: 1000,
    windowMessages,
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  }).filter(({ role }) => role !== "system").length - 1;

test("Settings' recent Messages decide how many are sent in full, with 80 for a Save that has none", () => {
  expect(sent(story(120))).toBe(80);
  expect(sent(story(120), 40)).toBe(40);
  expect(sent(story(120), 200)).toBe(120);
});

test("a memory falls due once the window reaches the number in Settings, covering its oldest 20", () => {
  expect(memoryDue(story(60), [], 0, 80)).toBeNull();
  expect(memoryDue(story(60), [], 0, 40)).toEqual({ firstMessage: 1, lastMessage: 20 });
  // Made smaller after memories were written: the next batch is due at once, one a Turn, until the window fits.
  expect(memoryDue(story(100), [{ firstMessage: 1, lastMessage: 20, text: "Earlier." }], 0, 40)).toEqual({ firstMessage: 21, lastMessage: 40 });
});
