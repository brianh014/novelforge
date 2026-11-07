import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { assemblePrompt, type Prompt } from "../src/prompt-assembler";
import { saveStore } from "../src/save-store";
import { openingState, StateOperation, type WorldUpdate } from "../src/state-applier";
import { ContentRefused } from "../src/turn-engine";
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

const MEMORY_ASK = "Set scene_memory to a memory";
const SECRET = "ZQX-SECRET";
const MEMORY = "Ash reached the docks and Mara said the ferry had stopped.";
const remembering = (text: unknown) => JSON.stringify({ scene_memory: text });
/** A due Turn calls for its memory first, then for its reply. */
const remembered = (text: unknown) => [remembering(text), narration("Rain falls.")];
const missedMemory = [new ContentRefused(), narration("Rain falls.")];

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
const memoryCalls = () => prompts.filter((prompt) => prompt[0]!.content.startsWith(MEMORY_ASK));
const narratorPrompts = () => prompts.filter((prompt) => !prompt[0]!.content.startsWith(MEMORY_ASK));
const lastPrompt = () => narratorPrompts().at(-1)!.map(({ content }) => content).join(" ");
/** The Messages of the last prompt, not counting the Turn's own input. */
const window = () => narratorPrompts().at(-1)!.slice(1, -2);
const journal = async (id: string) => (await (await app.get(`/saves/${id}/journal`)).json()) as { sceneMemories: { firstMessage: number; lastMessage: number; text: string }[] };

/** Turns the Save back into one from before Scene Memories, as far as the code that reads it can tell. */
function downgrade(id: string) {
  using db = new Database(join(savesDir, `${id}.sqlite`));
  db.run("DELETE FROM snapshot_sections WHERE name = 'sceneMemories'; ALTER TABLE save DROP COLUMN memory_start; PRAGMA user_version = 14");
}

test("a new story starts with no Scene Memories", () => {
  expect(openingState.sceneMemories).toEqual([]);
});

test("a new story sends every Message and writes no memory below 80", async () => {
  play(narration("Rain falls."));
  const id = seeded(39);

  await turn(id);

  expect(window()).toHaveLength(78);
  expect(lastPrompt()).toContain("Action 0.");
  expect(memoryCalls()).toHaveLength(0);
});

test("at 80 Messages a call of its own writes a memory of the oldest 20, with every Message still in the Turn's prompt", async () => {
  play(...remembered(MEMORY));
  const id = seeded(40);

  await turn(id);

  expect(window()).toHaveLength(80);
  expect(lastPrompt()).toContain("Action 0.");
  expect(lastPrompt()).not.toContain("scene_memory");
  const [call] = memoryCalls();
  expect(call!.at(-1)!.content).toContain("Action 0.");
  expect(call!.at(-1)!.content).toContain("Reply 9.");
  expect(call!.at(-1)!.content).not.toContain("Action 10.");
});

test("the memory call gets the memory before it and no hidden text, and asks for these Messages alone", async () => {
  play(...remembered("First."), ...Array.from({ length: 9 }, () => narration("Rain falls.")), ...remembered("Second."));
  const id = seeded(40);

  for (let count = 0; count < 11; count++) await turn(id);

  const [first, second] = memoryCalls();
  expect(first![0]!.content).not.toContain("For context only");
  expect(second![0]!.content).toContain('For context only, this memory comes just before them, so carry on from it and repeat none of it: "First."');
  expect(second![0]!.content).toContain("never recap the story before them");
  expect(second![0]!.content).toContain("no Lore Entry or Plot Thread secrets");
  expect(second![0]!.content).toContain("about 100 words");
  expect(JSON.stringify(second)).not.toContain(SECRET);
});

test("a finished memory records the server's range and moves the window on", async () => {
  play(...remembered(`  ${MEMORY}  `), narration("Rain falls."));
  const id = seeded(40);
  const ids = messageIds(id);

  await turn(id);
  await turn(id);

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: MEMORY }]);
  expect(window()).toHaveLength(62);
  expect(lastPrompt()).not.toContain("Reply 9.");
  expect(lastPrompt()).toContain("Action 10.");
  expect(memoryCalls()).toHaveLength(1);
});

test("the next batch follows on from the last memory", async () => {
  play(...remembered("First."), ...Array.from({ length: 9 }, () => narration("Rain falls.")), ...remembered("Second."));
  const id = seeded(40);
  const ids = messageIds(id);

  for (let count = 0; count < 11; count++) await turn(id);

  expect(memories(id).map(({ firstMessage, lastMessage }) => [firstMessage, lastMessage])).toEqual([
    [ids[0]!, ids[19]!],
    [ids[20]!, ids[39]!],
  ]);
});

for (const [missed, reply] of [
  ["null", remembering(null)],
  ["empty", remembering("   ")],
  ["not text", remembering({ firstMessage: 1, lastMessage: 1, text: MEMORY })],
] as const) {
  test(`a memory that is ${missed} costs nothing, and the next Turn asks again with the same Messages`, async () => {
    // The Turn's reply comes second, as both calls start together, then the memory call's two retries.
    play(reply, narration("Rain falls."), reply, reply, ...missedMemory);
    const id = seeded(40);

    expect((await turn(id)).status).toBe(201);
    await turn(id);

    expect(memories(id)).toEqual([]);
    expect(window()).toHaveLength(82);
    expect(lastPrompt()).toContain("Action 0.");
    expect(memoryCalls().at(-1)!.at(-1)!.content).toContain("Action 0.");
  });
}

test("a refused memory never costs the Turn", async () => {
  play(...missedMemory);
  const id = seeded(40);

  expect((await turn(id)).status).toBe(201);
  expect(memories(id)).toEqual([]);
});

test("a Message never leaves through missed memories, however long the window grows", async () => {
  play(...Array.from({ length: 30 }, () => missedMemory).flat(), ...remembered(MEMORY));
  const id = seeded(40);
  const first = messageIds(id).slice(0, 20);

  for (let count = 0; count < 31; count++) await turn(id);

  expect(window()).toHaveLength(140);
  expect(memories(id)).toEqual([{ firstMessage: first[0]!, lastMessage: first[19]!, text: MEMORY }]);
});

test("a memory in the Narrator's reply is dropped", async () => {
  play(JSON.stringify({ narration: "Rain falls.", state_operations: [], scene_memory: MEMORY }));
  const id = seeded(3);

  await turn(id);

  expect(memories(id)).toEqual([]);
});

test("nothing a reply holds can set a range or change a stored memory", async () => {
  play(JSON.stringify({ scene_memory: MEMORY, firstMessage: 9999, lastMessage: 9999, range: [1, 2], scene_memories: [{ firstMessage: 1, lastMessage: 2, text: "Forged." }] }), narration("Rain falls."));
  const id = seeded(40);
  const ids = messageIds(id);

  await turn(id);

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: MEMORY }]);
  const operations = StateOperation.options.map((option) => option.shape.op.value);
  expect(operations.filter((op) => op.includes("memory"))).toEqual([]);
});

test("a Check request writes no memory, and the finished Turn after it keeps the one call's memory", async () => {
  play(remembering("After the leap."), JSON.stringify({ check: { action: "Leap", difficulty: "Easy" } }), narration("Rain falls."));
  const id = seeded(40);

  await turn(id);

  expect(memories(id).map(({ text }) => text)).toEqual(["After the leap."]);
  expect(memoryCalls()).toHaveLength(1);
});

test("a Regenerate replaces the memory its Turn wrote, over the same Messages", async () => {
  play(...remembered("Old."), ...remembered("New."));
  const id = seeded(40);
  const ids = messageIds(id);
  await turn(id);

  await app.post(`/saves/${id}/messages/${store().latestMessageId(id)}/regenerate`, {});

  expect(memories(id)).toEqual([{ firstMessage: ids[0]!, lastMessage: ids[19]!, text: "New." }]);
  expect(lastPrompt()).toContain("Action 0.");
});

test("a Rewrite whose memory is missed removes the old one, and the next Turn asks again", async () => {
  play(...remembered("Old."), ...missedMemory, ...remembered("Again."));
  const id = seeded(40);
  await turn(id);

  await app.post(`/saves/${id}/messages/${store().latestMessageId(id)}/rewrite`, { feedback: "More rain." });
  expect(memories(id)).toEqual([]);

  await turn(id);
  expect(lastPrompt()).toContain("Action 0.");
  expect(memories(id).map(({ text }) => text)).toEqual(["Again."]);
});

test("a Revert before a memory removes it and puts its Messages back", async () => {
  play(...remembered(MEMORY), narration("Rain falls."), ...missedMemory);
  const id = seeded(40);
  const before = store().latestMessageId(id);
  await turn(id);
  await turn(id);

  store().revert(id, before);
  await turn(id);

  expect(memories(id)).toEqual([]);
  expect(window()).toHaveLength(80);
  expect(lastPrompt()).toContain("Action 0.");
});

test("Scene Memories end the first system message, as text only, and the summary goes below the Messages", () => {
  const sceneMemories = [
    { firstMessage: 1, lastMessage: 20, text: "Older." },
    { firstMessage: 21, lastMessage: 40, text: "Newer." },
  ];
  const prompt = assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: { ...structuredClone(openingState), sceneMemories, summary: "So far." },
    messages: [],
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  });

  expect(prompt[0]!.content.endsWith('Scene Memories of the story so far, oldest first: ["Older.","Newer."]')).toBe(true);
  expect(prompt[0]!.content).not.toContain("firstMessage");
  expect(prompt.at(-2)!.content).toContain("Summary of the story so far: So far.");
});

test("what changes from Turn to Turn stays out of the prompt's start, so the provider can cache it", async () => {
  const learned = JSON.stringify({ narration: "Rain falls.", state_operations: [{ op: "add_known_fact", fact: "The ferry stopped." }], summary: "Now." });
  play(learned, narration("Rain stops."));
  const id = seeded(3);

  await turn(id);
  await turn(id);

  const [before, after] = prompts;
  expect(after![0]).toEqual(before![0]!);
  // The newest two replies carry their people, so the oldest Messages are what must stay the same.
  expect(after!.slice(1, 5)).toEqual(before!.slice(1, 5));
  expect(before![0]!.content).not.toContain("Current state");
  expect(after!.at(-2)!.content).toContain("The ferry stopped.");
  expect(after!.at(-2)!.content).toContain("Now.");
});

test("only the newest replies repeat their people", () => {
  const messages = [1, 3, 5, 7].flatMap((id) => [
    { id, role: "player" as const, text: "I wait." },
    { id: id + 1, role: "narrator" as const, text: "Mara nods." },
  ]);
  const npcs = [{ name: "Mara", appearance: "a tall woman" }];
  const prompt = assemblePrompt({
    save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
    state: { ...structuredClone(openingState), npcs },
    messages,
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  });

  const replies = prompt.filter(({ role }) => role === "assistant").map(({ content }) => JSON.parse(content).people);
  expect(replies).toEqual([[], [], npcs, npcs]);
});

test("the Journal lists memories and no hidden text, and a player's edit is what the next prompt sends", async () => {
  play(...remembered(MEMORY), narration("Rain falls."));
  const id = seeded(40);
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
  play(...remembered(MEMORY));
  const id = seeded(40);
  await turn(id);
  const [written] = memories(id);

  await app.post(`/saves/${id}/edits`, { edit: "sceneMemory", firstMessage: written!.firstMessage, lastMessage: 9999, text: "Corrected." });

  expect(memories(id)).toEqual([{ ...written!, text: "Corrected." }]);
});

test("a World Change leaves memories and the window alone, whatever its reply holds", async () => {
  const update: WorldUpdate = { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [{ old: null, new: "A new thread." }] };
  play(...remembered(MEMORY), JSON.stringify({ ...update, scene_memories: [{ firstMessage: 1, lastMessage: 2, text: "Forged." }], scene_memory: "Forged." }), narration("Rain falls."));
  const id = seeded(40);
  await turn(id);
  const stored = memories(id);

  expect((await app.post(`/saves/${id}/world-change`, { change: "There is a new thread." })).status).toBe(200);
  await turn(id);

  expect(memories(id)).toEqual(stored);
  expect(window()).toHaveLength(62);
  expect(lastPrompt()).not.toContain("Forged.");
});

test("the Server Log gives a memory's range and length, and no story text", async () => {
  play(...remembered(MEMORY));
  const id = seeded(40);
  const ids = messageIds(id);

  const line = await logOf(() => turn(id));

  expect(line).toContain(`"memoryFirst":${ids[0]}`);
  expect(line).toContain(`"memoryLast":${ids[19]}`);
  expect(line).toContain(`"memoryLength":${MEMORY.length}`);
  expect(line).not.toContain(MEMORY);
});

test("memories survive an export, an import and a Duplicate", async () => {
  play(...remembered(MEMORY));
  const id = seeded(40);
  await turn(id);
  const stored = memories(id);

  const file = await (await app.get(`/saves/${id}/export`)).arrayBuffer();

  expect(memories(store().import(new Uint8Array(file)))).toEqual(stored);
  expect(memories(store().duplicate(id))).toEqual(stored);
});

test("the window's start survives an export, an import and a Duplicate", async () => {
  play();
  const id = seeded(60);
  downgrade(id);
  const start = messageIds(id)[20]!;
  expect(store().memoryStart(id)).toBe(start);

  const file = await (await app.get(`/saves/${id}/export`)).arrayBuffer();

  expect(store().memoryStart(store().import(new Uint8Array(file)))).toBe(start);
  expect(store().memoryStart(store().duplicate(id))).toBe(start);
});

test("an old Save reverted past its window, then imported, can't lose new Messages", async () => {
  play();
  const id = seeded(100);
  downgrade(id);
  const kept = messageIds(id)[49]!;
  store().revert(id, kept);

  const imported = store().import(new Uint8Array(await (await app.get(`/saves/${id}/export`)).arrayBuffer()));

  expect(store().memoryStart(imported)).toBe(kept + 1);
});

test("a Regenerate on an old Save keeps its window and asks for the same range", async () => {
  play(...remembered("Old."), ...remembered(MEMORY));
  const id = seeded(60);
  downgrade(id);
  const ids = messageIds(id);
  await turn(id);

  await app.post(`/saves/${id}/messages/${store().latestMessageId(id)}/regenerate`, {});

  expect(lastPrompt()).toContain("Action 10.");
  expect(lastPrompt()).not.toContain("Reply 9.");
  expect(memories(id)).toEqual([{ firstMessage: ids[20]!, lastMessage: ids[39]!, text: MEMORY }]);
});

test("an old Save upgrades, opens and keeps its latest 100 Messages until a memory covers them", async () => {
  play(...missedMemory, ...missedMemory, ...remembered(MEMORY), ...missedMemory);
  const id = seeded(60);
  downgrade(id);
  const ids = messageIds(id);

  await turn(id);
  expect(memories(id)).toEqual([]);
  expect(window()).toHaveLength(100);
  expect(lastPrompt()).not.toContain("Reply 9.");
  expect(lastPrompt()).toContain("Action 10.");

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
  expect(memoryCalls()).toHaveLength(0);
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
  play(...missedMemory);
  const id = seeded(60);
  downgrade(id);
  const bytes = new Uint8Array(await Bun.file(join(savesDir, `${id}.sqlite`)).arrayBuffer());

  const imported = store().import(bytes);
  await turn(imported);

  expect(memories(imported)).toEqual([]);
  expect(window()).toHaveLength(100);
});
