import type { Message, Settings } from "./api";

export type ChatStyle = Settings["chatStyle"];
export type Beat = { speaker?: string; player?: boolean; text: string };
/** A `replaces` response is left out of the story while its replacement arrives. */
export type TurnInProgress = { input: string; narration: string; replaces?: Message };
export type StageBeat = { beat: Beat; message?: Message; number: number; of: number };

const SPOKEN_LINE = /^\[([^[\]]+)\]:\s*(.*)$/;

/** Anything that isn't a whole `[Name]:` tag, including one still streaming, is narration. */
export function messageBeats({ role, text }: Pick<Message, "role" | "text">): Beat[] {
  if (role === "player") return [{ player: true, text }];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [, speaker, words] = line.match(SPOKEN_LINE) ?? [];
      return speaker?.trim() ? { speaker: speaker.trim(), text: words! } : { text: line };
    });
}

const numbered = (beats: Beat[], message?: Message): StageBeat[] =>
  beats.map((beat, index) => ({ beat, message, number: index + 1, of: beats.length }));

/** The whole story, so that Back reaches any Message, with a Turn in progress at the end and no `message` on its beats. */
export function stageBeats(told: Message[], turn?: TurnInProgress) {
  const beats = told.flatMap((message) => numbered(messageBeats(message), message));
  if (!turn) return beats;
  if (!turn.replaces) beats.push(...numbered(messageBeats({ role: "player", text: turn.input })));
  return [...beats, ...numbered(messageBeats({ role: "narrator", text: turn.narration }))];
}

/** Each Message's beats count from 1, so the last 1 is where the newest response starts. */
export const openingBeat = (beats: StageBeat[]) => beats.findLastIndex(({ number }) => number === 1);

// shortcut: who speaks rests on the Narrator following its prompt, so a reworded name gets an initial and the wrong side, match names loosely if real models do that.
export function BeatLine({ beat, style, pc, face }: { beat: Beat; style: ChatStyle; pc: string; face?: string }) {
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
