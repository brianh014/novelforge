import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CONTINUE_INPUT } from "../src/prompt-assembler";
import { type Beat, BeatLine, messageBeats, openingBeat, stageBeats } from "../src/web/chat-style";

test("a Continue shows as a rule in the story, and the Stage box skips it", () => {
  const [beat] = messageBeats({ role: "player", text: CONTINUE_INPUT });
  expect(renderToStaticMarkup(<BeatLine beat={beat!} style="script" pc="Ash" />)).toContain('<hr class="continued"');
  const told = [{ id: 1, role: "player", text: CONTINUE_INPUT }, { id: 2, role: "narrator", text: "The rain keeps on." }] as Parameters<typeof stageBeats>[0];
  expect(stageBeats(told).map(({ beat }) => beat.text)).toEqual(["The rain keeps on."]);
});

const narrator = (text: string) => messageBeats({ role: "narrator", text });

test("each spoken line and each line of description is its own beat", () => {
  expect(narrator("[Ashley]: “Hey, do you have those spanners?”\n\nAshley looks up from her workbench.\n[Ashley]: “Well?”")).toEqual([
    { speaker: "Ashley", text: "“Hey, do you have those spanners?”" },
    { text: "Ashley looks up from her workbench." },
    { speaker: "Ashley", text: "“Well?”" },
  ]);
});

test("a spoken line without the brackets still has its speaker", () => {
  expect(narrator("Dov Marchetti: “Sure. That's fair.”\nMary O'Neil-Vance: \"Well?\"")).toEqual([
    { speaker: "Dov Marchetti", text: "“Sure. That's fair.”" },
    { speaker: "Mary O'Neil-Vance", text: "\"Well?\"" },
  ]);
});

test("a colon in narration doesn't make a speaker", () => {
  for (const line of ["He says one thing: “Run.”", "Dov Marchetti: he never answers.", "The sign reads: “Closed”"]) {
    expect(narrator(line)).toEqual([{ text: line }]);
  }
});

test("text with no spoken lines is plain narration", () => {
  expect(narrator("The tide rises.\n\nNobody speaks.")).toEqual([{ text: "The tide rises." }, { text: "Nobody speaks." }]);
});

test.each([
  ["[Ash"],
  ["[Ashley"],
  ["[Ashley]"],
  ["The ledger reads [illegible] at the foot."],
  ["[The lamp gutters.] Nothing else moves."],
  ["He said: [Ashley]: “No.”"],
  ["[]: nothing"],
  ["[ ]: nothing"],
  ["[Ashley][Ben]: both"],
  ["[Ash[ley]]: nested"],
])("%s stays as written", (line) => {
  expect(narrator(line)).toEqual([{ text: line }]);
});

test("a spoken line can still be arriving", () => {
  expect(narrator("[Ashley]:")).toEqual([{ speaker: "Ashley", text: "" }]);
  expect(narrator("[Ashley]: “Hey")).toEqual([{ speaker: "Ashley", text: "“Hey" }]);
});

test("square brackets in the words of a spoken line stay in them", () => {
  expect(narrator("[Ashley]: “It says [sic] right there.”")).toEqual([{ speaker: "Ashley", text: "“It says [sic] right there.”" }]);
});

test("a name's padding isn't part of it", () => {
  expect(narrator("[ Ashley ]: “Hey.”\r\nShe waves.")).toEqual([{ speaker: "Ashley", text: "“Hey.”" }, { text: "She waves." }]);
});

test("what the player wrote is one beat of theirs, whatever it looks like", () => {
  expect(messageBeats({ role: "player", text: "[Ashley]: “Fake line.”\nI wave." })).toEqual([
    { player: true, text: "[Ashley]: “Fake line.”\nI wave." },
  ]);
});

const CHAT_STYLES = ["script", "prose", "bubbles", "stage"] as const;
const shown = (beat: Beat, style: (typeof CHAT_STYLES)[number], face?: string) =>
  renderToStaticMarkup(<BeatLine beat={beat} style={style} pc="Ash" face={face} />);

test.each(CHAT_STYLES)("%s shows markup in a story as plain text", (style) => {
  const attack = `<img src=x onerror=alert(1)>`;
  for (const beat of [
    { text: attack },
    { speaker: attack, text: attack },
    { player: true, text: attack },
  ]) {
    expect(shown(beat, style)).not.toContain("<img");
    expect(shown(beat, style)).toContain("&lt;img");
  }
});

test("Script labels every line, like a play", () => {
  expect(shown({ speaker: "Ashley", text: "“Hey.”" }, "script")).toContain("[Ashley]:");
  expect(shown({ player: true, text: "I wave." }, "script")).toContain("Ash:");
});

test("Prose runs a speaker's name into the text and leaves the player's lines unlabelled", () => {
  const spoken = shown({ speaker: "Ashley", text: "“Hey.”" }, "prose");
  expect(spoken).toContain("Ashley");
  expect(spoken).not.toContain("[Ashley]");
  expect(shown({ player: true, text: "I wave." }, "prose")).not.toContain("Ash");
});

test("Bubbles puts a portrait beside an NPC, an initial without one, and the PC on their own side", () => {
  expect(shown({ speaker: "Ashley", text: "“Hey.”" }, "bubbles", "/portrait.png")).toContain('src="/portrait.png"');
  expect(shown({ speaker: "Ashley", text: "“Hey.”" }, "bubbles")).toContain(">A<");
  expect(shown({ player: true, text: "I wave." }, "bubbles")).toContain("bubble-line pc");
  expect(shown({ speaker: "Ash", text: "“Hi.”" }, "bubbles")).toContain("bubble-line pc");
  expect(shown({ text: "The tide rises." }, "bubbles")).not.toContain("bubble");
});

const message = (id: number, role: "player" | "narrator", text: string) => ({ id, role, text });
const story = [message(1, "player", "I wave."), message(2, "narrator", "She looks up.\n[Ashley]: “Hey.”")];

test("the Stage box opens on the first beat of the newest response", () => {
  const beats = stageBeats(story);
  expect(beats.map(({ beat }) => beat.text)).toEqual(["I wave.", "She looks up.", "“Hey.”"]);
  expect(beats.map(({ number, of }) => `${number}/${of}`)).toEqual(["1/1", "1/2", "2/2"]);
  expect(openingBeat(beats)).toBe(1);
  expect(beats[1]!.message).toBe(story[1]);
});

test("a Turn in progress follows the story, and opens on its own response once any arrives", () => {
  const waiting = stageBeats(story, { input: "I sit.", narration: "" });
  expect(waiting.at(-1)).toMatchObject({ beat: { player: true, text: "I sit." } });
  expect(waiting.at(-1)!.message).toBeUndefined();
  expect(openingBeat(waiting)).toBe(3);

  const arriving = stageBeats(story, { input: "I sit.", narration: "Rain." });
  expect(arriving.at(-1)!.beat.text).toBe("Rain.");
  expect(openingBeat(arriving)).toBe(4);
});

test("a response being replaced is left out, along with no second copy of the player's line", () => {
  const beats = stageBeats(story.slice(0, -1), { input: "Angrier.", narration: "[Ashley]: “No!”", replaces: story[1] });
  expect(beats.map(({ beat }) => beat.text)).toEqual(["I wave.", "“No!”"]);
  expect(openingBeat(beats)).toBe(1);
});
