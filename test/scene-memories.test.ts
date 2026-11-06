import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { assemblePrompt, type Prompt } from "../src/prompt-assembler";
import { saveStore } from "../src/save-store";
import { openingState, StateOperation, type WorldUpdate } from "../src/state-applier";
import { logOf, narration, scriptedDice, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let app: ReturnType<typeof startApp>;
let prompts: Prompt[];

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await app?.stop();
  folder.remove();
});

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  prompts = script.prompts;
  app = startApp(savesDir, script.textProvider, scriptedDice(20));
};

const ASK = "set scene_memory now";
const SECRET = "ZQX-SECRET";
const MEMORY = "Ash reached the docks and Mara said the ferry had stopped.";
const remembering = (text: unknown, more: object = {}) => JSON.stringify({ narration: "Rain falls.", state_operations: [], scene_memory: text, ...more });

const store = () => saveStore(savesDir);
const createSave = () => store().create({ worldBrief: "A drowned city", pc: { name: "Ash" }, opening: { plotThreads: [`${SECRET} a plot.`] } });

/** Plays `turns` Turns straight into the store, as two Messages each, numbered so that a prompt can be searched for them. */
function seed(id: string, turns: number) {
  const saves = store();
  for (let turn = 0; turn < turns; turn++) saves.commitTurn(id, saves.latestMessageId(id), `Action ${turn}.`, `Reply ${turn}.`, undefined, (state) => state);
}
const seeded = (turns: number) => {
  const id = createSave();
  seed(id, turns);
  return id;
};

const turn = async (id: string, input = "I wait.") => {
  const response = await app.post(`/saves/${id}/turns`, { input });
  await response.text(); // The Turn streams, so it's only over when its body is.
  return response;
};
const memories = (id: string) => store().latestState(id).sceneMemories;
const messageIds = (id: string) => store().messages(id).map((message) => message.id);
const lastPrompt = () => prompts.at(-1)!.map(({ content }) => content).join("\n");
/** The Messages of the last prompt, not counting the Turn's own input. */
const window = () => prompts.at(-1)!.slice(1, -2);
const journal = async (id: string) => (await (await app.get(`/saves/${id}/journal`)).json()) as { sceneMemories: { firstMessage: number; lastMessage: number; text: string }[] };

/** Turns the Save back into one from before Scene Memories, as far as the code that reads it can tell. */
function downgrade(id: string) {
  using db = new Database(join(savesDir, `${id}.sqlite`));
  db.run("DELETE FROM snapshot_sections WHERE name = 'sceneMemories'; ALTER TABLE save DROP COLUMN memory_start; PRAGMA user_version = 14");
}

test("a new story starts with no Scene Memories", () => {
  expect(openingState.sceneMemories).toEqual([]);
});

test("a new story sends every Message and asks for nothing below 100", async () => {
  play(narration("Rain falls."));
  const id = seeded(49);

  await turn(id);

  expect(window()).toHaveLength(98);
  expect(lastPrompt()).toContain("Action 0.");
  expect(lastPrompt()).not.toContain(ASK);
  expect(lastPrompt()).toContain("Set scene_memory to null");
});

test("at 100 Messages the Turn asks for a memory of the oldest 20, with every Message still sent", async () => {
  play(narration("Rain falls."));
  const id = seeded(50);

  await turn(id);

  expect(window()).toHaveLength(100);
  expect(lastPrompt()).toContain("Action 0.");
  expect(lastPrompt()).toContain(ASK);
  expect(lastPrompt()).toContain("first 20 Messages above");
  expect(lastPrompt()).not.toContain("Set scene_memory to null");
});

test("a finished memory records the server's range and moves the window on", async () => {
  play(remembering(`  ${MEMORY}  `), narration("Rain falls."));
  const id = seeded(50);
  const ids = messageIds(id);

  await turn(id);
  await turn(id);

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: MEMORY }]);
  expect(window()).toHaveLength(82);
  expect(lastPrompt()).not.toContain("Reply 9.");
  expect(lastPrompt()).toContain("Action 10.");
  expect(lastPrompt()).not.toContain(ASK);
});

test("the next batch follows on from the last memory", async () => {
  play(remembering("First."), ...Array.from({ length: 9 }, () => narration("Rain falls.")), remembering("Second."));
  const id = seeded(50);
  const ids = messageIds(id);

  for (let count = 0; count < 11; count++) await turn(id);

  expect(memories(id).map(({ firstMessage, lastMessage }) => [firstMessage, lastMessage])).toEqual([
    [ids[0]!, ids[19]!],
    [ids[20]!, ids[39]!],
  ]);
});

for (const [missed, reply] of [
  ["omitted", narration("Rain falls.")],
  ["null", remembering(null)],
  ["empty", remembering("   ")],
  ["not text", remembering({ firstMessage: 1, lastMessage: 1, text: MEMORY })],
] as const) {
  test(`a memory that is ${missed} costs nothing, and the next Turn asks again with the same Messages`, async () => {
    play(reply, narration("Rain falls."));
    const id = seeded(50);

    expect((await turn(id)).status).toBe(201);
    await turn(id);

    expect(memories(id)).toEqual([]);
    expect(window()).toHaveLength(102);
    expect(lastPrompt()).toContain("Action 0.");
    expect(lastPrompt()).toContain(ASK);
  });
}

test("a Message never leaves through missed memories, however long the window grows", async () => {
  play(...Array.from({ length: 30 }, () => narration("Rain falls.")), remembering(MEMORY));
  const id = seeded(50);
  const first = messageIds(id).slice(0, 20);

  for (let count = 0; count < 31; count++) await turn(id);

  expect(prompts[30]!.slice(1, -2)).toHaveLength(160);
  expect(memories(id)).toEqual([{ firstMessage: first[0]!, lastMessage: first[19]!, text: MEMORY }]);
});

test("a memory nobody asked for is dropped", async () => {
  play(remembering(MEMORY));
  const id = seeded(3);

  await turn(id);

  expect(memories(id)).toEqual([]);
});

test("nothing the Narrator returns can set a range or change a stored memory", async () => {
  play(remembering(MEMORY, { first_message: 9999, firstMessage: 9999, lastMessage: 9999, range: [1, 2], scene_memories: [{ firstMessage: 1, lastMessage: 2, text: "Forged." }] }));
  const id = seeded(50);
  const ids = messageIds(id);

  await turn(id);

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: MEMORY }]);
  const operations = StateOperation.options.map((option) => option.shape.op.value);
  expect(operations.filter((op) => op.includes("memory"))).toEqual([]);
});

test("a Check request writes no memory, and the finished Turn after it does", async () => {
  play(remembering(MEMORY, { check: { action: "Leap", difficulty: "Easy" } }), remembering("After the leap."));
  const id = seeded(50);

  await turn(id);

  expect(memories(id).map(({ text }) => text)).toEqual(["After the leap."]);
});

test("a Regenerate replaces the memory its Turn wrote, over the same Messages", async () => {
  play(remembering("Old."), remembering("New."));
  const id = seeded(50);
  const ids = messageIds(id);
  await turn(id);

  await app.post(`/saves/${id}/messages/${store().latestMessageId(id)}/regenerate`, {});

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: "New." }]);
  expect(lastPrompt()).toContain("Action 0.");
  expect(lastPrompt()).toContain(ASK);
});

test("a Rewrite that gives no memory removes the old one, and the next Turn asks again", async () => {
  play(remembering("Old."), narration("Rain falls harder."), narration("Rain stops."));
  const id = seeded(50);
  await turn(id);

  await app.post(`/saves/${id}/messages/${store().latestMessageId(id)}/rewrite`, { feedback: "More rain." });
  expect(memories(id)).toEqual([]);

  await turn(id);
  expect(lastPrompt()).toContain("Action 0.");
  expect(lastPrompt()).toContain(ASK);
});

test("a Revert before a memory removes it and puts its Messages back", async () => {
  play(remembering(MEMORY), narration("Rain falls."), narration("Rain stops."));
  const id = seeded(50);
  const before = store().latestMessageId(id);
  await turn(id);
  await turn(id);

  store().revert(id, before);
  await turn(id);

  expect(memories(id)).toEqual([]);
  expect(window()).toHaveLength(100);
  expect(lastPrompt()).toContain("Action 0.");
});

test("Scene Memories reach the first system message oldest first, as text only, beside the summary", () => {
  const sceneMemories = [
    { firstMessage: 1, lastMessage: 20, text: "Older." },
    { firstMessage: 21, lastMessage: 40, text: "Newer." },
  ];
  const [system] = assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: { ...structuredClone(openingState), sceneMemories, summary: "So far." },
    messages: [],
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  });

  expect(system!.content).toContain('Scene Memories of the story so far, oldest first: ["Older.","Newer."]');
  expect(system!.content.indexOf("Scene Memories of the story")).toBeLessThan(system!.content.indexOf("Summary of the story so far"));
  expect(system!.content).not.toContain("firstMessage");
});

test("the request keeps secrets out, as the player reads memories", async () => {
  play(narration("Rain falls."));
  await turn(seeded(50));

  expect(prompts[0]!.at(-2)!.content).toContain("no Lore Entry or Plot Thread secrets");
  expect(prompts[0]!.at(-2)!.content).toContain("about 100 words");
  expect(prompts[0]!.at(-2)!.content).toContain("only what the PC experienced");
});

test("the Journal lists memories and no hidden text, and a player's edit is what the next prompt sends", async () => {
  play(remembering(MEMORY), narration("Rain falls."));
  const id = seeded(50);
  await turn(id);
  const [written] = (await journal(id)).sceneMemories;

  expect(written!.text).toBe(MEMORY);
  expect(JSON.stringify(await journal(id))).not.toContain(SECRET);

  const edited = await app.post(`/saves/${id}/edits`, { edit: "sceneMemory", firstMessage: written!.firstMessage, text: "Corrected." });
  expect(edited.status).toBe(200);
  await turn(id);

  expect(lastPrompt()).toContain('oldest first: ["Corrected."]');
  expect(lastPrompt()).not.toContain(MEMORY);
  expect(memories(id)[0]).toEqual({ ...written!, text: "Corrected." });
});

test("an edit can't reach a memory the Journal doesn't show", async () => {
  play();
  const id = seeded(1);

  const response = await app.post(`/saves/${id}/edits`, { edit: "sceneMemory", firstMessage: 1, text: "Forged." });

  expect(response.status).toBe(404);
  expect(memories(id)).toEqual([]);
});

test("an edit can't move a memory's range", async () => {
  play(remembering(MEMORY));
  const id = seeded(50);
  await turn(id);
  const [written] = memories(id);

  await app.post(`/saves/${id}/edits`, { edit: "sceneMemory", firstMessage: written!.firstMessage, lastMessage: 9999, text: "Corrected." });

  expect(memories(id)).toEqual([{ ...written!, text: "Corrected." }]);
});

test("a World Change leaves memories and the window alone, whatever its reply holds", async () => {
  const update: WorldUpdate = { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [{ old: null, new: "A new thread." }] };
  play(remembering(MEMORY), JSON.stringify({ ...update, scene_memories: [{ firstMessage: 1, lastMessage: 2, text: "Forged." }], scene_memory: "Forged." }), narration("Rain falls."));
  const id = seeded(50);
  await turn(id);
  const stored = memories(id);

  expect((await app.post(`/saves/${id}/world-change`, { change: "There is a new thread." })).status).toBe(200);
  await turn(id);

  expect(memories(id)).toEqual(stored);
  expect(window()).toHaveLength(82);
  expect(lastPrompt()).not.toContain("Forged.");
});

test("the Server Log gives a memory's range and length, and no story text", async () => {
  play(remembering(MEMORY));
  const id = seeded(50);
  const ids = messageIds(id);

  const line = await logOf(() => turn(id));

  expect(line).toContain(`"memoryFirst":${ids[0]}`);
  expect(line).toContain(`"memoryLast":${ids[19]}`);
  expect(line).toContain(`"memoryLength":${MEMORY.length}`);
  expect(line).not.toContain(MEMORY);
});

test("memories survive an export, an import and a Duplicate", async () => {
  play(remembering(MEMORY));
  const id = seeded(50);
  await turn(id);
  const stored = memories(id);

  const file = await (await app.get(`/saves/${id}/export`)).arrayBuffer();

  expect(memories(store().import(new Uint8Array(file)))).toEqual(stored);
  expect(memories(store().duplicate(id))).toEqual(stored);
});

test("an old Save upgrades, opens and keeps its latest 100 Messages until a memory covers them", async () => {
  play(narration("Rain falls."), narration("Rain falls."), remembering(MEMORY), narration("Rain falls."));
  const id = seeded(60);
  downgrade(id);
  const ids = messageIds(id);

  await turn(id);
  expect(memories(id)).toEqual([]);
  expect(window()).toHaveLength(100);
  expect(lastPrompt()).not.toContain("Reply 9.");
  expect(lastPrompt()).toContain("Action 10.");
  expect(lastPrompt()).toContain(ASK);

  await turn(id);
  expect(window()).toHaveLength(102);
  expect(lastPrompt()).toContain("Action 10.");

  await turn(id);
  expect(memories(id)).toEqual([{ firstMessage: ids[20]!, lastMessage: ids[39]!, text: MEMORY }]);

  await turn(id);
  expect(window()).toHaveLength(106 - 20);
  expect(lastPrompt()).not.toContain("Reply 19.");
  expect(lastPrompt()).toContain("Action 20.");
});

test("an old Save below the window's size keeps every Message", async () => {
  play(narration("Rain falls."));
  const id = seeded(10);
  downgrade(id);

  await turn(id);

  expect(window()).toHaveLength(20);
  expect(lastPrompt()).not.toContain(ASK);
});

test("an old Save reverted to before its window still has one", async () => {
  play(narration("Rain falls."));
  const id = seeded(100);
  downgrade(id);

  store().revert(id, messageIds(id)[49]!);
  await turn(id);

  expect(window()).toHaveLength(50);
  expect(lastPrompt()).toContain("Action 0.");
});

test("an old Save imported as a file upgrades the same way", async () => {
  play(narration("Rain falls."));
  const id = seeded(60);
  downgrade(id);
  const bytes = new Uint8Array(await Bun.file(join(savesDir, `${id}.sqlite`)).arrayBuffer());

  const imported = store().import(bytes);
  await turn(imported);

  expect(memories(imported)).toEqual([]);
  expect(window()).toHaveLength(100);
});
