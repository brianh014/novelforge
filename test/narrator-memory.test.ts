import { expect, test } from "bun:test";
import { activateLore } from "../src/lore-activation";
import { assemblePrompt } from "../src/prompt-assembler";
import { applyOperations, openingState, type LoreEntry, type State, type StateOperation } from "../src/state-applier";

const entry = (title: string, keywords: string[], extra: Partial<LoreEntry> = {}): LoreEntry => ({ title, keywords, content: `${title} text`, alwaysOn: false, ...extra });
const withState = (sections: Partial<State>) => ({ ...structuredClone(openingState), ...sections });
const run = (state: State, ...operations: StateOperation[]) => {
  const { next, refused } = applyOperations(state, operations);
  expect(refused).toEqual([]);
  return next;
};

test("when Lore won't all fit, the entry named most recently goes first, wherever it sits in the World Bible", () => {
  const entries = [entry("Early", ["harbour"]), entry("Late", ["Nadia"])];
  const cost = Math.ceil("Late\nLate text".length / 4);

  const active = activateLore(entries, "The harbour. Later, Nadia speaks.", cost);

  expect(active.map(({ title }) => title)).toEqual(["Late"]);
});

test("a keyword's latest mention counts, not its first", () => {
  const entries = [entry("Early", ["harbour"]), entry("Late", ["Nadia"])];
  const cost = Math.ceil("Early\nEarly text".length / 4);

  const active = activateLore(entries, "Nadia speaks. Later, the harbour.", cost);

  expect(active.map(({ title }) => title)).toEqual(["Early"]);
});

test("a Lore Entry can be rewritten, by the Narrator, and stays keyword-activated", () => {
  const state = withState({ worldBible: [entry("Ellis", ["Ellis"])] });

  const next = run(state, { op: "update_lore_entry", title: "Ellis", keywords: ["Ellis", "Crane"], content: "Ellis died in April." });

  expect(next.worldBible).toEqual([{ title: "Ellis", keywords: ["Ellis", "Crane"], content: "Ellis died in April.", alwaysOn: false }]);
});

test("rewriting a Lore Entry that isn't there adds it, and removing one that isn't there changes nothing, so neither costs the Turn", () => {
  const rewrite: StateOperation = { op: "update_lore_entry", title: "New", keywords: ["new"], content: "Fresh." };

  expect(run(withState({}), rewrite).worldBible).toEqual([{ title: "New", keywords: ["new"], content: "Fresh.", alwaysOn: false }]);
  expect(run(withState({}), { op: "remove_lore_entry", title: "Gone" }).worldBible).toEqual([]);
});

test("the Narrator can remove a Lore Entry, but neither rewrite nor remove an always-on one", () => {
  const pinned = entry("Canon", ["canon"], { alwaysOn: true });
  const state = withState({ worldBible: [pinned, entry("Stale", ["stale"])] });

  const next = run(
    state,
    { op: "remove_lore_entry", title: "Stale" },
    { op: "update_lore_entry", title: "Canon", keywords: ["other"], content: "Changed." },
    { op: "remove_lore_entry", title: "Canon" },
  );

  expect(next.worldBible).toEqual([pinned]);
});

for (const [name, list, operation] of [
  ["Plot Thread", "plotThreads", (from: string, replacement: string) => ({ op: "update_plot_thread", thread: from, replacement })],
  ["known fact", "facts", (from: string, replacement: string) => ({ op: "update_known_fact", fact: from, replacement })],
] as const) {
  const stateWith = (...items: string[]) => (list === "facts" ? withState({ pcKnown: { facts: items, npcs: [] } }) : withState({ plotThreads: items }));
  const itemsOf = (state: State) => (list === "facts" ? state.pcKnown.facts : state.plotThreads);
  const rewrite = (state: State, from: string, to: string) => itemsOf(run(state, operation(from, to) as StateOperation));

  test(`a ${name} is rewritten where it stands`, () => {
    expect(rewrite(stateWith("a", "b", "c"), "b", "B")).toEqual(["a", "B", "c"]);
  });

  test(`rewriting a ${name} that isn't there adds the new one, so a miscopied one doesn't cost the Turn`, () => {
    expect(rewrite(stateWith("a"), "a with a typo", "B")).toEqual(["a", "B"]);
  });

  test(`two versions of a ${name} merge into one`, () => {
    expect(rewrite(stateWith("a", "b"), "a", "b")).toEqual(["b"]);
  });

  test(`rewriting a ${name} to itself keeps it`, () => {
    expect(rewrite(stateWith("a"), "a", "a")).toEqual(["a"]);
  });
}

test("a known fact can be removed, and removing one that isn't there changes nothing", () => {
  const state = withState({ pcKnown: { facts: ["a", "b"], npcs: [] } });

  expect(run(state, { op: "remove_known_fact", fact: "a" }, { op: "remove_known_fact", fact: "not there" }).pcKnown.facts).toEqual(["b"]);
});

const twoPeople = () =>
  withState({
    npcs: [{ name: "Woman with notebook", appearance: "old looks" }, { name: "Nadia", appearance: "kept looks" }],
    scene: { location: "A room", visibleCast: ["Woman with notebook"] },
    pcKnown: { facts: [], npcs: ["Woman with notebook", "Nadia"], summaries: { "Woman with notebook": "old summary", Nadia: "kept summary" } },
  });
const merge: StateOperation = { op: "merge_npc", name: "Woman with notebook", into: "Nadia" };

test("merging two NPCs leaves one person everywhere the state names them, with the kept one's looks and summary", () => {
  const next = run(twoPeople(), merge);

  expect(next.npcs).toEqual([{ name: "Nadia", appearance: "kept looks" }]);
  expect(next.pcKnown.npcs).toEqual(["Nadia"]);
  expect(next.pcKnown.summaries).toEqual({ Nadia: "kept summary" });
  expect(next.scene.visibleCast).toEqual(["Nadia"]);
});

test("the kept NPC takes the other's place where it has none of its own", () => {
  const state = twoPeople();
  state.pcKnown = { facts: [], npcs: ["Woman with notebook"], summaries: { "Woman with notebook": "old summary" } };

  const next = run(state, merge);

  expect(next.pcKnown.npcs).toEqual(["Nadia"]);
  expect(next.pcKnown.summaries).toEqual({ Nadia: "old summary" });
});

test("merging into a name the state doesn't have renames the NPC", () => {
  const next = run(twoPeople(), { op: "merge_npc", name: "Woman with notebook", into: "Nadia Bell" });

  expect(next.npcs.map(({ name }) => name)).toEqual(["Nadia Bell", "Nadia"]);
  expect(next.npcs[0]!.appearance).toBe("old looks");
  expect(next.pcKnown.npcs).toEqual(["Nadia Bell", "Nadia"]);
});

test("a merge of someone not in the state, or of someone into themselves, changes nothing and doesn't cost the Turn", () => {
  expect(run(twoPeople(), { op: "merge_npc", name: "Nobody", into: "Nadia" })).toEqual(twoPeople());
  expect(run(twoPeople(), { op: "merge_npc", name: "Nadia", into: "Nadia" })).toEqual(twoPeople());
});

const promptFor = (sections: Partial<State> = {}, input = "I wait.") => {
  const prompt = assemblePrompt({
    save: { worldBrief: "", pc: { name: "Ash" }, startingHook: "" } as never,
    state: withState(sections),
    messages: [],
    modelInstructions: "",
    input,
    responseSchema: "{}",
    promptStyle: null,
  });
  return prompt.map(({ content }) => content).join("\n");
};

test("the Narrator is told to keep its records true to play", () => {
  const prompt = promptFor();

  expect(prompt).toContain("what has happened in play beats any Lore Entry or Plot Thread");
  for (const op of ["update_lore_entry", "remove_lore_entry", "update_plot_thread", "update_known_fact", "remove_known_fact", "merge_npc"]) expect(prompt).toContain(op);
});

test("the summary is told to keep what's unresolved, and has room for it", () => {
  const prompt = promptFor();

  expect(prompt).toContain("under 500 words");
  expect(prompt).toContain("every open question");
});

test("the last instruction asks for fresh prose, natural speech and none of the player's words back", () => {
  const prompt = promptFor();

  expect(prompt.indexOf("Keep the prose fresh")).toBeGreaterThan(prompt.indexOf("world_rules:"));
  expect(prompt).toContain("contractions");
  expect(prompt).toContain("Never repeat the player's words back");
});

test("a long story's World Bible fits the budget, with its Plot Threads and world_rules", () => {
  // The size of a story with 140 replies behind it: 20 entries of about 225 tokens, with 750 tokens of threads and rules.
  const worldBible = Array.from({ length: 20 }, (_, index) => entry(`Entry ${index}`, ["city"], { content: "x".repeat(900) }));

  const prompt = promptFor({ worldBible, plotThreads: ["t".repeat(2000)], worldRules: ["r".repeat(1000)] }, "I walk through the city.");

  for (const { title } of worldBible) expect(prompt).toContain(`"${title}"`);
});
