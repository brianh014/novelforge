import type { TurnEvents } from "./turn-engine";

export type LiveTurn = {
  input: string;
  /** The text so far. */
  narration: string;
  /** The latest Message when the Turn began, so anything newer is this Turn's. */
  after: number;
  /** The Message a Rewrite or Regenerate replaces. */
  replaces?: number;
};
export type FailedTurn = { status: number; error: string; input: string; replaces?: number };

export class TurnRunning extends Error {}
export class WorldChanging extends Error {}

/**
 * The Turns being played, which outlive the requests that started them, so a player can leave and come back.
 * shortcut: held in memory, so a restart ends them unsaved, keep them in the Save if restarts mid-Turn become common.
 */
export function liveTurns() {
  const running = new Map<string, LiveTurn>();
  const failed = new Map<string, FailedTurn>();
  const changing = new Set<string>();

  function assertIdle(id: string) {
    if (running.has(id)) throw new TurnRunning();
    if (changing.has(id)) throw new WorldChanging();
  }

  return {
    assertIdle,

    /** Keeps Turns and edits out while the Narrator changes the world. It's no Turn, so a page has nothing to show. The returned function ends it. */
    hold(id: string) {
      assertIdle(id);
      changing.add(id);
      return () => changing.delete(id);
    },

    /** Only one per Save, as a second would fail at the end anyway, after the model was paid for it. */
    begin(id: string, after: number, input: string, replaces?: number) {
      assertIdle(id);
      failed.delete(id);
      const turn: LiveTurn = { input, narration: "", after, ...(replaces !== undefined && { replaces }) };
      running.set(id, turn);
      return {
        input,
        replaces,
        heard: (...[event, data]: Parameters<TurnEvents>) => {
          turn.narration = event === "restart" ? "" : turn.narration + (data as { text: string }).text;
        },
        /** A `failure` waits for the player, who may not have been there to see it. */
        end(failure?: FailedTurn) {
          running.delete(id);
          if (failure) failed.set(id, failure);
        },
      };
    },

    /** Reading a failure takes it, so it's told once. */
    status(id: string) {
      const turn = running.get(id);
      if (turn) return { running: turn };
      const failure = failed.get(id);
      failed.delete(id);
      return failure ? { failed: failure } : {};
    },
  };
}

export type LiveTurns = ReturnType<typeof liveTurns>;
export type BegunTurn = ReturnType<LiveTurns["begin"]>;
