import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { backfill, mainSavesFolder } from "../scripts/backfill-scene-memories";
import { assemblePrompt, memoryDue, OPENING_INPUT, type Prompt } from "../src/prompt-assembler";
import { InvalidSave, type Message, saveStore } from "../src/save-store";
import { ContentRefused, TurnFailed } from "../src/turn-engine";
import { delta, fakeOpenAi, scriptedDice, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let realSaves: string;
let printed: string[];
let app: ReturnType<typeof startApp> | undefined;

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
  realSaves = join(folder.path, "Real", "Saves");
  mkdirSync(realSaves, { recursive: true });
  printed = [];
});

afterEach(async () => {
  await app?.stop();
  app = undefined;
  folder.remove();
});

const SECRET = "ZQX-SECRET";
const store = () => saveStore(savesDir);
const pathOf = (id: string) => join(savesDir, `${id}.sqlite`);
const memoryReply = (text: string) => JSON.stringify({ scene_memory: text });
/** As many good replies as a Save could need, each saying which call it was. */
const manyMemories = () => Array.from({ length: 50 }, (_, index) => memoryReply(`Memory ${index}.`));

function createSave() {
  return store().create({
    worldBrief: `${SECRET} brief`,
    pc: { name: "Ash" },
    opening: {
      plotThreads: [`${SECRET} a plot.`],
      worldRules: [`${SECRET} a rule.`],
      worldBible: [{ title: "Hidden", keywords: [], content: `${SECRET} lore.`, alwaysOn: true }],
    },
  });
}

/** Plays `turns` Turns straight into the store, as two Messages each. */
function seed(id: string, turns: number, firstInput?: string) {
  const saves = store();
  for (let turn = 0; turn < turns; turn++) {
    saves.commitTurn(id, saves.latestMessageId(id), turn === 0 && firstInput ? firstInput : `Action ${turn}.`, `Reply ${turn}.`, undefined, (state) => state);
  }
}

/** A Save from before Scene Memories, as far as the code that reads it can tell. */
function downgrade(id: string) {
  using db = new Database(pathOf(id));
  db.run("DELETE FROM snapshot_sections WHERE name = 'sceneMemories'; ALTER TABLE save DROP COLUMN memory_start; PRAGMA user_version = 14");
}

function oldSave(turns: number, firstInput?: string) {
  const id = createSave();
  seed(id, turns, firstInput);
  downgrade(id);
  return id;
}

const print = (line: string) => void printed.push(line);
const run = (path: string, ...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  const finished = backfill(path, script.textProvider, realSaves, print);
  return { finished, prompts: script.prompts };
};

const memories = (id: string) => store().latestState(id).sceneMemories;
const version = (path: string) => {
  using db = new Database(path);
  return db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
};

/** Each memory runs on from the one before, through the stored Messages, however their ids jump. */
function expectContiguous(all: Message[], list: { firstMessage: number; lastMessage: number }[]) {
  const ids = all.map(({ id }) => id);
  for (const [index, { firstMessage, lastMessage }] of list.entries()) {
    expect(ids.indexOf(firstMessage)).toBeLessThanOrEqual(ids.indexOf(lastMessage));
    if (index > 0) expect(ids.indexOf(firstMessage)).toBe(ids.indexOf(list[index - 1]!.lastMessage) + 1);
  }
}

const windowOf = (id: string): Prompt => {
  const saves = store();
  return assemblePrompt({
    save: { ...saves.read(id), startingHook: "" },
    state: saves.latestState(id),
    messages: saves.messages(id),
    memoryStart: saves.memoryStart(id),
    modelInstructions: "",
    input: "I wait.",
    responseSchema: "{}",
    promptStyle: null,
  }).slice(1, -2);
};

test("older Messages get memories of 20, oldest first, ending just before the window, which stays as it was", async () => {
  const id = oldSave(110);
  const saves = store();
  const start = saves.memoryStart(id); // Upgrades the Save.
  const before = windowOf(id);
  const all = saves.messages(id);
  const { finished, prompts } = run(pathOf(id), ...manyMemories());
  await finished;

  expect(prompts).toHaveLength(6);
  const list = memories(id);
  expect(list.map(({ text }) => text)).toEqual(["Memory 0.", "Memory 1.", "Memory 2.", "Memory 3.", "Memory 4.", "Memory 5."]);
  expect(list.map(({ firstMessage, lastMessage }) => lastMessage - firstMessage)).toEqual([19, 19, 19, 19, 19, 19]);
  expect(list[0]!.firstMessage).toBe(all[0]!.id);
  expect(all[all.findIndex((message) => message.id === list.at(-1)!.lastMessage) + 1]!.id).toBe(start);
  expectContiguous(all, list);
  expect(windowOf(id)).toEqual(before);
  expect(before).toHaveLength(100);
  expect(memoryDue(all, list, start)).toEqual({ firstMessage: start, lastMessage: all[all.findIndex((message) => message.id === start) + 19]!.id });
});

test("a Save at an older version is upgraded on opening, at any version", async () => {
  const id = oldSave(110);
  {
    using db = new Database(pathOf(id));
    db.run("DELETE FROM snapshot_sections WHERE name IN ('looseEnds', 'recentSummary'); PRAGMA user_version = 13");
  }
  await run(pathOf(id), ...manyMemories()).finished;
  expect(version(pathOf(id))).toBe(22);
  expect(memories(id)).toHaveLength(6);
  expect(store().latestState(id).looseEnds).toEqual([]);
  expect(store().latestState(id).recentSummary).toBe("");
});

test("a final batch shorter than 20 becomes a shorter memory, so none of its Messages is lost", async () => {
  const id = oldSave(113);
  const start = store().memoryStart(id);
  const all = store().messages(id);
  await run(pathOf(id), ...manyMemories()).finished;

  const list = memories(id);
  expect(list).toHaveLength(7);
  expect(list.map(({ firstMessage, lastMessage }) => lastMessage - firstMessage + 1)).toEqual([20, 20, 20, 20, 20, 20, 6]);
  expect(list.at(-1)!.lastMessage).toBe(start - 1);
  expectContiguous(all, list);
});

test("the memories end just before the first one the Save already has, and keep it", async () => {
  const id = oldSave(110);
  const saves = store();
  const start = saves.memoryStart(id);
  const existing = { firstMessage: start, lastMessage: start + 19, text: "Written in play." };
  saves.commitTurn(id, saves.latestMessageId(id), "On.", "On.", undefined, (state) => ({ ...state, sceneMemories: [existing] }));
  const before = windowOf(id);

  const { finished, prompts } = run(pathOf(id), ...manyMemories());
  await finished;

  expect(prompts).toHaveLength(6);
  expect(memories(id).at(-1)).toEqual(existing);
  expect(memories(id).at(-2)!.lastMessage).toBe(start - 1);
  expectContiguous(saves.messages(id), memories(id));
  expect(windowOf(id)).toEqual(before);
});

test("a window that a Revert moved back keeps its Messages", async () => {
  const id = oldSave(110);
  const saves = store();
  const start = saves.memoryStart(id);
  saves.revert(id, start + 9);
  const before = windowOf(id);
  expect(before).toHaveLength(80);

  await run(pathOf(id), ...manyMemories()).finished;

  expect(memories(id).at(-1)!.lastMessage).toBeLessThan(start);
  expectContiguous(saves.messages(id), memories(id));
  expect(windowOf(id)).toEqual(before);
});

test("a batch holds only what the player read, with Message ids that replaced Turns left gaps in", async () => {
  const id = createSave();
  seed(id, 5, OPENING_INPUT);
  const saves = store();
  const latest = saves.latestMessageId(id);
  saves.replaceTurn(id, latest, "The reply the player replaced.", (state) => state);
  saves.replaceTurn(id, saves.latestMessageId(id), "The reply the player kept.", (state) => state);
  seed(id, 110);
  downgrade(id);
  const all = saves.messages(id);

  const { finished, prompts } = run(pathOf(id), ...manyMemories());
  await finished;

  const sent = prompts.map((prompt) => prompt.map(({ content }) => content).join("\n")).join("\n");
  expect(sent).not.toContain(OPENING_INPUT);
  expect(sent).toContain("The reply the player kept.");
  expect(sent).not.toContain("The reply the player replaced.");
  expect(memories(id)[0]!.firstMessage).toBe(all[1]!.id);
  expectContiguous(all, memories(id));
});

test("each prompt holds only its own batch and the rules", async () => {
  const id = createSave();
  store().commitTurn(id, 0, "Action 0.", "Reply 0.", { type: "skill", roll: 777 } as never, (state) => state);
  seed(id, 109);
  downgrade(id);
  const all = store().messages(id);

  const { finished, prompts } = run(pathOf(id), ...manyMemories());
  await finished;

  for (const [index, prompt] of prompts.entries()) {
    expect(prompt.map(({ role }) => role)).toEqual(["system", "user"]);
    const batch = all.slice(index * 20, (index + 1) * 20);
    expect(JSON.parse(prompt[1]!.content)).toEqual(batch.map(({ role, text }) => ({ role, text })));
    expect(prompt[0]!.content).toContain("what happened, who was there and what changed");
    expect(prompt[0]!.content).toContain("no Lore Entry or Plot Thread secrets");
    const whole = JSON.stringify(prompt);
    expect(whole).not.toContain(SECRET);
    expect(whole).not.toContain("777");
    expect(whole).not.toContain("Ash");
    expect(whole).not.toContain(all[(index + 1) * 20]!.text);
  }
});

test("a failed batch stops the run and writes nothing", async () => {
  const id = oldSave(110);
  store().memoryStart(id); // Upgrades the Save, so only the backfill could change the file.
  const before = readFileSync(pathOf(id));

  const { finished, prompts } = run(pathOf(id), memoryReply("One."), memoryReply("Two."), new Error("The connection dropped."));
  await expect(finished).rejects.toBeInstanceOf(TurnFailed);

  expect(prompts).toHaveLength(3);
  expect(readFileSync(pathOf(id)).equals(before)).toBe(true);
});

test("a reply with no memory in it fails the batch after the Turn's retries", async () => {
  const id = oldSave(110);
  store().memoryStart(id);
  const before = readFileSync(pathOf(id));

  const blank = memoryReply("   ");
  const { finished, prompts } = run(pathOf(id), blank, "not JSON", blank);
  await expect(finished).rejects.toBeInstanceOf(TurnFailed);

  expect(prompts).toHaveLength(3);
  expect(readFileSync(pathOf(id)).equals(before)).toBe(true);
});

test("nothing is asked or written when no older Message is uncovered", async () => {
  const short = createSave();
  seed(short, 10);
  downgrade(short);
  const first = run(pathOf(short), ...manyMemories());
  await first.finished;
  expect(first.prompts).toHaveLength(0);
  expect(memories(short)).toEqual([]);

  const long = oldSave(110);
  await run(pathOf(long), ...manyMemories()).finished;
  const list = memories(long);
  const second = run(pathOf(long), ...manyMemories());
  await second.finished;
  expect(second.prompts).toHaveLength(0);
  expect(memories(long)).toEqual(list);
});

test("a short batch leaves out the Opening's hidden Message", async () => {
  const id = createSave();
  seed(id, 51, OPENING_INPUT); // 102 Messages, so two are older than the window, and one of those is hidden.
  downgrade(id);
  const { finished, prompts } = run(pathOf(id), ...manyMemories());
  await finished;
  expect(prompts).toHaveLength(1);
  expect(JSON.parse(prompts[0]![1]!.content)).toEqual([{ role: "narrator", text: "Reply 0." }]);
});

test("older Snapshots stay as they were, and the memories survive a Regenerate of the latest Turn", async () => {
  const id = oldSave(110);
  await run(pathOf(id), ...manyMemories()).finished;
  const list = memories(id);
  const latest = store().latestMessageId(id);
  const sectionAt = (messageId: number) => {
    using db = new Database(pathOf(id));
    return db
      .query<{ content: string }, [number]>(
        "SELECT content FROM sections JOIN snapshot_sections ON section_id = sections.id WHERE message_id = ? AND name = 'sceneMemories'",
      )
      .get(messageId)!.content;
  };
  expect(sectionAt(0)).toBe("[]");
  expect(sectionAt(latest - 2)).toBe("[]");

  // The refusal answers the memory the Regenerate asks for, so that the list stays as the backfill wrote it.
  const script = scriptedTextProvider(new ContentRefused(), JSON.stringify({ narration: "A new reply.", state_operations: [] }));
  app = startApp(savesDir, script.textProvider, scriptedDice());
  const response = await app.post(`/saves/${id}/messages/${latest}/regenerate`, {});
  await response.text();
  expect(response.status).toBe(201);
  expect(memories(id)).toEqual(list);

  // The limit in the ticket: a Revert to before the latest Turn goes back to a state without them.
  store().revert(id, latest - 2);
  expect(memories(id)).toEqual([]);
});

test("the upgraded, backfilled Save still passes the app's own import check", async () => {
  const id = oldSave(110);
  await run(pathOf(id), ...manyMemories()).finished;
  const imported = store().import(readFileSync(pathOf(id)));
  expect(memories(imported)).toEqual(memories(id));
});

test("a Save anywhere with any name can be the copy", async () => {
  const id = oldSave(110);
  const copy = join(folder.path, "stark copy.sqlite");
  copyFileSync(pathOf(id), copy);
  const original = readFileSync(pathOf(id));
  await run(copy, ...manyMemories()).finished;
  expect(readFileSync(pathOf(id)).equals(original)).toBe(true);
  using db = new Database(copy);
  expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(22);
});

test("any spelling of a path inside the main Saves folder is refused, and the file isn't opened", async () => {
  const id = oldSave(110);
  const real = join(realSaves, "real.sqlite");
  copyFileSync(pathOf(id), real);
  mkdirSync(join(realSaves, "nested"));
  const nested = join(realSaves, "nested", "real.sqlite");
  copyFileSync(pathOf(id), nested);
  const original = readFileSync(real);
  const junction = join(folder.path, "junction");
  if (process.platform === "win32") execSync(`cmd /c mklink /J "${junction}" "${realSaves}"`, { stdio: "ignore" });

  const spellings = [
    real,
    nested,
    join(realSaves, "..", "Saves", "real.sqlite"),
    real.replaceAll("\\", "/"),
    real.toUpperCase(),
    real.toLowerCase(),
    real.toLowerCase().replaceAll("\\", "/"),
    ...(process.platform === "win32"
      ? [`\\\\?\\${real}`, `\\\\localhost\\${real[0]}$\\${real.slice(3)}`, join(junction, "real.sqlite")]
      : []),
  ];
  for (const path of spellings) {
    const { finished, prompts } = run(path, ...manyMemories());
    await expect(finished).rejects.toThrow("the main checkout's Saves folder");
    expect(prompts).toHaveLength(0);
  }
  expect(readFileSync(real).equals(original)).toBe(true);
  expect(version(real)).toBe(14);
});

test("a hard link is refused, as it would write through to its other name", async () => {
  const id = oldSave(110);
  const link = join(folder.path, "link.sqlite");
  linkSync(pathOf(id), link);
  await expect(run(link, ...manyMemories()).finished).rejects.toThrow("hard link");
});

test("the main Saves folder is the main checkout's, found from any worktree", () => {
  const main = execSync("git worktree list --porcelain", { cwd: import.meta.dir }).toString().split("\n")[0]!.replace("worktree ", "");
  expect(resolve(mainSavesFolder())).toBe(resolve(main, "Saves"));
});

test("a missing file is refused without being created, and another file isn't turned into a Save", async () => {
  const missing = join(folder.path, "missing.sqlite");
  await expect(run(missing).finished).rejects.toThrow("no file");
  expect(await Bun.file(missing).exists()).toBe(false);

  const text = join(folder.path, "notes.sqlite");
  writeFileSync(text, "not a database, just words");
  await expect(run(text).finished).rejects.toBeInstanceOf(InvalidSave);

  const empty = join(folder.path, "other.sqlite");
  {
    using db = new Database(empty);
    db.run("CREATE TABLE notes (text TEXT)");
  }
  await expect(run(empty).finished).rejects.toBeInstanceOf(InvalidSave);
  expect(version(empty)).toBe(0);
});

test("the printed output holds counts, never story text", async () => {
  const id = oldSave(110);
  await run(pathOf(id), ...manyMemories()).finished;
  const output = printed.join("\n");
  expect(output).toContain("6");
  expect(output).not.toMatch(/Action|Reply|Memory \d/);
});

const SCRIPT = join(import.meta.dir, "..", "scripts", "backfill-scene-memories.ts");
const KEY = "sk-ZQX-TEST-KEY";

async function runScript(...args: string[]) {
  const child = Bun.spawn([process.execPath, "run", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { output: output + errors, code };
}

test("the script reads a settings file by path, sends the key only to the Text Provider, and prints none of it", async () => {
  const provider = fakeOpenAi(Array.from({ length: 6 }, (_, index) => [delta(memoryReply(`Memory ${index}.`))]));
  const settings = join(folder.path, "main settings.json");
  const written = JSON.stringify({ textBaseUrl: provider.baseUrl, textModel: "fake/model", textApiKey: KEY });
  writeFileSync(settings, written);
  const id = oldSave(110);
  try {
    const { output, code } = await runScript(pathOf(id), settings);
    expect(output).toContain("6 Scene Memories");
    expect(code).toBe(0);
    expect(provider.requests).toHaveLength(6);
    expect(provider.requests[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(output).not.toContain(KEY);
    expect(output).not.toMatch(/Action|Reply|Memory \d/);
    expect(memories(id)).toHaveLength(6);
    expect(readFileSync(settings, "utf8")).toBe(written);
  } finally {
    provider.stop();
  }
});

test("a provider failure exits non-zero, prints neither key nor story, and writes nothing", async () => {
  const rejected = () => Response.json({ error: { message: `bad key ${KEY}: Action 0.` } }, { status: 401 });
  const provider = fakeOpenAi([[delta(memoryReply("One."))], rejected()]);
  const settings = join(folder.path, "settings.json");
  writeFileSync(settings, JSON.stringify({ textBaseUrl: provider.baseUrl, textModel: "fake/model", textApiKey: KEY }));
  const id = oldSave(110);
  store().memoryStart(id);
  const before = readFileSync(pathOf(id));
  try {
    const { output, code } = await runScript(pathOf(id), settings);
    expect(code).toBe(1);
    expect(output).not.toContain(KEY);
    expect(output).not.toMatch(/Action|Reply|One\./);
    expect(readFileSync(pathOf(id)).equals(before)).toBe(true);
  } finally {
    provider.stop();
  }
});

test("the script refuses a missing settings file before opening the Save", async () => {
  const id = oldSave(110);
  const { output, code } = await runScript(pathOf(id), join(folder.path, "nowhere.json"));
  expect(code).toBe(1);
  expect(output).toContain("settings");
  expect(version(pathOf(id))).toBe(14);
});

