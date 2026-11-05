import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { narration, scriptedTextProvider, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;
let prompts: ReturnType<typeof scriptedTextProvider>["prompts"];

const play = (...replies: string[]) => {
  const provider = scriptedTextProvider(...replies);
  prompts = provider.prompts;
  game = startGame(join(folder.path, "Saves"), provider.textProvider);
};

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await game.stop();
  folder.remove();
});

const summed = (summary: unknown, ...state_operations: object[]) =>
  JSON.stringify({ check: null, narration: "Rain.", state_operations, summary, scene_changed: false, visual_description: "" });

const summaryOf = async (id: string) => ((await game.get(`/saves/${id}/journal`).then((r) => r.json())) as { summary: string }).summary;
const playTurn = (id: string) => game.post(`/saves/${id}/turns`, { input: "I wait." });
const lastSystem = () => prompts.at(-1)!.findLast(({ role }) => role === "system")!.content as string;

test("each finished Turn's summary becomes the story's, over any set_summary", async () => {
  play(summed("Ash reached the docks."), summed("Ash left the docks.", { op: "set_summary", summary: "An older idea." }));
  const id = await game.createSave();

  await playTurn(id);
  expect(await summaryOf(id)).toBe("Ash reached the docks.");
  await playTurn(id);

  expect(await summaryOf(id)).toBe("Ash left the docks.");
});

for (const [label, missing] of [
  ["blank", "  "],
  ["malformed", 7],
  ["null", null],
] as const) {
  test(`a ${label} summary leaves the story's as it was, and doesn't cost the Turn`, async () => {
    play(summed("Ash reached the docks."), summed(missing));
    const id = await game.createSave();
    await playTurn(id);

    const response = await playTurn(id);

    expect(response.status).toBe(201);
    expect(await summaryOf(id)).toBe("Ash reached the docks.");
  });
}

test("a Narrator that sends no summary still gets to set one by operation", async () => {
  play(narration("Rain.", { op: "set_summary", summary: "It rained." }));
  const id = await game.createSave();

  await playTurn(id);

  expect(await summaryOf(id)).toBe("It rained.");
});

test("the last word before the player's action keeps the PC's choices theirs and their thoughts private", async () => {
  play(narration("Rain."));
  const id = await game.createSave();

  await playTurn(id);

  expect(lastSystem()).toContain("The player alone decides what the PC says, chooses and does");
  expect(lastSystem()).toContain("private thought");
});

test("every eighth response brings the next Plot Thread forward, by turns", async () => {
  const threads = [{ op: "add_plot_thread", thread: "THREAD-ONE" }, { op: "add_plot_thread", thread: "THREAD-TWO" }];
  play(narration("Rain.", ...threads), ...Array(16).fill(narration("Rain.")));
  const id = await game.createSave();

  const asked: string[] = [];
  for (let turn = 0; turn < 17; turn++) {
    await playTurn(id);
    const nudge = lastSystem().match(/Bring this Plot Thread into play.*(THREAD-\w+)/s);
    if (nudge) asked.push(`${turn}:${nudge[1]}`);
  }

  // A Turn sees the responses before it, so the eighth response has been told by the ninth Turn, numbered 8 here.
  expect(asked).toEqual(["8:THREAD-ONE", "16:THREAD-TWO"]);
});

test("a story with no Plot Threads gets no nudge", async () => {
  play(...Array(9).fill(narration("Rain.")));
  const id = await game.createSave();

  for (let turn = 0; turn < 9; turn++) await playTurn(id);

  expect(lastSystem()).not.toContain("Bring this Plot Thread into play");
});
