import { expect, test } from "bun:test";
import { knownChoices, unknownWords, withoutUnread, writeChoices } from "../src/known-choices";
import { openingState, type State } from "../src/state-applier";
import { scriptedTextProvider } from "./support";

const state: State = {
  ...openingState,
  npcs: [{ name: "Ossery", appearance: "a thin man" }],
  worldBible: [
    { title: "The old hut", keywords: ["old hut", "drums", "Free Wells"], content: "Fuel drums are buried at the old hut.", alwaysOn: false },
    { title: "The road", keywords: ["salt road"], content: "The road.", alwaysOn: true },
  ],
  pcKnown: { facts: ["Jory works the lead strings."], npcs: [] },
};

test("a Choice naming someone or a Lore keyword the player has never read of is caught, and nothing else", () => {
  const choices = ["Ask Tamsin about the old hut.", "Tell Jory that Ossery paid him.", "Ride on and count the drums."];
  // A lone common keyword, such as "drums", is too likely in an honest Choice to count.
  expect(unknownWords(choices, state, "Tamsin rides ahead.")).toEqual([["old hut"], ["Ossery"], []]);
  // Once the player has read of it, it's theirs to ask about.
  expect(unknownWords(choices, state, "Tamsin hears Jory mumble about the old hut and a well-keeper called Ossery.")).toEqual([[], [], []]);
});

test("a Choice naming a place no one has spoken of, or a thing only the secrets hold, is caught, but not a sentence's first word", () => {
  const secret = { ...state, plotThreads: ["Ossery hides the ledger in an oilskin under the well."] };
  const choices = ["Ride for Qasr before dark.", "Search the wagon for an oilskin.", "Tell Tamsin, quietly, what I found."];
  expect(unknownWords(choices, secret, "Tamsin rides ahead. Before dark she searched the wagon.")).toEqual([["Qasr"], ["oilskin"], []]);
});

test("an everyday word, or another form of one the page used, isn't taken for a secret though the secrets hold it", () => {
  const secret = { ...state, plotThreads: ["A silent man with a lantern would sooner kill than hang, and wraps the ledger in oilskin."] };
  const choices = ["I'd sooner wait here.", "I stay silent and watch.", "I go up by lantern light.", "I look for an oilskin."];
  // "sooner" is read as "soon"; "silent" and "lantern" pass once the page has used them, and are caught while it hasn't.
  expect(unknownWords(choices, secret, "She will be back soon, silent, with a lantern.")).toEqual([[], [], [], ["oilskin"]]);
  expect(unknownWords(choices, secret, "She will be back soon.")).toEqual([[], ["silent"], ["lantern"], ["oilskin"]]);
});

test("an everyday word the secrets happen to hold isn't taken for something the PC never heard of", () => {
  const secret = { ...state, plotThreads: ["Whatever anyone may examine, the ledger lies hidden in the chimney."] };
  const choices = ["I ask whether anyone saw him.", "I examine whatever is on the desk.", "I check the chimney."];
  expect(unknownWords(choices, secret, "Tamsin rides ahead.")).toEqual([[], [], ["chimney"]]);
});

test("a Choice copying four words in a row from the secrets is caught, unless the player has read them too or they are all everyday words", () => {
  const secret = { ...state, plotThreads: ["Nobody can yet tell whose side the lie falls on, as it is not so simple."] };
  const choices = ["I find out whose side the lie falls on.", "I ask Tamsin whose side she is on.", "I tell her it is not so."];
  expect(unknownWords(choices, secret, "Tamsin rides ahead.")).toEqual([["whose side the lie", "side the lie falls", "the lie falls on"], [], []]);
  // Read by the player too, it's theirs to say.
  expect(unknownWords(choices, secret, "Tamsin asks: whose side does the lie fall on? She wonders whose side the lie falls on.")).toEqual([[], [], []]);
});

test("a Choice is never dropped for another form of a word read or an everyday one, nor for a word of the World Brief", () => {
  const secret = {
    ...state,
    worldBrief: "A harbour town whose harbourmaster has drowned.",
    plotThreads: ["The sexton, holding him under, drowned the harbourmaster; whoever he thinks saw it, he kills, and the cottage is searched."],
  };
  const choices = ["I ask whose hand was holding it.", "I ask who he thinks did it, and whether the room was searched.", "I ask after the harbourmaster."];
  expect(unknownWords(choices, secret, "Tamsin holds the lamp.")).toEqual([[], [], []]);
});

test("a day or month is never taken for a made-up name, nor an everyday word the secrets hold for one", () => {
  const secret = { ...state, plotThreads: ["By Sunday the honest clerk has written the ledger out in March."] };
  const choices = ["I wait until Sunday, then go.", "I ask for an honest answer, written down.", "I ride north before March."];
  expect(unknownWords(choices, secret, "Tamsin rides ahead.")).toEqual([[], [], []]);
});

test("a known fact, summary or Loose End naming someone or somewhere the player has only in the secrets is dropped, even if an earlier fact named it", () => {
  const secret = {
    ...state,
    plotThreads: ["Ossery hides the ledger in an oilskin under the well."],
    pcKnown: { facts: ["Ossery wraps it in oilskin."], npcs: [] },
  };
  const operations = [
    { op: "add_known_fact", fact: "Ossery has the ledger." },
    { op: "set_known_npc_summary", name: "Tamsin", summary: "A driver who knows Ossery." },
    { op: "add_loose_end", loose_end: "Tamsin wants the ledger found." },
    { op: "npc_learns", name: "Tamsin", fact: "Ossery has the oilskin." },
  ] as Parameters<typeof withoutUnread>[0];
  expect(withoutUnread(operations, secret, "Tamsin rides ahead and speaks of a ledger.")).toEqual(operations.slice(2));
  // Kept once the player has read it.
  expect(withoutUnread(operations, secret, "Tamsin sees Ossery with the ledger.")).toEqual(operations);
});

test("a known fact is never dropped for a long word only the secrets hold, as the PC names what they read in their own words", () => {
  const secret = { ...state, plotThreads: ["Ossery carried a lantern down to the crypt, and his daughter saw it."] };
  const operations = [
    { op: "add_known_fact", fact: "Jory saw a lantern in the crypt." },
    { op: "set_known_npc_summary", name: "Tamsin", summary: "Ossery's daughter, by her word." },
  ] as Parameters<typeof withoutUnread>[0];
  expect(withoutUnread(operations, secret, "Jory says he saw a light down in the crypt. Ossery? Tamsin says: my father.")).toEqual(operations);
});

test("a Loose End copying a thread's plan in names the page has read is dropped, and one in the page's or the move's words kept", () => {
  const secret = { ...state, plotThreads: ["Captain Vane suspects Tamsin and means to arrest her at the well tomorrow; she hides a letter in her saddle."] };
  const operations = [
    { op: "add_loose_end", loose_end: "Vane means to arrest Tamsin at the well tomorrow." },
    { op: "add_loose_end", loose_end: "Tamsin is carrying something in her saddle." },
    { op: "add_loose_end", loose_end: "Why does Captain Vane watch Tamsin?" },
    { op: "add_loose_end", loose_end: "What did Tamsin bury by the well?" },
  ] as Parameters<typeof withoutUnread>[0];
  const read = "Captain Vane watches Tamsin at the well.\nI ask Tamsin what she buried.";
  expect(withoutUnread(operations, secret, read)).toEqual(operations.slice(2));
});

test("a Journal entry naming a many-word name or keyword is kept when the player has read the word that tells it apart", () => {
  const judge = {
    ...state,
    worldBible: [...state.worldBible, { title: "The judge", keywords: ["Mr Pell", "Pell's court"], content: "", alwaysOn: false }],
  };
  const operations = [
    { op: "add_known_fact", fact: "Mr Pell sits at Pell's court on Tuesday." },
    { op: "add_loose_end", loose_end: "What Ossery saw." },
  ] as Parameters<typeof withoutUnread>[0];
  expect(withoutUnread(operations, judge, "Tamsin says Pell will hear the case.")).toEqual(operations.slice(0, 1));
});

test("a Journal entry naming a Lore Entry by another of its keywords is kept once the player has read one of them", () => {
  const operations = [{ op: "add_known_fact", fact: "Fuel is hidden at Free Wells." }] as Parameters<typeof withoutUnread>[0];
  expect(withoutUnread(operations, state, "Tamsin rides ahead.")).toEqual([]);
  expect(withoutUnread(operations, state, "Tamsin kicks one of the drums.")).toEqual(operations);
});

test("a thread's now, the World Rules and every word of a name the player has read never drop a true note", () => {
  const vicar = {
    ...state,
    npcs: [...state.npcs, { name: "Reverend Amos Thorne", appearance: "a vicar" }],
    worldRules: ["Brandy comes ashore through the crypt, which is smuggling."],
    plotThreads: ["Reverend Amos Thorne pays the constable from the brandy."],
    // A now retells play, so its words are no secret: these three each dropped a true note on the bench.
    threadsNow: { "Reverend Amos Thorne pays the constable from the brandy.": "Thorne arrived at the hearthstone with the payments." },
  };
  const operations = [
    { op: "add_known_fact", fact: "Reverend Thorne offered for the cottage." },
    { op: "add_known_fact", fact: "The constable is on the smuggling payroll." },
    { op: "add_loose_end", loose_end: "Someone arrived at the hearthstone with payments." },
  ] as Parameters<typeof withoutUnread>[0];
  expect(withoutUnread(operations, vicar, "Thorne called at the inn and paid the constable.")).toEqual(operations);
});

test("a Choice is dropped for four words copied from the secrets only when one of them is a word the player hasn't read", () => {
  const secret = { ...state, plotThreads: ["Ossery goes to the long room at noon to burn the ledger."] };
  const choices = ["I go to the long room at noon.", "I stop him going to burn the ledger.", "Ride on."];
  expect(unknownWords(choices, secret, "Tamsin says the long room opens at noon, and Ossery keeps a ledger.")).toEqual([[], ["to burn the ledger"], []]);
});

test("a Lore keyword the player has read clears that keyword and the entry's names, not the rest of what it hides", () => {
  const choices = ["I ride to Free Wells.", "I count the fuel drums buried there."];
  expect(unknownWords(choices, { ...state, plotThreads: [] }, "Tamsin rides past the old hut.")).toEqual([[], ["buried"]]);
  expect(unknownWords(choices, { ...state, plotThreads: [] }, "Tamsin rides past the old hut, where something is buried.")).toEqual([[], []]);
});

test("Choices asked for alone are sent the PC's Journal, so they build on what the PC knows", async () => {
  const { textProvider, prompts } = scriptedTextProvider(JSON.stringify({ choices: ["Ask Jory.", "Ride on now.", "Wait here."] }));
  await writeChoices(textProvider, "Jory looks away.", new AbortController().signal, "", "", {
    facts: ["Jory works the lead strings."],
    looseEnds: ["Who paid Jory?"],
    storyTime: { day: 3, date: "3rd of Thaw", timeOfDay: "dusk" },
  });
  expect(JSON.parse(prompts[0]!.at(-1)!.content)).toMatchObject({ journal: { facts: ["Jory works the lead strings."], loose_ends: ["Who paid Jory?"] } });
  // The story time too, as facts never retire and Choices offered to wait for an event the story had already held.
  expect(JSON.parse(prompts[0]!.at(-1)!.content).story_time).toEqual({ day: 3, date: "3rd of Thaw", timeOfDay: "dusk" });
  // The journal first and the replies last, so the provider's cache reaches past the journal, which mostly grows at its end.
  expect(Object.keys(JSON.parse(prompts[0]!.at(-1)!.content))).toEqual(["journal", "story_time", "previous_reply", "player_move", "reply"]);
  expect(prompts[0]![0]!.content).toContain("the story time now");
});

test("a Choice built on what the PC hasn't learned is dropped, not reworded, and the others are kept", () => {
  // A rewording kept the secret in other words, so no one is asked to write it again.
  const choices = ["Ask Tamsin about the old hut.", "Ask Jory what scares him.", "Ride on."];

  expect(knownChoices(choices, state, "Tamsin rides ahead.", "Jory looks away.")).toEqual(["Ask Jory what scares him.", "Ride on."]);
  expect(knownChoices(["Ask Jory what scares him.", "Ride on.", "Wait."], state, "", "")).toHaveLength(3);
});

test("Choices asked for alone see the player's earlier moves, and a nudge to move on once the story time has stood still", async () => {
  const { textProvider, prompts } = scriptedTextProvider(
    JSON.stringify({ choices: ["Ask Jory.", "Ride on now.", "Wait here."] }),
    JSON.stringify({ choices: ["Ask Jory.", "Ride on now.", "Wait here."] }),
  );
  const ask = (still: boolean) =>
    writeChoices(textProvider, "Jory looks away.", new AbortController().signal, "", "", {
      facts: [],
      looseEnds: [],
      moves: ["I wait by the well."],
      still,
    });
  await ask(true);
  await ask(false);
  expect(JSON.parse(prompts[0]!.at(-1)!.content)).toMatchObject({ earlier_moves: ["I wait by the well."], time_still: true });
  expect(JSON.parse(prompts[1]!.at(-1)!.content)).not.toHaveProperty("time_still");
});

test("Choices asked for alone get no date the clock has passed midnight beyond, only the time of day", async () => {
  const { textProvider, prompts } = scriptedTextProvider(JSON.stringify({ choices: ["Ask Jory.", "Ride on now.", "Wait here."] }));
  await writeChoices(textProvider, "Jory looks away.", new AbortController().signal, "", "", {
    facts: [],
    looseEnds: [],
    storyTime: { day: 4, date: "3rd of Thaw", timeOfDay: "the small hours", hours: 75, dateDue: true },
  });
  expect(JSON.parse(prompts[0]!.at(-1)!.content).story_time).toEqual({ day: 4, timeOfDay: "the small hours" });
});
