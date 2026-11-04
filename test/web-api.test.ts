import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { playTurn, setupProblem } from "../src/web/api";
import { ContentRefused, type TextProvider } from "../src/turn-engine";
import { narration, startGame, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;

/** The browser's relative fetch, aimed at a real server. `tamper` gets each Turn request and decides what comes back. */
function start(textProvider: TextProvider, tamper = (send: () => Promise<Response>) => send()) {
  game = startGame(join(folder.path, "Saves"), textProvider);
  const realFetch = fetch;
  spyOn(globalThis, "fetch").mockImplementation((async (path: string, init?: RequestInit) => {
    const send = () => realFetch(game.url(path), init);
    return String(path).endsWith("/turns") ? tamper(send) : send();
  }) as typeof fetch);
}

const reply = (text: string): TextProvider => async () => narration(text);

/** Writes `parts` as streamed reply text, then returns the whole reply. */
const streamed =
  (...parts: string[]): TextProvider =>
  async (_prompt, { onText }) => {
    parts.forEach(onText);
    return parts.join("");
  };

const play = async (id: string, input: string, after = 0) => {
  const shown: string[] = [];
  const result = await playTurn(id, input, after, (text) => shown.push(text), new AbortController().signal);
  return { result, shown };
};

const unreachable = (message: string) => () => Promise.reject(new Error(message));

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  (fetch as unknown as { mockRestore(): void }).mockRestore();
  await game.stop();
  folder.remove();
});

test("narration builds up as it streams, and the committed Messages finish the Turn", async () => {
  start(streamed('{"check":null,"narration":"The tide ', 'rises.","state_operations":[]}'));
  const id = await game.createSave();

  const { result, shown } = await play(id, "I wade forward.");

  expect(shown).toEqual(["The tide ", "The tide rises."]);
  expect(result).toEqual({
    messages: [
      { id: 1, role: "player", text: "I wade forward." },
      { id: 2, role: "narrator", text: "The tide rises." },
    ],
  });
});

test("a Turn with no narration events still finishes from its committed Messages", async () => {
  start(reply("The tide rises."));
  const id = await game.createSave();

  const { result, shown } = await play(id, "I wade forward.");

  expect(shown).toEqual([]);
  expect(result).toMatchObject({ messages: [{ role: "player" }, { text: "The tide rises." }] });
});

test("a restart discards the narration shown so far", async () => {
  let attempts = 0;
  start(async (prompt, request) => {
    attempts++;
    if (attempts === 1) return streamed('{"check":null,"narration":"The wrong tide')(prompt, request);
    return streamed('{"check":null,"narration":"The ', 'tide.","state_operations":[]}')(prompt, request);
  });
  const id = await game.createSave();

  const { shown } = await play(id, "I wade forward.");

  expect(shown).toEqual(["The wrong tide", "", "The ", "The tide."]);
});

test("a refusal gives back the server's message and the player's text", async () => {
  start(async () => {
    throw new ContentRefused();
  });
  const id = await game.createSave();

  const { result } = await play(id, "Something refused.");

  expect(result).toEqual({
    error: "The Narrator refused this message. Edit it and try again.",
    input: "Something refused.",
  });
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("a failed Turn sent over HTTP 200 keeps the player's text", async () => {
  start(unreachable("provider down"));
  const id = await game.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toEqual({
    error: "The Text Provider request failed. Send it again to retry.",
    input: "I wade forward.",
  });
});

test("a bad request answered before any stream keeps the player's text", async () => {
  start(reply("Never used."));
  const id = await game.createSave();

  const { result } = await play(id, "");

  expect(result).toMatchObject({ input: "" });
  expect((result as { error: string }).error).toContain("input");
});

test("events split across network chunks still parse, even inside a character", async () => {
  const text = 'event: narration\ndata: {"text":"Café"}\n\nevent: done\ndata: {"messages":[]}\n\n';
  const bytes = new TextEncoder().encode(text);
  const middle = bytes.indexOf(0xc3) + 1;
  start(reply("Unused."), async () => {
    const parts = [bytes.subarray(0, 5), bytes.subarray(5, middle), bytes.subarray(middle)];
    return new Response(new ReadableStream({ start: (c) => (parts.forEach((p) => c.enqueue(p)), c.close()) }));
  });
  const id = await game.createSave();

  const { result, shown } = await play(id, "I wade forward.");

  expect(shown).toEqual(["Café"]);
  expect(result).toEqual({ messages: [] });
});

test("a stream that drops after the Turn committed recovers the Turn from the Messages", async () => {
  start(reply("The tide rises."), async (send) => {
    await send().then((response) => response.text());
    return new Response('event: narration\ndata: {"text":"The ti"}\n\n');
  });
  const id = await game.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toMatchObject({ messages: [{ id: 1 }, { id: 2, text: "The tide rises." }] });
});

test("a stream that drops with nothing committed keeps the player's text", async () => {
  start(reply("Unused."), async () => new Response('event: narration\ndata: {"text":"The ti"}\n\n'));
  const id = await game.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toMatchObject({ input: "I wade forward." });
  expect((result as { error: string }).error).toContain("wasn't saved");
});

test("an older Turn is not mistaken for the dropped one", async () => {
  let dropping = false;
  start(reply("The tide rises."), async (send) => (dropping ? new Response("") : send()));
  const id = await game.createSave();
  await play(id, "First.");
  dropping = true;

  const { result } = await play(id, "Second.", 2);

  expect(result).toMatchObject({ input: "Second." });
});

test("leaving mid-Turn stops it, stores nothing and keeps the player's text", async () => {
  start(async (_prompt, { onText, signal }) => {
    onText('{"check":null,"narration":"The ti');
    await new Promise((_, reject) => signal.addEventListener("abort", reject));
    return "";
  });
  const id = await game.createSave();
  const leaving = new AbortController();

  const result = await playTurn(id, "I wade forward.", 0, () => leaving.abort(), leaving.signal);

  expect(result).toMatchObject({ input: "I wade forward." });
  expect(await game.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("losing the server altogether keeps the player's text", async () => {
  start(reply("Unused."));
  const id = await game.createSave();
  spyOn(globalThis, "fetch").mockImplementation(unreachable("connection refused") as unknown as typeof fetch);

  const { result } = await play(id, "I wade forward.");

  expect(result).toMatchObject({ input: "I wade forward." });
  expect((result as { error: string }).error).toContain("can't be reached");
});

test("the player is told when the Narrator has no model or key, but a local server needs no key", () => {
  start(reply("Unused."));
  const openRouter = "https://openrouter.ai/api/v1";
  const local = "http://127.0.0.1:8080/v1";

  expect(setupProblem({ textBaseUrl: openRouter, textModel: "", hasTextApiKey: true })).toContain("model");
  expect(setupProblem({ textBaseUrl: openRouter, textModel: "a/model", hasTextApiKey: false })).toContain("key");
  expect(setupProblem({ textBaseUrl: openRouter, textModel: "a/model", hasTextApiKey: true })).toBeUndefined();
  expect(setupProblem({ textBaseUrl: local, textModel: "a/model", hasTextApiKey: false })).toBeUndefined();
});
