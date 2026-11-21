import { afterEach, beforeEach, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { startServer } from "../src/rest-api";
import { reviewTimedOut, slowReviewer, UPKEEP_LIMIT } from "../src/state-upkeep";
import { saveStore } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { type TextProvider, ThinkingBudgetReached } from "../src/turn-engine";
import { logOf, narration, scriptedDice, scriptedImages, scriptedTextProvider, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let server: ReturnType<typeof startServer>;

beforeEach(() => {
  // Shared by every Save, so one test's time-out would lower another's thinking.
  slowReviewer.steps = 0;
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});
afterEach(async () => {
  await server.stop(true);
  folder.remove();
});

/** A server whose Narrator and reviewer each follow a script. The reviewer is the Narrator's model, as by default. */
function play(narrator: (string | Error)[], reviewer: (string | Error | Promise<string>)[], stalled: boolean | TextProvider = false) {
  const settings = settingsStore(join(dirname(savesDir), "settings.json"));
  settings.update({ textModel: "narrator/model" });
  const told = scriptedTextProvider(...narrator);
  const upkeep = scriptedTextProvider(...reviewer);
  server = startServer({
    savesDir,
    settings,
    textProvider: told.textProvider,
    // One that answers only when stopped, like a reviewer stuck retrying.
    reviewProvider:
      typeof stalled === "function"
        ? stalled
        : stalled
          ? (_prompt, { signal }) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
          : upkeep.textProvider,
    imageAdapter: scriptedImages().imageAdapter,
    dice: scriptedDice(),
    nearMissMargin: 2,
    port: 0,
    writePicture: async (_ask, _style, fallback) => fallback,
    reviewPicture: async (description) => description,
  });
  return { told, upkeep };
}

const store = () => saveStore(savesDir);
const createSave = () =>
  store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: { inventory: { wearing: ["a coat"], carrying: [] }, scene: { location: "The library", visibleCast: [] }, summary: "It began to rain." },
  });
const turn = (id: string, input = "I walk home and hang up my coat.") =>
  fetch(new URL(`/saves/${id}/turns`, server.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
const upkept = (...state_operations: object[]) => JSON.stringify({ state_operations });

test("State Upkeep records what the reply showed and the Narrator missed, after the Narrator's own operations", async () => {
  const { upkeep } = play(
    [narration("Ash walks home through the rain and hangs the coat by the door.", { op: "add_item", slot: "carrying", item: "a key" })],
    [upkept({ op: "set_scene", location: "Ash's flat", visible_cast: [] }, { op: "remove_item", item: "a coat" })],
  );
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  const state = store().latestState(id);
  expect(state.scene.location).toBe("Ash's flat");
  expect(state.inventory).toEqual({ wearing: [], carrying: ["a key"] });
  // It sees the state after the Narrator's operations, with the move and the reply, and of the hidden world only the Plot Threads.
  const sent = JSON.parse(upkeep.prompts[0]!.at(-1)!.content);
  // No reply came before the first, so there is no previous one to agree with.
  expect(sent).toMatchObject({ state: { inventory: { carrying: ["a key"] } }, previous_reply: "", player_move: "I walk home and hang up my coat." });
  expect(sent.reply).toContain("hangs the coat");
  expect(Object.keys(sent.state)).not.toContain("plot_threads");
  // The long lists first and what changes every Turn last, so the provider's cache reaches past the lists.
  expect(Object.keys(sent.state).slice(0, 3)).toEqual(["pc_name", "known_facts", "npc_knows"]);
  expect(Object.keys(sent.state).at(-1)).toBe("story_time");
  expect(Object.keys(sent.state)).not.toContain("worldBible");
  expect(log).toContain('"operations":["set_scene","remove_item"]');
  expect(log).toContain('"upkeepRefused":0');
  expect(log).not.toContain("Ash's flat");
});

test("a failed State Upkeep keeps the Narrator's state, and the Turn is saved", async () => {
  play([narration("Ash walks home.", { op: "add_item", slot: "carrying", item: "a key" })], [new Error("down")]);
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  expect(store().latestState(id).inventory.carrying).toEqual(["a key"]);
  expect(store().latestState(id).scene.location).toBe("The library");
  expect(log).toContain("State Upkeep skipped");
});

/** A streamed Turn, read event by event, so a test can act while it's still running. */
async function streamedTurn(id: string, input = "I walk home and hang up my coat.") {
  const response = await fetch(new URL(`/saves/${id}/turns`, server.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ input }),
  });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  return async function next() {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [, event, data] = block.match(/^event: (.+)\ndata: (.+)$/)!;
        return { event: event!, data: JSON.parse(data!) };
      }
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffer += value;
    }
  };
}

test("the reply's final text reaches the player while State Upkeep runs, and the next move waits for it", async () => {
  let upkeepDone = false;
  let finishUpkeep = (_reply: string) => {};
  const held = new Promise<string>((resolve) => {
    finishUpkeep = resolve;
  }).finally(() => {
    upkeepDone = true;
  });
  play([narration("Ash walks home.")], [held]);
  const id = createSave();
  const next = await streamedTurn(id);

  let event = await next();
  while (event && event.event !== "reply") event = await next();
  expect(event?.data).toEqual({ text: "Ash walks home." });
  expect(upkeepDone).toBe(false);
  expect((await turn(id, "I sleep.")).status).toBe(409);

  finishUpkeep(upkept({ op: "set_scene", location: "Ash's flat", visible_cast: [] }));
  expect((await next())?.event).toBe("done");
  expect(store().latestState(id).scene.location).toBe("Ash's flat");
});

test("a Stop once the reply is shown keeps the reply, skipping only the State Upkeep still running", async () => {
  play([narration("Ash walks home.", { op: "add_item", slot: "carrying", item: "a key" })], [], true);
  const id = createSave();
  const next = await streamedTurn(id);

  let event = await next();
  while (event && event.event !== "reply") event = await next();
  await fetch(new URL(`/saves/${id}/turn`, server.url), { method: "DELETE" });

  expect((await next())?.event).toBe("done");
  expect(
    store()
      .messages(id)
      .map(({ text }) => text),
  ).toEqual(["I walk home and hang up my coat.", "Ash walks home."]);
  expect(store().latestState(id).inventory.carrying).toEqual(["a key"]);
});

test("State Upkeep that runs past its time limit keeps the Narrator's state, and the Turn is saved", async () => {
  const limit = UPKEEP_LIMIT.ms;
  UPKEEP_LIMIT.ms = 20;
  try {
    play([narration("Ash walks home.", { op: "add_item", slot: "carrying", item: "a key" })], [], true);
    const id = createSave();

    const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

    expect(store().latestState(id).inventory.carrying).toEqual(["a key"]);
    expect(log).toContain('"type":"time limit"');
    // So the next review thinks a level less, rather than being cut off again.
    expect(log).toContain("Review thinking lowered");
    expect(slowReviewer.steps).toBe(1);
  } finally {
    UPKEEP_LIMIT.ms = limit;
  }
});

test("State Upkeep's thinking is cut early enough that its hurried second try has most of the time limit", async () => {
  const limit = UPKEEP_LIMIT.ms;
  UPKEEP_LIMIT.ms = 600;
  let calls = 0;
  // Thinks until cut, as the real provider stops it at thinkingMs; the hurried try answers after a third of the limit.
  const reviewer: TextProvider = async (_prompt, { thinkingMs = 0, signal }) => {
    calls++;
    const ms = calls === 1 ? thinkingMs : UPKEEP_LIMIT.ms / 3;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
    if (calls === 1) throw new ThinkingBudgetReached("over");
    return upkept({ op: "add_item", slot: "carrying", item: "a key" });
  };
  try {
    play([narration("Ash walks home.")], [], reviewer);
    const id = createSave();

    expect((await turn(id)).ok).toBe(true);

    expect(calls).toBe(2);
    expect(store().latestState(id).inventory.carrying).toEqual(["a key"]);
  } finally {
    UPKEEP_LIMIT.ms = limit;
  }
});

test("a time-out lowers Review thinking only while it is above Low, and logs only a lowering", async () => {
  play([], []);
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ reviewThinking: "medium" });

  const log = await logOf(async () => {
    reviewTimedOut("fix", settings);
    reviewTimedOut("fix", settings);
  }, "info");

  expect(log.match(/Review thinking lowered/g)).toHaveLength(1);
  expect(slowReviewer.steps).toBe(1);
});

test("a State Upkeep call is sent its thinking budget", async () => {
  const { upkeep } = play([narration("Ash walks home.")], [upkept()]);
  const id = createSave();
  expect((await turn(id)).ok).toBe(true);
  expect(upkeep.budgets[0]).toBe(1000);
});

test("reviews lowered after a time-out stay lowered, however quick the next are, as raising them again timed out again", async () => {
  reviewTimedOut("fix", settingsStore(join(folder.path, "settings.json")));
  play([narration("Ash walks home."), narration("Ash sits."), narration("Ash sleeps.")], [upkept(), upkept(), upkept()]);
  const id = createSave();

  const log = await logOf(async () => {
    for (let at = 0; at < 3; at++) expect((await turn(id)).ok).toBe(true);
  }, "info");

  expect(slowReviewer.steps).toBe(1);
  expect(log).not.toContain("Review thinking raised");
});

test("an operation of State Upkeep's that the state refuses is dropped, and the rest still apply", async () => {
  play([narration("Ash walks home.")], [upkept({ op: "remove_item", item: "a hat" }, { op: "set_scene", location: "Ash's flat", visible_cast: [] })]);
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  expect(store().latestState(id).scene.location).toBe("Ash's flat");
  expect(log).toContain('"upkeepRefused":1');
});

test("State Upkeep doesn't move time in a Turn where the Narrator did, as it moved it a second time", async () => {
  const time = (days_passed: number, date: string, time_of_day: string) => ({ op: "set_story_time", days_passed, date, time_of_day });
  const { upkeep } = play(
    [narration("Ash wakes at dawn.", time(0, "1st of Thaw", "dusk")), narration("Ash wakes at dawn.", time(1, "2nd of Thaw", "dawn"))],
    [upkept(), upkept(time(4, "3rd of Thaw", "morning"), { op: "set_scene", location: "Ash's flat", visible_cast: [] })],
  );
  const id = createSave();
  await turn(id);

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  expect(store().latestState(id).storyTime).toMatchObject({ day: 2, date: "2nd of Thaw", timeOfDay: "dawn" });
  expect(store().latestState(id).scene.location).toBe("Ash's flat");
  // Not even offered, so its wrong time can't creep into the facts it rewrites; one given anyway is dropped.
  expect(upkeep.prompts.map((prompt) => prompt[0]!.content.includes("set_story_time"))).toEqual([false, false]);
  expect(log).toContain('"operations":["set_scene"],"dropped":1');
});

test("State Upkeep is sent the Loose Ends and resolves one the reply settled, as long stories kept a dozen stale", async () => {
  const { upkeep } = play(
    [narration("Ash finds the key under the mat.", { op: "add_loose_end", loose_end: "Find the key to the boathouse" })],
    [upkept({ op: "resolve_loose_end", loose_end: "Find the key to the boathouse" })],
  );
  const id = createSave();

  expect((await turn(id)).ok).toBe(true);

  expect(JSON.parse(upkeep.prompts[0]!.at(-1)!.content).state.loose_ends).toEqual(["Find the key to the boathouse"]);
  expect(upkeep.prompts[0]![0]!.content).toContain("resolve_loose_end");
  expect(store().latestState(id).looseEnds).toEqual([]);
});

test("State Upkeep is sent what only those in view or named in the replies know, as everyone's crowded its prompt", async () => {
  const { upkeep } = play(
    [
      narration(
        "Ash tells Kit the key is under the mat.",
        { op: "add_npc", name: "Kit", appearance: "a boy in a cap" },
        { op: "npc_learns", name: "Kit", fact: "Ash came home wet." },
        { op: "add_npc", name: "Orin", appearance: "an old ferryman" },
        { op: "npc_learns", name: "Orin", fact: "Ash owes him a fare." },
      ),
    ],
    [upkept()],
  );
  const id = createSave();

  expect((await turn(id)).ok).toBe(true);

  expect(JSON.parse(upkeep.prompts[0]!.at(-1)!.content).state.npc_knows).toEqual({ Kit: ["Ash came home wet."] });
});

test("State Upkeep records what someone learned that the Narrator missed, held to the checks a Turn's is, as NPCs never learned anything", async () => {
  const { upkeep } = play(
    [
      narration(
        "Ash tells Kit the key is under the mat.",
        { op: "add_npc", name: "Kit", appearance: "a boy in a cap" },
        { op: "npc_learns", name: "Kit", fact: "Ash came home wet." },
      ),
    ],
    [upkept({ op: "npc_learns", name: "Kit", fact: "Ash told him the key is under the mat." }, { op: "npc_learns", name: "Orin", fact: "Orin heard it too." })],
  );
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  // Sent what they know already, so it isn't given twice.
  expect(JSON.parse(upkeep.prompts[0]!.at(-1)!.content).state.npc_knows).toEqual({ Kit: ["Ash came home wet."] });
  expect(upkeep.prompts[0]![0]!.content).toContain("npc_learns");
  // Someone the state doesn't hold is refused, as a Turn's would be.
  expect(store().latestState(id).npcKnows).toEqual({ Kit: ["Ash came home wet.", "Ash told him the key is under the mat."] });
  expect(log).toContain('"learned":2');
  expect(log).toContain('"upkeepRefused":1');
  expect(log).not.toContain("under the mat");
});

test("State Upkeep doesn't record again in other words what the Narrator's own npc_learns gave, nor what someone doesn't know", async () => {
  play(
    [
      narration(
        "Ash tells Kit the brass key lies under the doormat.",
        { op: "add_npc", name: "Kit", appearance: "a boy in a cap" },
        { op: "npc_learns", name: "Kit", fact: "Ash told Kit the brass key lies hidden under the doormat outside." },
      ),
    ],
    [
      upkept(
        { op: "npc_learns", name: "Kit", fact: "Ash told him that the brass key is hidden under the doormat." },
        { op: "npc_learns", name: "Kit", fact: "Kit does not know who lit the lamp." },
        { op: "npc_learns", name: "Kit", fact: "Kit saw the lamp burning in the boathouse, but does not know who lit it" },
      ),
    ],
  );
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  expect(store().latestState(id).npcKnows).toEqual({
    Kit: ["Ash told Kit the brass key lies hidden under the doormat outside.", "Kit saw the lamp burning in the boathouse."],
  });
  expect(log).toContain("Upkeep's repeats of what someone learned dropped");
  expect(log).toContain('"count":1');
});

test("State Upkeep may move time in a Turn where the Narrator didn't", async () => {
  const { upkeep } = play([narration("Ash waits until dark.")], [upkept({ op: "set_story_time", days_passed: 0, date: "1st of Thaw", time_of_day: "night" })]);
  const id = createSave();

  expect((await turn(id)).ok).toBe(true);

  expect(upkeep.prompts[0]![0]!.content).toContain("set_story_time");
  // Named as the reply shows it, as on DeepSeek the clock sat at early afternoon through 30 rounds while the light went amber.
  expect(upkeep.prompts[0]![0]!.content).toContain("shows the light, a meal or the hour moved on");
  expect(store().latestState(id).storyTime).toMatchObject({ day: 1, date: "1st of Thaw", timeOfDay: "night" });
});

test("an operation State Upkeep may not give, or a broken one, is dropped and the rest kept, with no second call", async () => {
  const { upkeep } = play(
    [narration("Ash walks home.")],
    [
      upkept(
        { op: "add_plot_thread", thread: "The tide rises." },
        { op: "set_scene", location: "x", visible_cast: [] },
        { op: "remove_item", item: "" },
        { op: "add_item", slot: "carrying", item: "x" },
        { op: "add_item", slot: "carrying", item: "a key" },
      ),
    ],
  );
  const id = createSave();

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  const state = store().latestState(id);
  expect(state.plotThreads).toEqual([]);
  // A place name with no word in it would show as the Journal's location.
  expect(state.scene.location).toBe("The library");
  expect(state.inventory.carrying).toEqual(["a key"]);
  expect(upkeep.prompts.length).toBe(1);
  expect(log).toContain('"operations":["add_item"],"dropped":4');
});

test("State Upkeep never changes a Plot Thread, which is World Moves On's", async () => {
  play(
    [narration("Ash finds the thief at the dock and the thief confesses.")],
    [
      upkept(
        { op: "update_plot_thread", thread: "A thief steals from the library.", now: "The exposed thief flees by boat.", truth: null },
        { op: "resolve_plot_thread", thread: "The tide rises." },
      ),
    ],
  );
  const id = store().create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The dock", visibleCast: [] },
      summary: "",
      plotThreads: ["A thief steals from the library.", "The tide rises."],
    },
  });

  const log = await logOf(async () => expect((await turn(id)).ok).toBe(true), "info");

  expect(store().latestState(id).plotThreads).toEqual(["A thief steals from the library.", "The tide rises."]);
  expect(store().latestState(id).threadsNow).toEqual({});
  expect(log).toContain('"operations":[],"dropped":2');
  expect(log).not.toContain("thief");
});

test("State Upkeep is sent the reply before, so a description two replies agree is out of date can be brought up to date", async () => {
  const { upkeep } = play([narration("Ash walks home in the rain."), narration("Ash shakes the rain off.")], [upkept(), upkept()]);
  const id = createSave();
  await turn(id);

  await turn(id, "I shake off the rain.");

  expect(JSON.parse(upkeep.prompts[1]!.at(-1)!.content).previous_reply).toBe("Ash walks home in the rain.");
});

test("an Edit that adds to the response gives State Upkeep only the added words, after the response, so it records nothing twice", async () => {
  const GIVEN = "Ash hands the key to Owen.";
  const { upkeep } = play([narration(GIVEN), narration(`${GIVEN}\n\nA gull cries.`)], [upkept(), upkept()]);
  const id = createSave();
  expect((await turn(id)).ok).toBe(true);

  const edited = await fetch(new URL(`/saves/${id}/messages/2/edit`, server.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `${GIVEN}\n\nA gull cries.` }),
  });

  expect(edited.ok).toBe(true);
  expect(JSON.parse(upkeep.prompts[1]!.at(-1)!.content)).toMatchObject({ previous_reply: GIVEN, reply: "A gull cries." });
});
