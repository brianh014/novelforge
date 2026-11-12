import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { assemblePrompt } from "../src/prompt-assembler";
import { saveStore } from "../src/save-store";
import { applyOperations, openingState, type State, type StateOperation } from "../src/state-applier";
import { logOf, narration, scriptedDice, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let app: ReturnType<typeof startApp>;
let prompts: ReturnType<typeof scriptedTextProvider>["prompts"];

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

const SECRET = "ZQX-SECRET";
const MISSING = "Where is Renata?";
const SOCIAL = "The Summer Social is on Friday.";
const ASK_TO_FILL = "fill it now";
const add = (loose_end: string): StateOperation => ({ op: "add_loose_end", loose_end });
const resolve = (loose_end: string): StateOperation => ({ op: "resolve_loose_end", loose_end });
const withEnds = (...looseEnds: string[]) => ({ ...structuredClone(openingState), looseEnds });
const store = () => saveStore(savesDir);
const createSave = (...looseEnds: string[]) =>
  store().create({ worldBrief: "A drowned city", pc: { name: "Ash" }, opening: { looseEnds, plotThreads: [`${SECRET} a plot.`] } });
const turn = (id: string, input = "I wait.") => app.post(`/saves/${id}/turns`, { input });
const edit = (id: string, change: object) => app.post(`/saves/${id}/edits`, change);
const ends = (id: string) => store().latestState(id).looseEnds;
const journal = async (id: string) => ((await (await app.get(`/saves/${id}/journal`)).json()) as { looseEnds: string[] }).looseEnds;
const textOf = (prompt: { content: string }[]) => prompt.map(({ content }) => content).join("\n");

const promptWith = (state: Partial<State>, ...text: string[]) =>
  textOf(
    assemblePrompt({
      save: { worldBrief: "A drowned city", pc: { name: "Ash" }, startingHook: "" },
      state: { ...structuredClone(openingState), ...state },
      messages: text.map((line, index) => ({ id: index + 1, role: index % 2 ? "narrator" : "player", text: line })),
      modelInstructions: "",
      input: "I wait.",
      responseSchema: "{}",
      promptStyle: null,
    }),
  );

test("add_loose_end adds an item, and an exact repeat is counted, not refused", () => {
  const { next, refused, repeats } = applyOperations(openingState, [add(MISSING), add(MISSING)]);

  expect(next.looseEnds).toEqual([MISSING]);
  expect(refused).toEqual([]);
  expect(repeats).toBe(1);
});

test("resolve_loose_end takes out the exact item", () => {
  expect(applyOperations(withEnds(MISSING, SOCIAL), [resolve(MISSING)]).next.looseEnds).toEqual([SOCIAL]);
});

test("resolve_loose_end on an item not in the list is ignored with a reason, and changes nothing", () => {
  const { next, refused, ignored } = applyOperations(withEnds(SOCIAL), [resolve("Where is Renata")]);

  expect(next.looseEnds).toEqual([SOCIAL]);
  expect(refused).toEqual([]);
  expect(ignored).toEqual([{ op: "resolve_loose_end", reason: "not there" }]);
});

test("a miscopied resolve costs no Turn or second call, and logs why with no story text", async () => {
  play(narration("A line.", resolve("ZQX"), add(SOCIAL)));
  const id = createSave(MISSING);

  const line = await logOf(() => turn(id).then((r) => r.text()), "warning");

  expect(prompts).toHaveLength(1);
  expect(ends(id)).toEqual([MISSING, SOCIAL]);
  expect(line).toMatch(/WARNING turn .*resolve_loose_end: not there/);
  expect(line).not.toContain("ZQX");
});

test("a repeated Loose End logs only its count, at Info", async () => {
  play(narration("A line.", add("ZQX"), add("ZQX")));
  const id = createSave();

  const line = await logOf(() => turn(id).then((r) => r.text()), "info");

  expect(line).toMatch(/Repeats ignored .*"count":1/);
  expect(line).not.toContain("ZQX");
});

test("a Check request can't change the list, even with operations beside it", async () => {
  play(JSON.stringify({ check: { action: "Leap", difficulty: "Easy" }, state_operations: [add(SECRET)] }), narration("You land."));
  const id = createSave(MISSING);

  expect((await turn(id, "I leap.")).status).toBe(201);

  expect(prompts).toHaveLength(2);
  expect(ends(id)).toEqual([MISSING]);
});

test("the prompt carries the list and its rules, and forbids secrets in it", () => {
  const prompt = promptWith({ looseEnds: [MISSING] });

  expect(prompt).toContain(`"looseEnds":${JSON.stringify([MISSING])}`);
  for (const words of [
    "add_loose_end",
    "resolve_loose_end",
    "copying the item exactly",
    "never to make room",
    "write them as the PC would, with no Lore Entry or Plot Thread secrets",
  ]) {
    expect(prompt).toContain(words);
  }
});

test("an empty list on a started story asks for it to be filled, and nothing else does", () => {
  expect(promptWith({}, "I wait.", "It rains.")).toContain(ASK_TO_FILL);
  expect(promptWith({ looseEnds: [MISSING] }, "I wait.", "It rains.")).not.toContain(ASK_TO_FILL);
  expect(promptWith({})).not.toContain(ASK_TO_FILL);
});

test("the Journal shows the list, and the player can add to, edit and remove from it", async () => {
  play();
  const id = createSave();
  expect(await journal(id)).toEqual([]);

  expect((await edit(id, { edit: "looseEnd", old: null, new: MISSING })).status).toBe(200);
  await edit(id, { edit: "looseEnd", old: null, new: SOCIAL });
  await edit(id, { edit: "looseEnd", old: MISSING, new: "Renata never came home." });
  expect(await journal(id)).toEqual(["Renata never came home.", SOCIAL]);

  await edit(id, { edit: "looseEnd", old: SOCIAL, new: null });
  expect(await journal(id)).toEqual(["Renata never came home."]);
});

test("an edit naming an item the Journal doesn't show is refused, as is an empty one", async () => {
  play();
  const id = createSave(MISSING);

  expect((await edit(id, { edit: "looseEnd", old: "Never there.", new: "x" })).status).toBe(404);
  expect((await edit(id, { edit: "looseEnd", old: null, new: null })).status).toBe(400);
  expect(ends(id)).toEqual([MISSING]);
});

test("the next Turn hears a Journal edit, and a Revert undoes it and the Turn's own changes", async () => {
  play(narration("One.", add(SOCIAL)), narration("Two.", resolve(SOCIAL)));
  const id = createSave();
  await turn(id);
  await edit(id, { edit: "looseEnd", old: null, new: MISSING });
  await turn(id);

  expect(prompts[1]!.at(-2)!.content).toContain(MISSING);
  expect(ends(id)).toEqual([MISSING]);

  await app.post(`/saves/${id}/messages/2/revert`, {});
  expect(ends(id)).toEqual([SOCIAL]);
  expect(store().snapshot(id, 1).looseEnds).toEqual([]);
});

test.each([
  ["Rewrite", "rewrite", { feedback: "Softer." }],
  ["Regenerate", "regenerate", {}],
])("%s starts again from the list before the Turn, and keeps a later edit", async (_, action, body) => {
  play(narration("One.", add("Gone with the response.")), narration("Two.", add(SOCIAL)));
  const id = createSave(MISSING);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: null, new: "Added by hand." });

  expect((await app.post(`/saves/${id}/messages/2/${action}`, body)).status).toBe(201);

  expect(ends(id)).toEqual([MISSING, "Added by hand.", SOCIAL]);
});

test("export and import keep the list", async () => {
  play();
  const id = createSave(MISSING);

  const bytes = await (await app.get(`/saves/${id}/export`)).bytes();
  const imported = await fetch(app.url("/saves/import"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });

  expect(ends(((await imported.json()) as { id: string }).id)).toEqual([MISSING]);
});

test("a Save from before Loose Ends upgrades with an empty list, and is asked to fill it", async () => {
  play(narration("One."));
  const id = createSave();
  await turn(id);
  await app.stop();
  {
    using db = new Database(join(savesDir, `${id}.sqlite`));
    db.run("DELETE FROM snapshot_sections WHERE name = 'looseEnds'; PRAGMA user_version = 13");
  }
  const script = scriptedTextProvider(narration("Two.", add(MISSING)));
  prompts = script.prompts;
  app = startApp(savesDir, script.textProvider);

  expect(await journal(id)).toEqual([]);
  expect(store().snapshot(id, 1).looseEnds).toEqual([]);
  expect((await turn(id)).status).toBe(201);

  expect(textOf(prompts[0]!)).toContain(ASK_TO_FILL);
  expect(ends(id)).toEqual([MISSING]);
});

test("a World Change can't reach the list, whatever its reply says", async () => {
  play(
    JSON.stringify({
      lore_entries: [],
      removed_lore: [],
      world_rules: [{ old: null, new: "Bees rule." }],
      plot_threads: [],
      world_brief: null,
      summary: null,
      facts: [],
      npc_summaries: [],
      loose_ends: [{ old: null, new: SECRET }],
      looseEnds: [SECRET],
    }),
  );
  const id = createSave(MISSING);

  expect((await app.post(`/saves/${id}/world-change`, { change: "bees rule" })).status).toBe(200);

  expect(ends(id)).toEqual([MISSING]);
});

test("a new story can't be given Loose Ends from outside", async () => {
  play();
  const created = await app.post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash" }, looseEnds: [SECRET], opening: { looseEnds: [SECRET] } });

  expect(await journal(((await created.json()) as { id: string }).id)).toEqual([]);
});
