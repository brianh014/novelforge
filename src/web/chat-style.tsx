import { CONTINUE_INPUT, OPENING_INPUT } from "../prompt-assembler";
import type { Chapter, Message, Settings } from "./api";

const NUMERALS: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export const roman = (n: number) =>
  NUMERALS.reduce((text, [value, numeral]) => {
    for (; n >= value; n -= value) text += numeral;
    return text;
  }, "");

/** Each chapter's heading goes above its first Message shown, and its large first letter on its first narration. */
export function chapterOpenings(chapters: Chapter[], messages: Pick<Message, "id" | "role">[]) {
  const heads = new Map<number, { numeral: string; title: string }>();
  const opens = new Set<number>();
  chapters.forEach(({ title, lastMessage }, index) => {
    const after = index === 0 ? -Infinity : (chapters[index - 1]!.lastMessage ?? Infinity);
    const inside = messages.filter(({ id }) => id > after && id <= (lastMessage ?? Infinity));
    if (!inside[0]) return;
    heads.set(inside[0].id, { numeral: roman(index + 1), title });
    const narration = inside.find(({ role }) => role === "narrator");
    if (narration) opens.add(narration.id);
  });
  return { heads, opens };
}

export type ChatStyle = Settings["chatStyle"];
/** `rule` is a Continue, which shows as a short line between the responses. */
export type Beat = { speaker?: string; player?: boolean; rule?: boolean; text: string };

export const isContinue = ({ role, text }: Pick<Message, "role" | "text">) => role === "player" && text === CONTINUE_INPUT;
export const ContinueRule = () => <hr className="continued" aria-label="The story continues" />;
/** A `replaces` response is left out of the story while its replacement arrives. */
export type TurnInProgress = { input: string; narration: string; replaces?: Message; edit?: boolean; retry?: string };
export type StageBeat = { beat: Beat; message?: Message; number: number; of: number };

// shortcut: a bare name is any capitalized words before a colon and a quote, so "Sign: “Closed”" gets a speaker and "Jan van Dijk" doesn't, match against the state's names if that shows up.
const SPOKEN_LINE = /^(?:\[([^[\]]+)\]|(\p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){0,3})(?=:\s*["“])):\s*(.*)$/u;

/** The story as the player reads it, without the stored Message that opened it. */
export const readable = (messages: Message[]) =>
  messages.filter(({ id, role, text }) => !(id === messages[0]?.id && role === "player" && text === OPENING_INPUT));

/** The Narrator is told to write `[Name]:`, but real models also drop the brackets. Anything else, including a tag still streaming, is narration. */
export function messageBeats({ role, text }: Pick<Message, "role" | "text">): Beat[] {
  if (isContinue({ role, text })) return [{ player: true, rule: true, text: "" }];
  if (role === "player") return [{ player: true, text }];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [, tagged, bare, words] = line.match(SPOKEN_LINE) ?? [];
      const speaker = tagged ?? bare;
      return speaker?.trim() ? { speaker: speaker.trim(), text: words! } : { text: line };
    });
}

// The Stage box shows one beat at a time, so a Continue's rule has nothing to set apart there.
const numbered = (beats: Beat[], message?: Message): StageBeat[] =>
  beats.filter(({ rule }) => !rule).map((beat, index) => ({ beat, message, number: index + 1, of: beats.length }));

/** The whole story, so that Back reaches any Message, with a Turn in progress at the end and no `message` on its beats. */
export function stageBeats(told: Message[], turn?: TurnInProgress) {
  const beats = told.flatMap((message) => numbered(messageBeats(message), message));
  if (!turn) return beats;
  // No input means the Narrator is opening the story.
  if (!turn.replaces && turn.input) beats.push(...numbered(messageBeats({ role: "player", text: turn.input })));
  return [...beats, ...numbered(messageBeats({ role: "narrator", text: turn.narration }))];
}

/** Each Message's beats count from 1, so the last 1 is where the newest response starts. */
export const openingBeat = (beats: StageBeat[]) => beats.findLastIndex(({ number }) => number === 1);

// shortcut: who speaks rests on the Narrator following its prompt, so a reworded name gets an initial and the wrong side, match names loosely if real models do that.
export function BeatLine({ beat, style, pc, face }: { beat: Beat; style: ChatStyle; pc: string; face?: string }) {
  if (beat.rule) return <ContinueRule />;
  const name = beat.player ? pc : beat.speaker;
  if (style === "bubbles" && name) {
    const isPc = name === pc;
    return (
      <div className={isPc ? "bubble-line pc" : "bubble-line"}>
        {!isPc && (
          <span className="portrait face" aria-hidden="true">
            {face ? <img src={face} alt="" /> : name[0]}
          </span>
        )}
        <div className="bubble">
          <small className="who">{name}</small>
          <p>{beat.text}</p>
        </div>
      </div>
    );
  }
  const labelled = name && !(style === "prose" && beat.player);
  const label = style === "script" ? (beat.player ? `${name}:` : `[${name}]:`) : name;
  return (
    <p className={name ? undefined : "told"}>
      {labelled && <span className="who">{label} </span>}
      {beat.text}
    </p>
  );
}
