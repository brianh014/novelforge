import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { assemblePrompt, journalNote } from "../src/prompt-assembler";
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
const THREAD = `${SECRET} a plot.`;
const MISSING = "Where is Renata?";
const SOCIAL = "The Summer Social is on Friday.";
const ASK_TO_FILL = "fill it now";
const add = (loose_end: string): StateOperation => ({ op: "add_loose_end", loose_end });
const resolve = (loose_end: string): StateOperation => ({ op: "resolve_loose_end", loose_end });
const withEnds = (...looseEnds: string[]) => ({ ...structuredClone(openingState), looseEnds });
const store = () => saveStore(savesDir);
const createSave = (...looseEnds: string[]) =>
  store().create({ worldBrief: "A drowned city", pc: { name: "Ash" }, opening: { looseEnds, plotThreads: [THREAD] } });
const turn = (id: string, input = "I wait.") => app.post(`/saves/${id}/turns`, { input });
const edit = (id: string, change: object) => app.post(`/saves/${id}/edits`, change);
const ends = (id: string) => store().latestState(id).looseEnds;
const journal = async (id: string) => ((await (await app.get(`/saves/${id}/journal`)).json()) as { looseEnds: string[] }).looseEnds;
const textOf = (prompt: { content: string }[]) => prompt.map(({ content }) => content).join("\n");
/** A World Change reply, which settles Journal edits before a Turn. */
const settled = (plot_threads: { old: string | null; new: string | null }[] = []) =>
  JSON.stringify({ lore_entries: [], removed_lore: [], world_rules: [], plot_threads, world_brief: null, summary: null, facts: [], npc_summaries: [] });

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
  play(narration("One.", add(SOCIAL)), settled(), narration("Two.", resolve(SOCIAL)));
  const id = createSave();
  await turn(id);
  await edit(id, { edit: "looseEnd", old: null, new: MISSING });
  await turn(id);

  expect(prompts[2]!.at(-2)!.content).toContain(MISSING);
  expect(ends(id)).toEqual([MISSING]);

  await app.post(`/saves/${id}/messages/2/revert`, {});
  expect(ends(id)).toEqual([SOCIAL]);
  expect(store().snapshot(id, 1).looseEnds).toEqual([]);
});

const DROPPED = "took these off looseEnds";

test("a Loose End the player removes is told to the next Turn as dropped, not unsaid, and only that Turn", async () => {
  play(narration("One."), settled(), narration("Two."), narration("Three."));
  const id = createSave(MISSING);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });
  await turn(id);
  await turn(id);

  const told = textOf(prompts[2]!);
  expect(told).toContain(DROPPED);
  expect(told).toContain(JSON.stringify([MISSING]));
  expect(told).toContain("still happened");
  // The list is empty now, but by the player's hand, so it isn't filled again.
  expect(told).not.toContain(ASK_TO_FILL);
  expect(textOf(prompts[3]!)).not.toContain(DROPPED);
});

test("Journal edits are settled by a World Change of their own before the Turn, which sees the result", async () => {
  play(narration("One."), settled([{ old: THREAD, new: `${SECRET} a quieter plot.` }]), narration("Two."), narration("Three."));
  const id = createSave(MISSING);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });
  await turn(id);
  await turn(id);

  const asked = textOf(prompts[1]!);
  expect(asked).toContain("changing its world between Turns");
  expect(asked).toContain(DROPPED);
  expect(asked).toContain(MISSING);
  expect(asked).toContain("never change the summary");
  expect(textOf(prompts[2]!)).toContain("a quieter plot");
  expect(textOf(prompts[2]!)).not.toContain(THREAD);
  // Settled once: the third Turn is the next reply in the script.
  expect(prompts).toHaveLength(4);
});

test("a World Change that finds nothing to change still settles the edits, and a failed one lets the Turn go ahead", async () => {
  play(narration("One."), settled(), narration("Two."), "not json", "not json", "not json", narration("Three."));
  const id = createSave(MISSING, SOCIAL);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });
  expect((await turn(id)).status).toBe(201);
  await edit(id, { edit: "looseEnd", old: SOCIAL, new: null });

  const line = await logOf(() => turn(id).then((r) => r.text()), "warning");

  expect(line).toContain("Journal edits weren't settled before the Turn");
  expect(line).not.toContain(SOCIAL);
  expect(store().messages(id).at(-1)!.text).toBe("Three.");
});

test("Tell the Narrator's own Journal changes aren't settled again", async () => {
  play(settled([{ old: THREAD, new: `${SECRET} a quieter plot.` }]), narration("One."));
  const id = createSave(MISSING);
  expect((await app.post(`/saves/${id}/world-change`, { change: "calmer" })).status).toBe(200);
  expect((await turn(id)).status).toBe(201);

  expect(prompts).toHaveLength(2);
});

test("a Regenerate is told again of the Journal changes made before the reply it replaces", async () => {
  play(narration("One."), settled(), narration("Two."), narration("Two again."));
  const id = createSave(MISSING);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });
  await turn(id);

  expect((await app.post(`/saves/${id}/messages/4/regenerate`, {})).status).toBe(201);

  expect(textOf(prompts.at(-1)!)).toContain(DROPPED);
});

test("a Journal note says what each change means, and names a reworded item's old wording", () => {
  const note = journalNote([
    { edit: "fact", old: "The bell rang twice.", new: "The bell rang three times." },
    { edit: "npcSummary", name: "Renata", text: "A ferry pilot." },
    { edit: "chapterTitle", index: 0, title: "Low Water" },
  ]);

  expect(note).toContain(`true as worded: ${JSON.stringify(["The bell rang three times."])}`);
  expect(note).toContain(`don't put them back: ${JSON.stringify(["The bell rang twice."])}`);
  expect(note).toContain('"Renata":"A ferry pilot."');
  expect(note).not.toContain("Low Water");
  expect(journalNote([{ edit: "chapterTitle", index: 0, title: "Low Water" }])).toBe("");
});

test("a Journal note follows each item through its edits, from the wording the Narrator last saw", () => {
  // Added and taken off again, which the Narrator never saw.
  expect(
    journalNote([
      { edit: "looseEnd", old: null, new: SOCIAL },
      { edit: "looseEnd", old: SOCIAL, new: null },
    ]),
  ).toBe("");
  // Reworded and then taken off: the Narrator hears of the wording it knew.
  const reworded = journalNote([
    { edit: "looseEnd", old: MISSING, new: "Renata never came home." },
    { edit: "looseEnd", old: "Renata never came home.", new: null },
  ]);
  expect(reworded).toContain(`${DROPPED}: ${JSON.stringify([MISSING])}`);
  expect(reworded).not.toContain("never came home");
  // Reworded twice, and back again, comes to nothing.
  expect(
    journalNote([
      { edit: "looseEnd", old: MISSING, new: "A." },
      { edit: "looseEnd", old: "A.", new: MISSING },
    ]),
  ).toBe("");
});

test("a Journal note leaves out what a World Change wrote, as that isn't the player's", () => {
  const update = { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [] };
  const note = journalNote([
    { edit: "looseEnd", old: MISSING, new: null },
    { edit: "fact", old: null, new: "Bells ring." },
    { edit: "world", update, made: 1 },
  ]);

  expect(note).toContain(DROPPED);
  expect(note).not.toContain("Bells ring.");
});

test("an Edit is told of the player's Journal edits, and doesn't refill the Loose Ends they emptied", async () => {
  play(narration("One."), settled(), narration("One, edited."));
  const id = createSave(MISSING);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });

  expect((await app.post(`/saves/${id}/messages/2/edit`, { text: "One, edited." })).status).toBe(201);

  const told = textOf(prompts.at(-1)!);
  expect(told).toContain(DROPPED);
  expect(told).not.toContain(ASK_TO_FILL);
});

test("a stale Regenerate makes no World Change, and a fresh one settles against the state before the response", async () => {
  const ADDED = `${SECRET} a thread from the response.`;
  play(narration("One."), narration("Two.", { op: "add_plot_thread", thread: ADDED }), settled(), narration("Two again."));
  const id = createSave(MISSING);
  await turn(id);
  await turn(id);
  await edit(id, { edit: "looseEnd", old: MISSING, new: null });

  expect((await app.post(`/saves/${id}/messages/2/regenerate`, {})).status).toBe(409);
  expect(prompts).toHaveLength(2);

  expect((await app.post(`/saves/${id}/messages/4/regenerate`, {})).status).toBe(201);
  expect(textOf(prompts[2]!)).toContain("changing its world between Turns");
  expect(textOf(prompts[2]!)).not.toContain(ADDED);
});

test.each([
  ["Rewrite", "rewrite", { feedback: "Softer." }],
  ["Regenerate", "regenerate", {}],
])("%s starts again from the list before the Turn, and keeps a later edit", async (_, action, body) => {
  play(narration("One.", add("Gone with the response.")), settled(), narration("Two.", add(SOCIAL)));
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
