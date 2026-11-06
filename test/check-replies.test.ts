import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkReplies, sampleIds } from "../scripts/check-replies";
import type { Check } from "../src/check-resolver";
import { OPENING_INPUT } from "../src/prompt-assembler";
import { InvalidSave, saveStore } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { ContentRefused } from "../src/turn-engine";
import { delta, fakeOpenAi, scriptedTextProvider, tempFolder } from "./support";

const SCRIPT = resolve(import.meta.dir, "../scripts/check-replies.ts");
const REASON = "ZQX-REASON";
const STORY = "ZQX-STORY";
const KEY = "ZQX-KEY";
const CLEAN = { contradicts: false, decides_for_pc: false, repeats_player: false, background_ending: false };
const PRICED = { data: [{ id: "m", pricing: { prompt: "0.001", completion: "0.002" } }] };

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let realSaves: string;
let labelsPath: string;
let settingsPath: string;
let printed: string[];
let server: ReturnType<typeof fakeOpenAi>;

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
  realSaves = join(folder.path, "Real", "Saves");
  mkdirSync(realSaves, { recursive: true });
  labelsPath = join(folder.path, "labels.json");
  settingsPath = join(folder.path, "settings.json");
  writeFileSync(labelsPath, "{}");
  printed = [];
  server = fakeOpenAi([], PRICED);
});

afterEach(() => {
  server.stop();
  folder.remove();
});

const settings = () => {
  const store = settingsStore(settingsPath);
  store.update({ textBaseUrl: server.baseUrl, textApiKey: KEY, textModel: "m", modelInstructions: "Keep it gentle." });
  return store;
};

const answers = (yes: Partial<typeof CLEAN> = {}) =>
  JSON.stringify(Object.fromEntries(Object.entries({ ...CLEAN, ...yes }).map(([question, answer]) => [question, { yes: answer, reason: `${REASON} ${question}` }])));

function copyOf(id: string) {
  const copy = join(folder.path, "copy.sqlite");
  copyFileSync(join(savesDir, `${id}.sqlite`), copy);
  return copy;
}

/** A Save of `turns` Turns, where Turn n adds "Fact n" to the state, returned as a copy outside the Saves folder. */
function copyOfSave(turns: number) {
  const saves = saveStore(savesDir);
  const id = saves.create({ worldBrief: "A wet town.", pc: { name: "Ash" }, opening: { plotThreads: ["A plot."] } });
  for (let turn = 1; turn <= turns; turn++) {
    saves.commitTurn(id, saves.latestMessageId(id), `Action ${turn}.`, `${STORY} reply ${turn}.`, undefined, (state) => ({
      ...state,
      pcKnown: { ...state.pcKnown, facts: [...state.pcKnown.facts, `Fact ${turn}`] },
    }));
  }
  return copyOf(id);
}

const run = (copy: string, provider = scriptedTextProvider().textProvider) => checkReplies(copy, labelsPath, provider, settings(), realSaves, (line) => printed.push(line));
const results = (copy: string) => JSON.parse(readFileSync(`${copy}.check-replies.json`, "utf8"));
const asked = (prompt: { content: string }[]) => JSON.parse(prompt.at(-1)!.content) as { narrator_prompt: { role: string; content: string }[]; reply: string };

test("a path in the main Saves folder is refused before anything happens", async () => {
  const copy = copyOfSave(1);
  const real = join(realSaves, "real.sqlite");
  copyFileSync(copy, real);
  const { textProvider, prompts } = scriptedTextProvider();
  await expect(run(real, textProvider)).rejects.toThrow("main checkout's Saves folder");
  expect(prompts).toEqual([]);
  expect(readdirSync(realSaves)).toEqual(["real.sqlite"]);
});

test("the copy stays identical and gains no neighbour but the results, even at an older version that needs an upgrade", async () => {
  const copy = copyOfSave(2);
  {
    using db = new Database(copy);
    db.run("DELETE FROM snapshot_sections WHERE name = 'sceneMemories'; ALTER TABLE save DROP COLUMN memory_start; PRAGMA user_version = 14");
  }
  const before = readFileSync(copy);
  await run(copy, scriptedTextProvider(answers(), answers()).textProvider);
  expect(readFileSync(copy).equals(before)).toBe(true);
  expect(readdirSync(folder.path).filter((name) => name.startsWith("copy"))).toEqual(["copy.sqlite", "copy.sqlite.check-replies.json"]);
  expect(results(copy).replies.length).toBe(2);
});

test("a file that isn't a Save is refused", async () => {
  const notASave = join(folder.path, "copy.sqlite");
  writeFileSync(notASave, "not a Save");
  await expect(run(notASave)).rejects.toBeInstanceOf(InvalidSave);
});

test("each reply is judged on what its Turn knew, and not on anything after", async () => {
  const copy = copyOfSave(3);
  const { textProvider, prompts } = scriptedTextProvider(answers(), answers(), answers());
  await run(copy, textProvider);
  const { narrator_prompt, reply } = asked(prompts[1]!);
  const sent = JSON.stringify(narrator_prompt);
  expect(reply).toBe(`${STORY} reply 2.`);
  for (const known of ["Action 2.", "Fact 1", `${STORY} reply 1.`, "Keep it gentle.", "A plot."]) expect(sent).toContain(known);
  for (const later of ["Fact 2", "Fact 3", `${STORY} reply 2.`, "Action 3."]) expect(sent).not.toContain(later);
});

test("a reply that followed a Check is judged with its result, and a replacement with the edits it kept", async () => {
  const saves = saveStore(savesDir);
  const id = saves.create({ worldBrief: "A wet town.", pc: { name: "Ash" } });
  const check: Check = { action: "ZQX-CLIMB", difficulty: "Hard", roll: 2, outcome: "failure", degree: "clear" };
  saves.commitTurn(id, 0, "Climb.", "You fall.", check, (state) => state);
  saves.addEdit(id, { edit: "fact", old: null, new: "ZQX-EDITED" });
  saves.replaceTurn(id, saves.latestMessageId(id), "You fall hard.", (state) => state);
  // A second replacement carries the first's edits on its own Message, as a later Turn would see them.
  saves.replaceTurn(id, saves.latestMessageId(id), "You fall harder.", (state) => state);
  const { textProvider, prompts } = scriptedTextProvider(answers());
  await run(copyOf(id), textProvider);
  const { narrator_prompt, reply } = asked(prompts[0]!);
  expect(reply).toBe("You fall harder.");
  const sent = JSON.stringify(narrator_prompt);
  expect(sent).toContain("ZQX-CLIMB");
  expect(sent).toContain("ZQX-EDITED");
});

test("the sample is about 50 evenly spread replies, plus every marked one", () => {
  const ids = Array.from({ length: 300 }, (_, index) => index * 2 + 3);
  const sample = sampleIds(ids, [4]);
  expect(sample.length).toBe(51);
  expect(sample).toContain(4);
  expect(sample[0]).toBe(3);
  expect(sample.at(-1)).toBeGreaterThan(590);
  expect(sampleIds([3, 5], [5])).toEqual([3, 5]);
});

test("the Opening isn't a reply to anything, so it isn't checked", async () => {
  const saves = saveStore(savesDir);
  const id = saves.create({ worldBrief: "A wet town.", pc: { name: "Ash" } });
  saves.commitTurn(id, 0, OPENING_INPUT, "It begins.", undefined, (state) => state);
  saves.commitTurn(id, saves.latestMessageId(id), "Look.", "You look.", undefined, (state) => state);
  const { textProvider, prompts } = scriptedTextProvider(answers());
  await run(copyOf(id), textProvider);
  expect(prompts.length).toBe(1);
  expect(asked(prompts[0]!).reply).toBe("You look.");
});

test("answers are compared with the marks, and only counts reach the console", async () => {
  const copy = copyOfSave(4);
  writeFileSync(
    labelsPath,
    JSON.stringify({
      2: { ...CLEAN, contradicts: true, note: "the jacket" }, // caught
      4: { ...CLEAN, decides_for_pc: true }, // missed
      6: CLEAN, // a good reply rejected
    }),
  );
  await run(copy, scriptedTextProvider(answers({ contradicts: true }), answers(), answers({ background_ending: true }), answers({ repeats_player: true })).textProvider);

  const { counts, replies } = results(copy);
  expect(counts.contradicts).toEqual({ caught: 1, missed: 0, falseAlarms: 0, clean: 2 });
  expect(counts.decides_for_pc).toEqual({ caught: 0, missed: 1, falseAlarms: 0, clean: 2 });
  expect(counts.background_ending).toEqual({ caught: 0, missed: 0, falseAlarms: 1, clean: 2 });
  expect(counts.total).toEqual({ caught: 1, missed: 1, falseAlarms: 1, clean: 9 });
  expect(counts.goodReplies).toBe(1);
  expect(counts.goodRejected).toBe(1);
  expect(counts.flaggedUnmarked).toBe(1);
  expect(replies[0].message).toBe(2);
  expect(replies[0].answers.contradicts.reason).toContain(REASON);
  expect(replies[0].marks.contradicts).toBe(true);

  const shown = printed.join("\n");
  expect(shown).toContain("1 caught");
  expect(shown).toContain("1 false alarms");
  expect(shown).toContain("Good replies rejected: 1 of 1");
  expect(shown).toContain("Seconds per reply");
  for (const secret of [REASON, STORY, KEY, "jacket"]) expect(shown).not.toContain(secret);
});

test("cost comes from estimated tokens at the listed price, and is unknown without one", async () => {
  const copy = copyOfSave(1);
  await run(copy, scriptedTextProvider(answers()).textProvider);
  expect(results(copy).counts.costPerReply).toBeGreaterThan(0);
  expect(printed.join("\n")).toMatch(/Cost per reply: about \$\d/);

  server.setModels({ data: [] });
  printed = [];
  const second = join(folder.path, "second.sqlite");
  copyFileSync(copy, second);
  await run(second, scriptedTextProvider(answers()).textProvider);
  expect(results(second).counts.costPerReply).toBeNull();
  expect(printed.join("\n")).toContain("Cost per reply: unknown");
});

test("a refused reply is counted and the rest still run", async () => {
  const copy = copyOfSave(2);
  await run(copy, scriptedTextProvider(new ContentRefused(), answers()).textProvider);
  const { counts, replies } = results(copy);
  expect(replies[0]).toEqual({ message: 2, failed: "refused" });
  expect(replies[1].answers.contradicts.yes).toBe(false);
  expect(counts.failed).toBe(1);
  expect(printed.join("\n")).toContain("No answer: 1");
});

test("an unusable answer is asked again, and every attempt counts toward the cost", async () => {
  const once = copyOfSave(1);
  await run(once, scriptedTextProvider(answers()).textProvider);
  const twice = join(folder.path, "twice.sqlite");
  copyFileSync(once, twice);
  const { textProvider, prompts } = scriptedTextProvider("not JSON", answers());
  await run(twice, textProvider);
  expect(prompts.length).toBe(2);
  expect(results(twice).replies[0].answers.contradicts.yes).toBe(false);
  expect(results(twice).counts.costPerReply).toBeGreaterThan(results(once).counts.costPerReply * 1.9);
});

test("bad labels cost no call", async () => {
  const copy = copyOfSave(1);
  const { textProvider, prompts } = scriptedTextProvider();
  for (const bad of ["not JSON", JSON.stringify({ 2: { contradicts: true } }), JSON.stringify({ two: CLEAN })]) {
    writeFileSync(labelsPath, bad);
    await expect(run(copy, textProvider)).rejects.toThrow("labels file");
  }
  writeFileSync(labelsPath, JSON.stringify({ 1: CLEAN }));
  await expect(run(copy, textProvider)).rejects.toThrow("Message 1 ");
  writeFileSync(labelsPath, JSON.stringify({ 99: CLEAN }));
  await expect(run(copy, textProvider)).rejects.toThrow("Message 99 ");
  expect(prompts).toEqual([]);
  expect(existsSync(`${copy}.check-replies.json`)).toBe(false);
});

test("earlier results are never overwritten, as they cost money", async () => {
  const copy = copyOfSave(1);
  writeFileSync(`${copy}.check-replies.json`, "earlier");
  const { textProvider, prompts } = scriptedTextProvider();
  await expect(run(copy, textProvider)).rejects.toThrow("already has results");
  expect(prompts).toEqual([]);
  expect(readFileSync(`${copy}.check-replies.json`, "utf8")).toBe("earlier");
});

test("the command runs through the real Text Provider client, keeping story text and the key off the console", async () => {
  const copy = copyOfSave(1);
  server.stop();
  server = fakeOpenAi([[delta(answers()), "data: [DONE]\n\n"]], PRICED);
  settings();
  const child = Bun.spawn([process.execPath, "run", SCRIPT, copy, settingsPath, labelsPath], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited).toBe(0);
  expect(out).toContain("Seconds per reply");
  expect(server.requests[0]!.authorization).toBe(`Bearer ${KEY}`);
  for (const secret of [REASON, STORY, KEY]) expect(out + err).not.toContain(secret);
  expect(results(copy).replies[0].answers.contradicts.reason).toContain(REASON);
});

test("the command says what it needs", async () => {
  const child = Bun.spawn([process.execPath, "run", SCRIPT], { stdout: "pipe", stderr: "pipe" });
  const err = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(err).toContain("Give the path of a Save copy");
});
