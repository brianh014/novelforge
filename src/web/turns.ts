import type { TurnResult } from "./api";
import type { TurnInProgress } from "./chat-style";

type Failure = Extract<TurnResult, { error: string }> & { replaces?: number };
type Play = (show: (narration: string) => void, signal: AbortSignal) => Promise<TurnResult>;

export type RunningTurn = {
  turn: TurnInProgress;
  finished: Promise<TurnResult>;
  /** Hears the text so far at once, then each change. The returned function stops that. */
  watch: (listener: (turn: TurnInProgress) => void) => () => void;
};

// Held outside the screens, so the player can look at the Journal while a Turn streams. A reload drops this, and the page asks the server instead.
const running = new Map<string, RunningTurn>();
const missed = new Map<string, Failure>();

export const runningTurn = (id: string) => running.get(id);

export function startTurn(id: string, started: TurnInProgress, play: Play) {
  let watcher: ((turn: TurnInProgress) => void) | undefined;
  const entry: RunningTurn = {
    turn: started,
    finished: undefined as never,
    watch(listener) {
      watcher = listener;
      listener(entry.turn);
      return () => {
        if (watcher === listener) watcher = undefined;
      };
    },
  };
  running.set(id, entry);
  const show = (narration: string) => {
    entry.turn = { ...started, narration };
    watcher?.(entry.turn);
  };
  // Never aborted, as leaving the screen doesn't end a Turn.
  entry.finished = play(show, new AbortController().signal).then((result) => {
    running.delete(id);
    if ("error" in result && !watcher) missed.set(id, { ...result, replaces: started.replaces?.id });
    return result;
  });
  return entry;
}

/** A Turn that failed while the player was on another screen, once, for when they return. */
export function takeMissedFailure(id: string) {
  const failure = missed.get(id);
  missed.delete(id);
  return failure;
}

/** What a story page does once loaded. A failure waits for the player, as going on would pay again and clear the error. */
export function firstMove(page: { running: boolean; failure: boolean; action: boolean; unopened: boolean }) {
  if (page.running) return "follow";
  if (page.failure) return "wait";
  if (page.action) return "play";
  return page.unopened ? "open" : "wait";
}
