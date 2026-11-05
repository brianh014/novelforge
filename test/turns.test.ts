import { expect, test } from "bun:test";
import type { TurnResult } from "../src/web/api";
import { firstMove, runningTurn, startTurn, takeMissedFailure } from "../src/web/turns";

const started = { input: "I wade forward.", narration: "" };

/** A Turn that streams only when told to, and ends when told to. */
function scriptedTurn(id: string) {
  let show = (_: string) => {};
  let finish = (_: TurnResult) => {};
  const turn = startTurn(id, started, (showText) => {
    show = showText;
    return new Promise((resolve) => (finish = resolve));
  });
  return { turn, show: (text: string) => show(text), finish: (result: TurnResult) => finish(result) };
}

test("a Turn goes on with nobody watching, and a returning screen picks up its text so far", async () => {
  const { turn, show, finish } = scriptedTurn("away");
  const before: string[] = [];
  turn.watch(({ narration }) => before.push(narration))();

  show("The tide");

  const after: string[] = [];
  const unwatch = runningTurn("away")!.watch(({ narration }) => after.push(narration));
  show("The tide rises");
  expect(before).toEqual([""]);
  expect(after).toEqual(["The tide", "The tide rises"]);

  finish({ messages: [] });
  await turn.finished;
  unwatch();
  expect(runningTurn("away")).toBeUndefined();
});

test("each Save has its own Turn, and leaving doesn't reach the Turn's request", async () => {
  let aborted = false;
  const signals = startTurn("own", started, async (_, signal) => {
    signal.addEventListener("abort", () => (aborted = true));
    return { messages: [] };
  });
  const other = scriptedTurn("other");

  expect(runningTurn("other")).toBe(other.turn);
  await signals.finished;
  expect(runningTurn("own")).toBeUndefined();
  expect(runningTurn("other")).toBe(other.turn);
  expect(aborted).toBe(false);

  other.finish({ messages: [] });
  await other.turn.finished;
});

test("a failure with nobody watching waits, once, for the screen's return", async () => {
  const { turn, finish } = scriptedTurn("missed");

  finish({ error: "The Text Provider request failed", input: "I wade forward." });
  await turn.finished;

  expect(takeMissedFailure("missed")).toEqual({ error: "The Text Provider request failed", input: "I wade forward." });
  expect(takeMissedFailure("missed")).toBeUndefined();
});

test("a failure someone watched isn't told twice, and a success leaves nothing", async () => {
  const watched = scriptedTurn("watched");
  const unwatch = watched.turn.watch(() => {});
  watched.finish({ error: "Failed", input: "I wade forward." });
  await watched.turn.finished;
  unwatch();
  expect(takeMissedFailure("watched")).toBeUndefined();

  const fine = scriptedTurn("fine");
  fine.finish({ messages: [] });
  await fine.turn.finished;
  expect(takeMissedFailure("fine")).toBeUndefined();
});

test("a failed replacement with nobody watching remembers what it replaced", async () => {
  const message = { id: 2, role: "narrator" as const, text: "The tide rises." };
  let finish = (_: TurnResult) => {};
  const turn = startTurn("replaced", { input: "Shorter.", narration: "", replaces: message }, () => new Promise((resolve) => (finish = resolve)));

  finish({ error: "No", input: "Shorter." });
  await turn.finished;

  expect(takeMissedFailure("replaced")).toEqual({ error: "No", input: "Shorter.", replaces: 2 });
});

const page = { running: false, failure: false, action: false, unopened: false };

test.each([
  ["a quiet story", page, "wait"],
  ["an unopened story", { ...page, unopened: true }, "open"],
  ["an item waiting to be used", { ...page, action: true }, "play"],
  ["a running Turn, ahead of all else", { ...page, running: true, failure: true, action: true, unopened: true }, "follow"],
  ["a failed Opening, which must not be paid for again", { ...page, failure: true, unopened: true }, "wait"],
  ["a failure with an item waiting", { ...page, failure: true, action: true }, "wait"],
])("a page opening on %s", (_, state, move) => {
  expect(firstMove(state)).toBe(move);
});
