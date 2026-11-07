import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { saveStore } from "../src/save-store";
import { Refused } from "../scripts/backfill-scene-memories";
import { repair } from "../scripts/repair-records";
import { scriptedTextProvider, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
const quiet = () => {};
const store = () => saveStore(savesDir);
const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);
const SNAPSHOT_OF = (id: string, messageId: number) => store().snapshot(id, messageId)!;

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Scratch");
});

afterEach(() => folder.remove());

function savedStory() {
  const saves = store();
  const id = saves.create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: { plotThreads: ["Old thread."], worldBible: [{ title: "Keep", keywords: ["k"], content: "Kept.", alwaysOn: true }, { title: "Stale", keywords: ["s"], content: "Wrong.", alwaysOn: false }, { title: "Drop", keywords: [], content: "Gone.", alwaysOn: false }] },
  });
  for (let turn = 0; turn < 4; turn++) {
    saves.commitTurn(id, saves.latestMessageId(id), `Action ${turn}.`, `Reply ${turn}.`, undefined, (state) => ({
      ...state,
      pcKnown: { ...state.pcKnown, facts: ["The same fact.", "The same fact, twice."] },
      npcs: [{ name: "Mara", appearance: "tall" }, { name: "Woman with a lamp", appearance: "tall" }],
      sceneMemories: [
        { firstMessage: 1, lastMessage: 2, text: "First." },
        { firstMessage: 3, lastMessage: 4, text: "A recap." },
      ],
    }));
  }
  return id;
}

const PLAN = {
  memories: [3],
  facts: ["The one fact."],
  looseEnds: ["Find the ferry."],
  plotThreads: ["New thread."],
  lore: { Stale: { content: "Right." }, Drop: null, Fresh: { keywords: ["f"], content: "New." } },
  operations: [{ op: "merge_npc" as const, name: "Woman with a lamp", into: "Mara" }],
};
const reply = (text: string) => JSON.stringify({ scene_memory: text });

test("a plan rewrites its memories and records in the latest two Snapshots and leaves older ones alone", async () => {
  const id = savedStory();
  const latest = store().latestMessageId(id);
  const older = JSON.stringify(SNAPSHOT_OF(id, latest - 2));
  const script = scriptedTextProvider(reply("  What happened at the docks.  "));

  await repair(pathOf(id), script.textProvider, PLAN, quiet, join(folder.path, "Real"));

  for (const messageId of [latest, latest - 1]) {
    const state = SNAPSHOT_OF(id, messageId);
    expect(state.sceneMemories.map(({ text }) => text)).toEqual(["First.", "What happened at the docks."]);
    expect(state.pcKnown.facts).toEqual(["The one fact."]);
    expect(state.looseEnds).toEqual(["Find the ferry."]);
    expect(state.plotThreads).toEqual(["New thread."]);
    expect(state.npcs.map(({ name }) => name)).toEqual(["Mara"]);
    expect(state.worldBible).toEqual([
      { title: "Keep", keywords: ["k"], content: "Kept.", alwaysOn: true },
      { title: "Stale", keywords: ["s"], content: "Right.", alwaysOn: false },
      { title: "Fresh", keywords: ["f"], content: "New.", alwaysOn: false },
    ]);
  }
  expect(JSON.stringify(SNAPSHOT_OF(id, latest - 2))).toBe(older);
  expect(script.prompts[0]![0]!.content).toContain('"First."');
  expect(script.prompts[0]!.at(-1)!.content).toContain("Action 1.");
});

test("a memory the provider won't write leaves the copy as it was", async () => {
  const id = savedStory();
  const before = JSON.stringify(store().latestState(id));

  await expect(repair(pathOf(id), scriptedTextProvider(new Error("down")).textProvider, PLAN, quiet, join(folder.path, "Real"))).rejects.toThrow();

  expect(JSON.stringify(store().latestState(id))).toBe(before);
});

test("a refused operation or an unknown memory writes nothing", async () => {
  const id = savedStory();
  const before = JSON.stringify(store().latestState(id));

  await expect(repair(pathOf(id), scriptedTextProvider().textProvider, { memories: [99] }, quiet, join(folder.path, "Real"))).rejects.toThrow(Refused);
  await expect(repair(pathOf(id), scriptedTextProvider().textProvider, { operations: [{ op: "update_npc", name: "Nobody", appearance: "short" }] }, quiet, join(folder.path, "Real"))).rejects.toThrow(Refused);

  expect(JSON.stringify(store().latestState(id))).toBe(before);
});

test("the real Saves folder is refused", async () => {
  const id = savedStory();
  const before = JSON.stringify(store().latestState(id));

  await expect(repair(pathOf(id), scriptedTextProvider().textProvider, PLAN, quiet, savesDir)).rejects.toThrow(Refused);

  expect(JSON.stringify(store().latestState(id))).toBe(before);
  using db = new Database(pathOf(id), { readonly: true });
  expect(db.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 8 });
});
