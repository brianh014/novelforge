import { expect, test } from "bun:test";
import { assemblePrompt } from "../src/prompt-assembler";
import { applyEdit, applyOperations, openingState, type State, type StateOperation } from "../src/state-applier";

const at = (storyTime: State["storyTime"]) => ({ ...structuredClone(openingState), storyTime });
const set = (days_passed: number, date: string | null, time_of_day: string): StateOperation => ({ op: "set_story_time", days_passed, date, time_of_day });
const DUSK = { day: 3, date: "3rd of Lowtide", timeOfDay: "dusk" };

test("time passing within a day keeps the date and the day count", () => {
  expect(applyOperations(at(DUSK), [set(0, null, "night")]).next.storyTime).toEqual({ ...DUSK, timeOfDay: "night" });
});

test("days passing add to the day count, with the new date the Narrator worked out", () => {
  expect(applyOperations(at(DUSK), [set(2, "5th of Lowtide", "dawn")]).next.storyTime).toEqual({ day: 5, date: "5th of Lowtide", timeOfDay: "dawn" });
});

test("a new day with no date, or a first Story Time with none, is ignored and changes nothing", () => {
  for (const [state, operation] of [
    [at(DUSK), set(1, null, "dawn")],
    [at(null), set(0, null, "dawn")],
  ] as const) {
    const { next, refused, ignored } = applyOperations(state, [operation]);
    expect(next.storyTime).toEqual(state.storyTime);
    expect(refused).toEqual([]);
    expect(ignored).toEqual([{ op: "set_story_time", reason: "no date" }]);
  }
});

test("a Save from before Story Time starts counting from day 1", () => {
  expect(applyOperations(at(null), [set(0, "3rd of Lowtide", "dusk")]).next.storyTime).toEqual({ day: 1, date: "3rd of Lowtide", timeOfDay: "dusk" });
});

test("the player's edit changes the date and time of day, never the day count", () => {
  expect(applyEdit(at(DUSK), { edit: "storyTime", date: "9th of Lowtide", timeOfDay: "noon" }).storyTime).toEqual({
    day: 3,
    date: "9th of Lowtide",
    timeOfDay: "noon",
  });
});

const prompt = (storyTime: State["storyTime"], played: boolean) =>
  assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: at(storyTime),
    messages: played
      ? [
          { id: 1, role: "player", text: "I wait." },
          { id: 2, role: "narrator", text: "Rain." },
        ]
      : [],
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  })
    .map(({ content }) => content)
    .join("\n");

test("the Narrator is asked to set a missing Story Time only in a story already under way", () => {
  expect(prompt(null, true)).toContain("storyTime is null, so set it now");
  expect(prompt(null, false)).not.toContain("storyTime is null");
  expect(prompt(DUSK, true)).not.toContain("storyTime is null");
  expect(prompt(DUSK, true)).toContain('"storyTime":{"day":3,"date":"3rd of Lowtide","timeOfDay":"dusk"}');
});
