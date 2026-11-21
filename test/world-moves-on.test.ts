import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { startServer } from "../src/rest-api";
import { saveStore } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { applyEdit, applyOperations, MAX_NPC_KNOWS, openingState, type WorldEdit } from "../src/state-applier";
import { journalChange } from "../src/prompt-assembler";
import { MOVE_EVERY, moveDue, turnThreadChanges } from "../src/world-moves-on";
import { logOf, narration, scriptedDice, scriptedImages, scriptedTextProvider, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let server: ReturnType<typeof startServer>;

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});
afterEach(async () => {
  await server.stop(true);
  folder.remove();
});

function play(...replies: (string | Error | Promise<string>)[]) {
  const settings = settingsStore(join(dirname(savesDir), "settings.json"));
  settings.update({ textModel: "narrator/model" });
  const told = scriptedTextProvider(...replies);
  server = startServer({
    savesDir,
    settings,
    textProvider: told.textProvider,
    imageAdapter: scriptedImages().imageAdapter,
    dice: scriptedDice(),
    nearMissMargin: 2,
    port: 0,
    moveWorld: true,
    writePicture: async (_ask, _style, fallback) => fallback,
    reviewPicture: async (description) => description,
  });
  return told;
}

const THIEF = "A thief plans to rob the library at the next high tide.";
const store = () => saveStore(savesDir);
const createSave = () =>
  store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The library", visibleCast: [] },
      summary: "",
      worldRules: ["The city has one boat."],
      plotThreads: [THIEF],
      worldBible: [
        { title: "The thief", keywords: ["thief"], content: "The thief is the librarian's own son.", alwaysOn: false },
        { title: "Gulls", keywords: ["gull"], content: "Gulls nest on the dome.", alwaysOn: false },
      ],
    },
  });
const turn = (id: string, input: string) =>
  fetch(new URL(`/saves/${id}/turns`, server.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
const moved = (...plot_threads: object[]) => JSON.stringify({ plot_threads });
/** A move's change: a thread's new now, or null to remove it, and a truth only to add one. */
const change = (thread: string | null, now: string | null, truth: string | null = null) => ({ thread, truth, now });
// A new day, which makes a move due.
const nextDay = (date = "2nd of Thaw") => ({ op: "set_story_time", days_passed: 1, date, time_of_day: "dawn" });
// A Turn's own rewrite of a thread's now, which makes that now the newest reply's.
const FRESH_NOW = "The vicar waits in the vestry for night.";
const setNow = (thread: string) => ({ op: "update_plot_thread", thread, truth: null, now: FRESH_NOW, plan: null });

test("on a new day the world moves on out of sight, rewriting a thread's now and keeping its truth, and the next Turn reads both", async () => {
  const told = play(
    narration(
      "Ash walks to the dock.",
      { op: "add_npc", name: "Ferryman", appearance: "a stooped man in oilskins" },
      { op: "set_scene", location: "The dock", visible_cast: ["Ferryman"] },
      nextDay(),
    ),
    moved(change(THIEF, "The thief has robbed the library and hides the books on a barge.")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    expect((await turn(id, "I walk to the dock.")).ok).toBe(true);
    expect((await turn(id, "I watch the barges.")).ok).toBe(true);
  }, "info");

  // The move was asked between the Turns, with the threads and the story so far.
  expect(told.prompts.length).toBe(3);
  expect(JSON.parse(told.prompts[1]!.at(-1)!.content).plot_threads).toEqual([{ truth: THIEF, now: "" }]);
  // With the Lore Entries its threads name, so a move keeps who is behind each one true to the world.
  expect(told.prompts[1]!.at(-1)!.content).toContain("the librarian's own son");
  expect(told.prompts[1]!.at(-1)!.content).not.toContain("Gulls nest");
  // And the world rules, so a move keeps to the setting's own facts.
  expect(told.prompts[1]!.at(-1)!.content).toContain("The city has one boat.");
  // And who is with the PC, so a move doesn't retell the scene in play as what they did out of sight.
  expect(told.prompts[1]!.at(-1)!.content).toContain('"visible_cast":["Ferryman"]');
  const next = told.prompts[2]!.map(({ content }) => content).join("\n");
  expect(next).toContain(JSON.stringify({ truth: THIEF, now: "The thief has robbed the library and hides the books on a barge." }));
  expect(store().latestState(id).plotThreads).toEqual([THIEF]);
  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: "The thief has robbed the library and hides the books on a barge." });
  expect(log).toContain('"threads":1,"rewritten":1,"added":0,"removed":0');
  expect(log).not.toContain("barge");
});

test("a move can't change what a thread hides: a truth it gives for a rewrite is left out, and its now is kept", async () => {
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(THIEF, "The thief waits at the dock for the tide.", "Someone waits at the dock.")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    for (const input of ["I walk to the dock.", "I watch the barges."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual([THIEF]);
  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: "The thief waits at the dock for the tide." });
  expect(log).toContain('"truthsIgnored":1');
});

test("a thread from a Save before the split has its one text as its truth and no now, and is moved on by its now", async () => {
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(THIEF, "The thief has robbed the library.")),
    narration("Ash watches the barges."),
  );
  // As an older Save or a bench world holds it: one text per thread, and no threadsNow.
  const id = createSave();
  expect(store().latestState(id).threadsNow).toEqual({});

  for (const input of ["I walk to the dock.", "I watch the barges."]) expect((await turn(id, input)).ok).toBe(true);

  expect(store().latestState(id).plotThreads).toEqual([THIEF]);
  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: "The thief has robbed the library." });
});

test("an old World Change's rewrite of a thread's one text still applies, as its truth", () => {
  const edit: WorldEdit = {
    edit: "world",
    update: { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [{ old: THIEF, new: "The thief has fled." }] },
  };
  const state = { ...structuredClone(openingState), plotThreads: [THIEF], threadsNow: { [THIEF]: "He waits." } };
  const next = applyEdit(state, edit);

  expect(next.plotThreads).toEqual(["The thief has fled."]);
  // A truth rewritten by a World Change starts with no now, as the old one may no longer fit it.
  expect(next.threadsNow).toEqual({});
});

test("a World Change sent while the world is moving on waits for the move, so it reads the thread as moved", async () => {
  let finish: (reply: string) => void = () => {};
  const told = play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    new Promise<string>((resolve) => (finish = resolve)),
    JSON.stringify({
      lore_entries: [],
      removed_lore: [],
      world_rules: [{ old: null, new: "The mayor rules the city." }],
      plot_threads: [],
      world_brief: null,
      summary: null,
      facts: [],
      npc_summaries: [],
    }),
  );
  const id = createSave();
  await (await turn(id, "I walk to the dock.")).text();
  const worldChange = fetch(new URL(`/saves/${id}/world-change`, server.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ change: "the thief is the mayor" }),
  });
  await Bun.sleep(50);
  // Still waiting for the move, so the World Change hasn't asked yet.
  expect(told.prompts.length).toBe(2);
  finish(moved(change(THIEF, "The thief has robbed the library and hides the books on a barge.")));

  expect((await worldChange).ok).toBe(true);
  expect(told.prompts[2]!.map(({ content }) => content).join("\n")).toContain("hides the books on a barge");
});

test("a move reads the Lore Entries the story names too, not only its threads', so a thread it adds keeps to the world", async () => {
  const told = play(
    narration(
      "Ash catches the thief where a gull nests on the dome.",
      { op: "resolve_plot_thread", thread: THIEF },
      { op: "set_scene", location: "The dome", visible_cast: [] },
      nextDay(),
    ),
    moved(),
    narration("Ash looks out over the city."),
  );
  const id = createSave();

  expect((await turn(id, "I climb to the dome.")).ok).toBe(true);
  // The next Turn waits for the move.
  expect((await turn(id, "I look out.")).ok).toBe(true);

  expect(told.prompts[1]!.at(-1)!.content).toContain("Gulls nest");
});

test("a move is told which of each thread's people are with the PC, so it never puts them elsewhere", async () => {
  const told = play(
    narration(
      "Ash meets Kit in the library.",
      { op: "add_npc", name: "Kit", appearance: "a boy in a cap" },
      { op: "set_scene", location: "The library", visible_cast: ["Kit"] },
      { op: "update_plot_thread", thread: THIEF, truth: null, now: "Kit watches the library stacks.", plan: null },
      nextDay(),
    ),
    moved({ ...change(THIEF, "Kit watches the library stacks."), knows: [{ name: "Kit", knows: "A thief is coming." }] }),
    narration("Ash reads."),
  );
  const id = createSave();
  expect((await turn(id, "I go in.")).ok).toBe(true);
  expect((await turn(id, "I read.")).ok).toBe(true);

  expect(JSON.parse(told.prompts[1]!.at(-1)!.content).plot_threads[0].with_pc).toEqual(["Kit"]);
});

test("a move is told which of each thread's people the latest replies showed after they left, so it starts them from there", async () => {
  const told = play(
    narration(
      "Kit runs off down the quay.",
      { op: "add_npc", name: "Kit", appearance: "a boy in a cap" },
      { op: "set_scene", location: "The library", visible_cast: [] },
      { op: "update_plot_thread", thread: THIEF, truth: null, now: "Kit watches the library stacks.", plan: null },
      nextDay(),
    ),
    moved({ ...change(THIEF, "Kit hides on the quay."), knows: [{ name: "Kit", knows: "A thief is coming." }] }),
    narration("Ash reads."),
  );
  const id = createSave();
  expect((await turn(id, "I go in.")).ok).toBe(true);
  expect((await turn(id, "I read.")).ok).toBe(true);

  const thread = JSON.parse(told.prompts[1]!.at(-1)!.content).plot_threads[0];
  expect(thread.seen_lately).toEqual(["Kit"]);
  expect(thread.with_pc).toBeUndefined();
});

test("a move reads the replies the summary doesn't cover yet, as the summary is written only every few replies", async () => {
  const told = play(
    narration("Ash enters the archive.", { summary: "Ash entered the archive." }),
    narration("Ash finds the ledger."),
    narration("Ash reads the ledger."),
    narration("Ash hides the ledger.", nextDay()),
    moved(),
    narration("Ash sleeps."),
  );
  const id = createSave();
  for (const move of ["I go in.", "I search.", "I read.", "I hide it."]) expect((await turn(id, move)).ok).toBe(true);
  expect((await turn(id, "I sleep.")).ok).toBe(true);

  const sent = JSON.parse(told.prompts[4]!.at(-1)!.content);
  expect(sent.summary).toBe("Ash entered the archive.");
  expect(sent.earlier_replies).toEqual([expect.stringContaining("finds the ledger")]);
  expect(sent.latest_replies).toEqual([expect.stringContaining("reads the ledger"), expect.stringContaining("hides the ledger")]);
});

test("a Turn's resolve only asks the next move to close the thread, which the move removes or keeps", async () => {
  const told = play(
    narration(
      "Ash catches the thief at the dock.",
      { op: "resolve_plot_thread", thread: THIEF },
      { op: "set_scene", location: "The dock", visible_cast: [] },
      nextDay(),
    ),
    moved(change(THIEF, null), change(null, "He walks the docks at night.", "The thief's father wants him back.")),
    narration("Ash looks out over the water."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    expect((await turn(id, "I catch him.")).ok).toBe(true);
    // The next Turn waits for the move.
    expect((await turn(id, "I look out.")).ok).toBe(true);
  }, "info");

  // Still open when the move was asked, which was told the Turn asked to close it.
  const asked = JSON.parse(told.prompts[1]!.at(-1)!.content);
  expect(asked.plot_threads).toEqual([{ truth: THIEF, now: "" }]);
  expect(asked.asked_to_close).toEqual([THIEF]);
  expect(store().latestState(id).plotThreads).toEqual(["The thief's father wants him back."]);
  expect(store().latestState(id).threadsNow).toEqual({ "The thief's father wants him back.": "He walks the docks at night." });
  expect(log).toContain('"closeAsked":1');
  expect(log).toContain('"asked":1,"closed":1');
});

test("a close ask follows its thread through a later amended truth, and a Turn logs only the asks that matched a thread", async () => {
  const AMENDED = "The thief, the librarian's son, plans to rob the library at the next high tide.";
  const told = play(
    narration("Ash hears of a ghost.", { op: "resolve_plot_thread", thread: "A ghost haunts the dome." }),
    narration("Ash corners the thief.", { op: "resolve_plot_thread", thread: THIEF }),
    narration("The thief slips away.", { op: "update_plot_thread", thread: THIEF, now: "He hides.", truth: AMENDED }, nextDay()),
    moved(),
    narration("Ash looks out."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    for (const input of ["I listen.", "I grab him.", "I chase him.", "I look out."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(JSON.parse(told.prompts[3]!.at(-1)!.content).asked_to_close).toEqual([AMENDED]);
  expect(log).toContain('"closeAsked":0');
  expect(log).toContain('"closeAsked":1');
  expect(log).toContain('Thread truths amended {"route":"/saves/:id/turns","save":"');
});

test("a Turn amends a thread's truth only when the reply names someone the thread names, and otherwise keeps only its now", () => {
  const state = { ...openingState, npcs: [{ name: "Grout", appearance: "" }], plotThreads: ["Grout hides the ledger.", "The tide is wrong."] };
  const operations = [
    { op: "update_plot_thread", thread: "Grout hides the ledger.", now: "Grout waits.", truth: "Grout hid the ledger, and Ash found it." },
    { op: "update_plot_thread", thread: "The tide is wrong.", now: "It turns.", truth: "The tide was always wrong." },
    { op: "update_plot_thread", thread: "Grout hides the ledger.", now: "Grout runs." },
  ] as Parameters<typeof turnThreadChanges>[0];

  expect(turnThreadChanges(operations, state, "Grout lifts the ledger from the chimney.")).toEqual({ kept: operations, dropped: {} });
  const { kept, dropped } = turnThreadChanges(operations, state, "Kit counts his coins.");
  expect(kept).toEqual([{ ...operations[0]!, truth: null } as never, operations[1]!, operations[2]!]);
  expect(dropped).toEqual({ "a truth amended by a reply that never names its people": 1 });
});

test("a move that misquotes a thread, or fails, leaves the world as it was and the next Turn plays", async () => {
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    ...Array.from({ length: 3 }, () => moved(change("No such thread.", "Something else."))),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    expect((await turn(id, "I walk to the dock.")).ok).toBe(true);
    expect((await turn(id, "I watch the barges.")).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual([THIEF]);
  expect(store().latestState(id).threadsNow).toEqual({});
  expect(log).toContain("World didn't move on");
  expect(log).toContain("a change misquotes a thread");
});

test("a move is due after hours of story time, on a new day or every few replies, even with no threads, as only a move adds them", () => {
  const at = (timeOfDay: string, date = "1st of Thaw") => ({ date, timeOfDay, day: 1 });
  const before = { ...openingState, plotThreads: ["A thread."], scene: { location: "Here", visibleCast: [] }, storyTime: at("early afternoon") };
  expect(moveDue("a", before, before, 1)).toBe(false);
  // Walking from room to room isn't a pause, as moves that often rewrote the threads out of what they hid.
  expect(moveDue("a", before, { ...before, scene: { location: "There", visibleCast: [] } }, 1)).toBe(false);
  expect(moveDue("a", before, { ...before, storyTime: at("mid afternoon") }, 1)).toBe(false);
  expect(moveDue("b", before, { ...before, storyTime: at("evening") }, 1)).toBe(true);
  expect(moveDue("a", { ...before, storyTime: at("about 9 a.m.") }, { ...before, storyTime: at("10:30 am") }, 1)).toBe(false);
  expect(moveDue("c", { ...before, storyTime: at("about 9 a.m.") }, { ...before, storyTime: at("half past 2 pm") }, 1)).toBe(true);
  expect(moveDue("a", before, { ...before, storyTime: at("a while later") }, 1)).toBe(false);
  expect(moveDue("d", before, { ...before, storyTime: at("dawn", "2nd of Thaw") }, 1)).toBe(true);
  expect(moveDue("a", before, before, MOVE_EVERY)).toBe(true);
  expect(moveDue("e", before, { ...before, plotThreads: [] }, MOVE_EVERY)).toBe(true);
});

test("the fallback move counts replies since the last move, so a move due on time is never followed by one a reply later", () => {
  const before = { ...openingState, storyTime: { date: "1st of Thaw", timeOfDay: "dawn", day: 1 } };
  const nextDay = { ...before, storyTime: { date: "2nd of Thaw", timeOfDay: "dawn", day: 2 } };

  expect(moveDue("spaced", before, nextDay, MOVE_EVERY * 3 + 2)).toBe(true);
  expect(moveDue("spaced", before, before, MOVE_EVERY * 4)).toBe(false);
  expect(moveDue("spaced", before, before, MOVE_EVERY * 4 + 1)).toBe(false);
  expect(moveDue("spaced", before, before, MOVE_EVERY * 4 + 2)).toBe(true);
});

test("the player's Journal edits are still settled after a move, which settles none of them", () => {
  const fact: WorldEdit = { edit: "fact", old: null, new: "Bees sing." };
  const world = { edit: "world" as const, update: { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [] }, made: 0 };

  expect(journalChange([fact, { ...world, moved: true }])).toContain("Bees sing.");
  expect(journalChange([fact, world])).toBe("");
});

test("a Regenerate and a Rewrite drop the move made from the reply they replace, and the next Turn moves the world again", async () => {
  const robbed = "The thief has robbed the library.";
  const fled = "The thief has fled to the hills.";
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(THIEF, robbed)),
    narration("Ash stays in the library."),
    narration("Ash waits."),
    moved(change(THIEF, robbed)),
    narration("Ash sits in the library."),
    narration("Ash reads."),
    moved(change(THIEF, fled)),
  );
  const id = createSave();
  expect((await turn(id, "I walk to the dock.")).ok).toBe(true);

  for (const [action, body] of [
    ["regenerate", {}],
    ["rewrite", { feedback: "Slower." }],
  ] as const) {
    const replaced = store().latestMessageId(id);
    const line = await logOf(async () => {
      const response = await fetch(new URL(`/saves/${id}/messages/${replaced}/${action}`, server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
      await response.text();
    }, "info");
    expect(store().latestState(id).threadsNow[THIEF]).toBeUndefined();
    expect(line).toContain("World move dropped with the replaced response");
    // Moves the world again at once, for the Rewrite to drop.
    if (action === "regenerate") expect((await turn(id, "I wait.")).ok).toBe(true);
  }
  expect((await turn(id, "I read.")).ok).toBe(true);
  for (let tries = 0; tries < 100 && !store().latestState(id).threadsNow[THIEF]; tries++) await Bun.sleep(10);
  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: fled });
});

test("a move adds threads only while fewer than three are open, as an 80-round story's grew to seven that nothing ended", async () => {
  const add = (truth: string) => change(null, "Soon.", truth);
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(add("The ferryman owes the thief."), add("The gulls are omens."), add("The tide is wrong.")),
    narration("Ash watches the barges.", { op: "set_scene", location: "The quay", visible_cast: [] }, nextDay("3rd of Thaw")),
    // Three open now, so a move of adds alone is no move, and isn't asked again.
    moved(add("A fourth.")),
    narration("Ash goes home."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    for (const input of ["I walk to the dock.", "I walk to the quay.", "I go home."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual([THIEF, "The ferryman owes the thief.", "The gulls are omens."]);
  expect(log).toContain('"overflow":1');
  expect(log).not.toContain("World didn't move on");
});

test("a move removes a thread only when the replies show its people or a Turn asked, and never below three open without an add", async () => {
  const PELL = "Mr Pell means to burn the mill.";
  const told = play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    // Mr Pell is nowhere in the replies, so his thread stays.
    moved(change(PELL, null), change(null, "Soon.", "The tide is wrong.")),
    narration("Ash sees Mr Pell hanged at the quay.", { op: "set_scene", location: "The quay", visible_cast: [] }, nextDay("3rd of Thaw")),
    // Shown now, but removing it would leave one thread and add none, so it's asked again.
    moved(change(PELL, null)),
    moved(change(PELL, null), change(null, "Soon.", "The gulls are omens.")),
    narration("Ash goes home."),
  );
  const id = store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The library", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [PELL],
      worldBible: [{ title: "The miller", keywords: ["Mr Pell"], content: "", alwaysOn: false }],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk to the dock.", "I walk to the quay.", "I go home."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual(["The tide is wrong.", "The gulls are omens."]);
  expect(log).toContain('"dropped":{"a remove of a thread whose people the replies never name":1}');
  expect(told.prompts.some((prompt) => prompt.at(-1)!.content.includes("a remove leaves fewer than three threads and adds none"))).toBe(true);
});

test("a thread whose question play has answered is removed in place of its rewrite, and one missing from left stays", async () => {
  const PELL = "Mr Pell means to burn the mill.";
  const [TIDE, GULLS] = ["The tide is wrong.", "The gulls are omens."];
  play(
    narration("Ash sees Mr Pell hanged at the quay.", { op: "set_scene", location: "The quay", visible_cast: [] }, nextDay()),
    JSON.stringify({
      left: [
        { thread: PELL, answer: "He was hanged at the quay." },
        { thread: TIDE, answer: null, question: "Why the tide turns early." },
      ],
      plot_threads: [change(PELL, "He waits."), change(null, "Soon.", "The mill burns anyway.")],
    }),
    narration("Ash goes home."),
  );
  const id = store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The library", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [PELL, TIDE, GULLS],
      worldBible: [{ title: "The miller", keywords: ["Mr Pell"], content: "", alwaysOn: false }],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk to the quay.", "I go home."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual([TIDE, GULLS, "The mill burns anyway."]);
  expect(log).toContain('"rewritten":0,"added":1,"removed":1');
});

test("an answer that says play hasn't answered it yet leaves the thread open", async () => {
  const PELL = "Mr Pell means to burn the mill.";
  // Four, so a close would leave three and nothing else holds it.
  const [TIDE, GULLS, BELLS] = ["The tide is wrong.", "The gulls are omens.", "The bells ring wrong."];
  play(
    narration("Ash sees Mr Pell at the quay.", { op: "set_scene", location: "The quay", visible_cast: [] }, nextDay()),
    JSON.stringify({ left: [{ thread: PELL, answer: "Not yet: whether the mill burns." }], plot_threads: [] }),
    narration("Ash goes home."),
  );
  const id = store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The library", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [PELL, TIDE, GULLS, BELLS],
      worldBible: [{ title: "The miller", keywords: ["Mr Pell"], content: "", alwaysOn: false }],
    },
  });

  for (const input of ["I walk to the quay.", "I go home."]) expect((await turn(id, input)).ok).toBe(true);

  expect(store().latestState(id).plotThreads).toEqual([PELL, TIDE, GULLS, BELLS]);
});

test("a thread keeps the question it began with, and a plan whose hour the clock has reached is marked due at the next move", async () => {
  const TIDE = "The harbourmaster floods the lower town.";
  const told = play(
    narration("Ash watches the harbourmaster at the sluice.", { ...nextDay(), hours_passed: 20 }),
    JSON.stringify({
      left: [{ thread: TIDE, answer: null, question: "Whether the lower town floods." }],
      plot_threads: [{ thread: TIDE, truth: null, now: "He oils the sluice gate.", plan: "He opens the sluice at dusk.", plan_in_hours: 2 }],
    }),
    narration("Night falls on the quay.", { ...nextDay("3rd of Thaw"), hours_passed: 24 }),
    JSON.stringify({ left: [{ thread: TIDE, answer: null, question: "Whether he is caught." }], plot_threads: [] }),
    narration("Ash goes home."),
  );
  const id = store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [TIDE],
      worldBible: [],
      storyTime: { day: 1, date: "1st of Thaw", timeOfDay: "morning" },
    },
  });

  for (const input of ["I watch the sluice.", "I wait for night.", "I go home."]) expect((await turn(id, input)).ok).toBe(true);

  // The first question stands, never the one a later move gave.
  expect(store().latestState(id).threadsQuestion[TIDE]).toBe("Whether the lower town floods.");
  const moves = told.prompts.filter((prompt) => prompt[0]!.content.startsWith("You plot the hidden side"));
  expect(JSON.parse(moves[0]!.at(-1)!.content).plot_threads[0]).not.toHaveProperty("plan_due");
  expect(JSON.parse(moves[1]!.at(-1)!.content).plot_threads[0]).toMatchObject({ question: "Whether the lower town floods.", plan_due: true });
});

test("a move keeps its usable changes and drops only those that change a thread twice, misquote one or add one without its truth", async () => {
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(THIEF, "The thief waits by the library."), change(THIEF, "The thief strikes."), change("A thread that isn't there.", "x"), change(null, "x")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    expect((await turn(id, "I walk to the dock.")).ok).toBe(true);
    expect((await turn(id, "I watch the barges.")).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: "The thief waits by the library." });
  expect(log).toContain('"dropped":{"a change changes a thread twice":1,"a change misquotes a thread":1,"an add without its truth and now":1}');
});

test("a move sent as an add carrying an open thread's truth rewrites that thread, as GLM sent its rewrites so", async () => {
  play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(null, "The thief waits by the library.", THIEF), change(null, "Soon.", "The tide is wrong."), change(null, "Soon.", "The gulls are omens.")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    for (const input of ["I walk to the dock.", "I watch the barges."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).plotThreads).toEqual([THIEF, "The tide is wrong.", "The gulls are omens."]);
  expect(store().latestState(id).threadsNow[THIEF]).toBe("The thief waits by the library.");
  expect(log).toContain('"rewritten":1,"added":2');
  expect(log).not.toContain("overflow");
});

test("the schemas a move and a Turn are sent name a thread only by an open truth, as models misquoted the truths they copied", async () => {
  const told = play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change(THIEF, "The thief waits by the library.")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  for (const input of ["I walk to the dock.", "I watch the barges."]) expect((await turn(id, input)).ok).toBe(true);

  // Every thread field in each schema, a move's and both Turns', held to the open truth.
  const threadFields = (schema: unknown) => JSON.stringify(schema).match(/"thread":\{[^}]*\}/g) ?? [];
  for (const schema of told.schemas) {
    expect(threadFields(schema).length).toBeGreaterThan(0);
    for (const field of threadFields(schema)) expect(field).toContain(`"enum":[${JSON.stringify(THIEF)}]`);
  }
});

test("a move gives each person a thread names their own part of it, kept as what they know, even for someone not yet met", async () => {
  const ferryman = "He rowed a hooded man across at the last tide.";
  const oren = "He is the thief, and fears the tide will turn early.";
  const told = play(
    narration(
      "Ash walks to the dock.",
      { op: "add_npc", name: "Ferryman", appearance: "a stooped man in oilskins" },
      { op: "set_scene", location: "The dock", visible_cast: ["Ferryman"] },
      { op: "npc_learns", name: "Ferryman", fact: "Ash asked him about boats." },
      nextDay(),
    ),
    moved({
      ...change(THIEF, "The Ferryman, at the dock, will row the thief out at the next tide."),
      knows: [
        { name: "Ferryman", knows: ferryman },
        { name: "Oren", knows: oren },
      ],
    }),
    narration("A thin man steps from a barge.", { op: "add_npc", name: "Oren Vell", appearance: "a thin man" }, nextDay("3rd of Thaw")),
    moved(change(THIEF, "The thief rows out.")),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  const log = await logOf(async () => {
    for (const input of ["I walk to the dock.", "I watch the barge.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  // Kept as what each knows, someone met later under the name they were met by.
  expect(store().latestState(id).npcKnows).toEqual({ Ferryman: ["Ash asked him about boats.", ferryman], "Oren Vell": [oren] });
  // The Narrator reads the Ferryman's part while he is in the scene.
  expect(told.prompts[2]!.map(({ content }) => content).join("\n")).toContain(ferryman);
  // The next move reads what the people its threads name already know.
  expect(JSON.parse(told.prompts[3]!.at(-1)!.content).npc_knows).toEqual({ Ferryman: ["Ash asked him about boats.", ferryman] });
  expect(log).toContain('"knows":2');
  expect(log).not.toContain("hooded");
});

test("a move asks a part of each person a thread names who has none for it, though they learned other things in play, and asks again once when one is missing", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const part = "He held the harbourmaster under, and the vicar paid him.";
  const told = play(
    narration(
      "Ash meets the sexton.",
      { op: "add_npc", name: "Silas Grout", appearance: "a huge man" },
      { op: "npc_learns", name: "Silas Grout", fact: "Ash asked who dug the grave." },
      nextDay(),
    ),
    moved(change(drowned, "Grout digs a grave.")),
    moved({ ...change(drowned, "Grout digs a grave."), knows: [{ name: "Grout", knows: part }] }),
    narration("Ash waits.", nextDay("3rd of Thaw")),
    moved(change(drowned, "Grout fills the grave.")),
    narration("Ash waits again."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned],
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I meet him.", "I wait.", "I wait again."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  // Asked of Grout, though what he learned in play already sat in npc_knows.
  expect(JSON.parse(told.prompts[1]!.at(-1)!.content).plot_threads).toEqual([{ truth: drowned, now: "", without_part: ["Silas Grout"] }]);
  // The move that gave none was asked again, and the next move asks him no more.
  expect(told.prompts[2]!.at(-1)!.content).toContain("without_part");
  expect(JSON.parse(told.prompts[4]!.at(-1)!.content).plot_threads).toEqual([{ truth: drowned, now: "Grout digs a grave." }]);
  expect(store().latestState(id).npcKnows["Silas Grout"]).toEqual(["Ash asked who dug the grave.", part]);
  expect(log).not.toContain('"withoutPart"');
});

test("a move asks no part of the dead, as a dead man was asked what he knew", async () => {
  const drowned = "Silas Grout drowned Tobias Crane on the vicar's orders.";
  const told = play(
    narration(
      "Ash meets the sexton beside the body.",
      { op: "add_npc", name: "Silas Grout", appearance: "a huge man" },
      { op: "add_npc", name: "Tobias Crane", appearance: "an old man, drowned" },
      nextDay(),
    ),
    moved({ ...change(drowned, "Grout digs a grave."), knows: [{ name: "Grout", knows: "He held Crane under." }] }),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned],
      worldBible: [{ title: "Tobias Crane", keywords: ["Crane", "body", "drowned"], content: "The harbourmaster, drowned.", alwaysOn: false }],
    },
  });

  for (const input of ["I meet him.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);

  expect(JSON.parse(told.prompts[1]!.at(-1)!.content).plot_threads).toEqual([{ truth: drowned, now: "", without_part: ["Silas Grout"] }]);
});

test("what a move gives someone to know is capped, so it never grows without bound", () => {
  const known = Array.from({ length: MAX_NPC_KNOWS }, (_, at) => `Fact ${at}.`);
  const state = { ...openingState, npcs: [{ name: "Ferryman", appearance: "" }], npcKnows: { Ferryman: known } };
  const edit: WorldEdit = {
    edit: "world",
    update: { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [] },
    knows: { Ferryman: ["Fact 3.", "New."] },
    moved: true,
  };

  expect(applyEdit(state, edit).npcKnows.Ferryman).toEqual([...known.slice(1), "New."]);
});

test("the cap keeps someone's part of a thread however much they learn after, and drops the oldest of the rest", () => {
  const secret = "He held the harbourmaster under for the vicar.";
  const state = { ...openingState, npcs: [{ name: "Ferryman", appearance: "" }], plotThreads: ["The drowning."] };
  const given = applyEdit(state, {
    edit: "world",
    update: { lore_entries: [], removed_lore: [], world_rules: [], plot_threads: [] },
    knows: { Ferryman: [secret] },
    parts: { "The drowning.": ["Ferryman"] },
    moved: true,
  });
  const learned = Array.from({ length: MAX_NPC_KNOWS + 3 }, (_, at) => ({ op: "npc_learns" as const, name: "Ferryman", fact: `Fact ${at}.` }));

  const { npcKnows } = applyOperations(given, learned).next;

  expect(npcKnows.Ferryman).toHaveLength(MAX_NPC_KNOWS);
  expect(npcKnows.Ferryman![0]).toBe(secret);
  expect(npcKnows.Ferryman!.at(-1)).toBe(`Fact ${MAX_NPC_KNOWS + 2}.`);
  expect(npcKnows.Ferryman).not.toContain("Fact 3.");
});

test("a now that waits on the PC, puts someone with the PC elsewhere or gives them what only a secret holds is asked again once", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const part = { name: "Silas Grout", knows: "He held the harbourmaster under for the vicar." };
  const committed = "Grout, in the crypt with Ash, will dig a fresh grave in the churchyard by dawn.";
  const told = play(
    narration(
      "Ash meets the sexton in the crypt.",
      { op: "add_npc", name: "Silas Grout", appearance: "a huge man" },
      { op: "set_scene", location: "The crypt", visible_cast: ["Silas Grout"] },
      nextDay(),
    ),
    moved({ ...change(drowned, "Grout is at the cottage, pulling at the chimney, and will deal with Ash if she presses."), knows: [part] }),
    moved({ ...change(drowned, committed), knows: [part] }),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I meet him.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  const again = told.prompts[2]!.at(-1)!.content;
  for (const why of ["a now waits on what the PC might do", "a now puts someone with the PC somewhere else", "a now gives someone what only a secret holds"])
    expect(again).toContain(why);
  expect(log).toContain("Nows asked again");
  expect(store().latestState(id).threadsNow[drowned]).toBe(committed);
});

test("a now still faulted when asked again keeps that thread's old now and plan, while the move's other changes stand", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const waiting = "Grout will deal with Ash if she presses.";
  const vicar = "The vicar has torn up the cottage floor and found nothing.";
  const told = play(
    narration("Ash walks to the quay.", nextDay()),
    moved(change(drowned, waiting), change(hidden, vicar)),
    moved(change(drowned, waiting), change(hidden, vicar)),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [drowned]: "Grout digs a grave.", [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(told.prompts).toHaveLength(4);
  expect(store().latestState(id).threadsNow).toEqual({ [drowned]: "Grout digs a grave.", [hidden]: vicar });
  expect(log).toMatch(/World moved on .*"nowsReverted":1/);
});

test("a move keeps what a thread's people have done apart from what they plan, and the next Turn and move read the plan as not yet done", async () => {
  const done = "The thief has hidden the books on a barge.";
  const plan = "He will sell them at the dock by noon tomorrow.";
  const told = play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved({ ...change(THIEF, done), plan }),
    narration("Ash watches the barges.", nextDay("3rd of Thaw")),
    moved(change(THIEF, "The thief sold the books at noon.")),
    narration("Ash waits."),
  );
  const id = createSave();

  for (const input of ["I walk to the dock.", "I watch the barges.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);

  const next = told.prompts[2]!.map(({ content }) => content).join("\n");
  expect(next).toContain(JSON.stringify({ truth: THIEF, now: done, plan }));
  expect(next).toContain("unless play has prevented it");
  expect(JSON.parse(told.prompts[3]!.at(-1)!.content).plot_threads).toEqual([{ truth: THIEF, now: done, plan }]);
  // A move that gives no plan leaves none, and an old now with none reads as done.
  expect(store().latestState(id).threadsNow).toEqual({ [THIEF]: "The thief sold the books at noon." });
  expect(store().latestState(id).threadsPlan).toEqual({});
});

test("a Save from before plans opens with none, so its now reads as done", () => {
  const id = store().create({ worldBrief: "A drowned city", pc: { name: "Ash" }, opening: { plotThreads: [THIEF], threadsNow: { [THIEF]: "He waits." } } });
  {
    using db = new Database(join(savesDir, `${id}.sqlite`));
    db.run("DELETE FROM snapshot_sections WHERE name = 'threadsPlan'; PRAGMA user_version = 27");
  }

  expect(store().latestState(id)).toMatchObject({ threadsNow: { [THIEF]: "He waits." }, threadsPlan: {} });
});

test("a Turn's update of a thread sets its plan, or clears it", () => {
  const state = { ...structuredClone(openingState), plotThreads: [THIEF], threadsNow: { [THIEF]: "He waits." }, threadsPlan: { [THIEF]: "He will run." } };
  const planned = applyOperations(state, [{ op: "update_plot_thread", thread: THIEF, now: "He ran.", plan: "He will hide by dusk.", truth: null }]).next;
  expect(planned.threadsPlan).toEqual({ [THIEF]: "He will hide by dusk." });
  expect(applyOperations(state, [{ op: "update_plot_thread", thread: THIEF, now: "He ran.", plan: null, truth: null }]).next.threadsPlan).toEqual({});
});

test("a move that tells as done a plan whose people were with the PC is asked again once", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const plan = "Grout will go up to the apothecary at four and leave the dead man's letter.";
  const part = { name: "Silas Grout", knows: "He held the harbourmaster under for the vicar." };
  const stayed = "Grout sat in the crypt with Ash through the afternoon.";
  const told = play(
    narration(
      "Ash sits with the sexton in the crypt.",
      { op: "add_npc", name: "Silas Grout", appearance: "a huge man" },
      { op: "set_scene", location: "The crypt", visible_cast: ["Silas Grout"] },
      nextDay(),
    ),
    moved({ ...change(drowned, "Grout, back from the crypt, went to the apothecary at four and left the letter."), knows: [part] }),
    moved({ ...change(drowned, stayed), knows: [part] }),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned],
      threadsNow: { [drowned]: "Grout dug a grave." },
      threadsPlan: { [drowned]: plan },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I sit with him.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(told.prompts[2]!.at(-1)!.content).toContain("a now tells as done a plan whose people were with the PC");
  expect(log).toContain('"a now tells as done a plan whose people were with the PC":1');
  expect(store().latestState(id).threadsNow[drowned]).toBe(stayed);
});

test("a now that tells as done a plan the page played out with the PC stands, as a true now was faulted and the stale one kept", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const plan = "Grout will go up to the apothecary at four and leave the dead man's letter.";
  const part = { name: "Silas Grout", knows: "He held the harbourmaster under for the vicar." };
  const done = "Grout went up to the apothecary with Ash and left the dead man's letter there.";
  const told = play(
    narration(
      "Ash walks with the sexton up to the apothecary, where he leaves the dead man's letter on the counter.",
      { op: "add_npc", name: "Silas Grout", appearance: "a huge man" },
      { op: "set_scene", location: "The apothecary", visible_cast: ["Silas Grout"] },
      nextDay(),
    ),
    moved({ ...change(drowned, done), knows: [part] }),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned],
      threadsNow: { [drowned]: "Grout dug a grave." },
      threadsPlan: { [drowned]: plan },
      worldBible: [],
    },
  });

  for (const input of ["I go with him.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);

  expect(told.prompts).toHaveLength(3);
  expect(store().latestState(id).threadsNow[drowned]).toBe(done);
});

test("a re-ask that fails settles from the first reply: its sound changes stand and the faulted thread stays as it was", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const vicar = "The vicar has torn up the cottage floor and found nothing.";
  play(
    narration("Ash walks to the quay.", nextDay()),
    moved(change(drowned, "Grout will deal with Ash if she presses."), change(hidden, vicar)),
    new Error("The re-ask timed out."),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [drowned]: "Grout digs a grave.", [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).threadsNow).toEqual({ [drowned]: "Grout digs a grave.", [hidden]: vicar });
  expect(log).toContain("Nows not asked again");
  expect(log).toMatch(/Faulted nows settled .*"reverted":1,"reAskFailed":true/);
});

test("a move asked again for a faulted now keeps the first reply's sound changes and takes only that thread from the re-ask", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const waiting = "Grout will deal with Ash if she presses.";
  const vicar = "The vicar has torn up the cottage floor and found nothing.";
  const dug = "Grout has dug a fresh grave behind the chapel.";
  const told = play(
    narration("Ash walks to the quay.", nextDay()),
    moved(change(drowned, waiting), change(hidden, vicar)),
    // The re-ask rewrites the sound thread too, which is not taken, as the first reply's stands.
    moved(change(drowned, dug), change(hidden, "The vicar sleeps.")),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [drowned]: "Grout digs a grave.", [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(told.prompts[2]!.at(-1)!.content).toContain("only the changes named here are taken from your next reply");
  expect(store().latestState(id).threadsNow).toEqual({ [drowned]: dug, [hidden]: vicar });
  expect(log).toMatch(/Faulted nows settled .*"kept":1,"reAsked":1,"replaced":1,"reverted":0/);
});

test("a now that has the PC told a secret off the page is asked again, naming that thread, and kept out if still so while the old now is the newest reply's", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const leak = "On Monday the ferryman told Ash the ledger lies hidden up the cottage chimney.";
  const told = play(
    narration("Ash walks to the quay.", nextDay(), setNow(hidden)),
    moved(change(hidden, leak)),
    moved(change(hidden, leak)),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(told.prompts[2]!.at(-1)!.content).toContain("the now of plot_threads[1]: a now has the PC told, or telling, what only a secret holds");
  expect(log).toContain('"a now has the PC told, or telling, what only a secret holds, which the PC learns only on the page":1');
  expect(store().latestState(id).threadsNow[hidden]).toBe(FRESH_NOW);
});

test("a now that has someone shown or told 'her' a secret, naming no one else, counts as the PC told it", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const leak = "The ferryman waits at the inn, having shown her the ledger hidden up the cottage chimney.";
  const told = play(
    narration("Ash walks to the quay.", nextDay(), setNow(hidden)),
    moved(change(hidden, leak)),
    moved(change(hidden, leak)),
    narration("Ash waits."),
  );
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);

  expect(told.prompts[2]!.at(-1)!.content).toContain("the now of plot_threads[1]: a now has the PC told, or telling, what only a secret holds");
  expect(store().latestState(id).threadsNow[hidden]).toBe(FRESH_NOW);
});

test("a re-ask still faulted only by a fault that misfires keeps its newer now over one older than the newest reply", async () => {
  const drowned = "Silas Grout drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  const leak = "On Monday the ferryman told Ash the ledger lies hidden up the cottage chimney.";
  play(narration("Ash walks to the quay.", nextDay()), moved(change(hidden, leak)), moved(change(hidden, leak)), narration("Ash waits."));
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      threadsNow: { [hidden]: "The vicar waits for night." },
      worldBible: [],
    },
  });

  const log = await logOf(async () => {
    for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);
  }, "info");

  expect(store().latestState(id).threadsNow[hidden]).toBe(leak);
  expect(log).toMatch(/Faulted nows settled .*"reverted":0,"newerKept":1/);
});

test("a now naming someone with the PC only as another's object, or told what the Journal holds, is not asked again", async () => {
  const drowned = "The sexton drowned the harbourmaster on the vicar's orders.";
  const hidden = "The ledger is hidden in the cottage chimney, and the vicar is searching for it.";
  // Grout is with Ash at the quay, and only named here; the ledger's hiding place is a Loose End the page left.
  const sound =
    "The vicar sent word to Grout from the vicarage and waits there. On Monday the ferryman told Ash the ledger lies hidden up the cottage chimney.";
  const told = play(narration("Ash walks to the quay with Grout.", nextDay()), moved(change(hidden, sound)), narration("Ash waits."));
  const id = store().create({
    worldBrief: "A harbour town",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The quay", visibleCast: ["Silas Grout"] },
      summary: "",
      worldRules: [],
      plotThreads: [drowned, hidden],
      npcs: [{ name: "Silas Grout", appearance: "a huge man" }],
      looseEnds: ["Whether the ledger lies hidden up the cottage chimney."],
      worldBible: [],
    },
  });

  for (const input of ["I walk.", "I wait."]) expect((await turn(id, input)).ok).toBe(true);

  expect(told.prompts).toHaveLength(3);
  expect(store().latestState(id).threadsNow[hidden]).toBe(sound);
});

test("a move with no usable change is written again, saying why", async () => {
  const told = play(
    narration("Ash walks to the dock.", { op: "set_scene", location: "The dock", visible_cast: [] }, nextDay()),
    moved(change("A thread that isn't there.", "x")),
    moved(),
    narration("Ash watches the barges."),
  );
  const id = createSave();

  expect((await turn(id, "I walk to the dock.")).ok).toBe(true);
  expect((await turn(id, "I watch the barges.")).ok).toBe(true);

  expect(told.prompts.some((prompt) => prompt.at(-1)!.content.includes("a change misquotes a thread"))).toBe(true);
});
