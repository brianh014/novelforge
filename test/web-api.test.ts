import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import {
  beginStory,
  deleteSave,
  duplicateSave,
  generateWorld,
  getSave,
  importSave,
  listSaves,
  enhance,
  pickForMe,
  playTurn,
  regenerateWorld,
  replaceResponse,
  resumeTurn,
  getTurn,
  turnPolling,
  saveArtStyle,
  saveSettings,
  setupProblem,
} from "../src/web/api";
import { ContentRefused, type TextProvider } from "../src/turn-engine";
import { logOf, narration, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;

/** The browser's relative fetch, aimed at a real server. `tamper` gets each Turn request and decides what comes back. */
function start(textProvider: TextProvider, tamper = (send: () => Promise<Response>) => send()) {
  app = startApp(join(folder.path, "Saves"), textProvider);
  const realFetch = fetch;
  spyOn(globalThis, "fetch").mockImplementation((async (path: string, init?: RequestInit) => {
    const send = () => realFetch(app.url(path), init);
    return /\/(turns|regenerate|rewrite)$/.test(String(path)) ? tamper(send) : send();
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
  await app.stop();
  folder.remove();
});

test("narration builds up as it streams, and the committed Messages finish the Turn", async () => {
  start(streamed('{"check":null,"narration":"The tide ', 'rises.","state_operations":[]}'));
  const id = await app.createSave();

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
  const id = await app.createSave();

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
  const id = await app.createSave();

  const { shown } = await play(id, "I wade forward.");

  expect(shown).toEqual(["The wrong tide", "", "The ", "The tide."]);
});

test("a refusal gives back the server's message and the player's text", async () => {
  start(async () => {
    throw new ContentRefused();
  });
  const id = await app.createSave();

  const { result } = await play(id, "Something refused.");

  expect(result).toEqual({
    error: "The Narrator refused this message. Edit it and try again.",
    input: "Something refused.",
  });
  expect(await app.get(`/saves/${id}/messages`).then((r) => r.json())).toEqual({ messages: [] });
});

test("a failed Turn sent over HTTP 200 keeps the player's text", async () => {
  start(unreachable("provider down"));
  const id = await app.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toEqual({
    error: "The Text Provider request failed. Send it again to retry.",
    input: "I wade forward.",
  });
});

test("a bad request answered before any stream keeps the player's text", async () => {
  start(reply("Never used."));
  const id = await app.createSave();

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
  const id = await app.createSave();

  const { result, shown } = await play(id, "I wade forward.");

  expect(shown).toEqual(["Café"]);
  expect(result).toEqual({ messages: [] });
});

test("a stream that drops after the Turn committed recovers the Turn from the Messages", async () => {
  start(reply("The tide rises."), async (send) => {
    await send().then((response) => response.text());
    return new Response('event: narration\ndata: {"text":"The ti"}\n\n');
  });
  const id = await app.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toMatchObject({ messages: [{ id: 1 }, { id: 2, text: "The tide rises." }] });
});

test("a stream that drops with nothing committed keeps the player's text", async () => {
  start(reply("Unused."), async () => new Response('event: narration\ndata: {"text":"The ti"}\n\n'));
  const id = await app.createSave();

  const { result } = await play(id, "I wade forward.");

  expect(result).toMatchObject({ input: "I wade forward." });
  expect((result as { error: string }).error).toContain("wasn't saved");
});

test("an older Turn is not mistaken for the dropped one", async () => {
  let dropping = false;
  start(reply("The tide rises."), async (send) => (dropping ? new Response("") : send()));
  const id = await app.createSave();
  await play(id, "First.");
  dropping = true;

  const { result } = await play(id, "Second.", 2);

  expect(result).toMatchObject({ input: "Second." });
});

test("losing the server altogether keeps the player's text", async () => {
  start(reply("Unused."));
  const id = await app.createSave();
  spyOn(globalThis, "fetch").mockImplementation(unreachable("connection refused") as unknown as typeof fetch);
  const realEvery = turnPolling.everyMs;
  turnPolling.everyMs = 1;

  const { result } = await play(id, "I wade forward.");
  turnPolling.everyMs = realEvery;

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

test("Settings and Art Style save through the API client, which reports a refusal", async () => {
  start(reply("Unused."));
  const id = await app.createSave();

  expect(await saveSettings({ fontSize: "large", imageApiKey: "image-key" })).toMatchObject({
    fontSize: "large",
    hasImageApiKey: true,
  });
  await saveArtStyle(id, "Ink");

  expect((await getSave(id)).artStyle).toBe("Ink");
  await expect(saveSettings({ textBaseUrl: "not a url" })).rejects.toThrow("textBaseUrl");
});

const replace = async (id: string, messageId: number, feedback: string) => {
  const shown: string[] = [];
  const result = await replaceResponse(id, messageId, feedback, (text) => shown.push(text), new AbortController().signal);
  return { result, shown };
};

test("a replacement streams, and finishes with only the new Narrator Message", async () => {
  const replies = [reply("Rain."), streamed('{"check":null,"narration":"Sn', 'ow.","state_operations":[]}')];
  start((prompt, request) => replies.shift()!(prompt, request));
  const id = await app.createSave();
  await play(id, "I wait.");

  const { result, shown } = await replace(id, 2, "");

  expect(shown).toEqual(["Sn", "Snow."]);
  expect(result).toEqual({ messages: [{ id: 3, role: "narrator", text: "Snow." }] });
});

test("a Rewrite that fails hands the feedback back, with the response still in place", async () => {
  const replies = [reply("Rain."), () => Promise.reject(new ContentRefused())];
  start((prompt, request) => replies.shift()!(prompt, request));
  const id = await app.createSave();
  await play(id, "I wait.");

  const { result } = await replace(id, 2, "Make it snow.");

  expect(result).toEqual({
    error: "The Narrator refused this, so the response stays as it was.",
    input: "Make it snow.",
  });
});

test("a failed Regenerate asks the player to try again, not to send anything", async () => {
  const replies = [reply("Rain."), ...Array(3).fill(() => Promise.reject(new Error("network down")))];
  start((prompt, request) => replies.shift()!(prompt, request));
  const id = await app.createSave();
  await play(id, "I wait.");

  const { result } = await replace(id, 2, "");

  expect(result).toEqual({ error: "The Text Provider request failed. Try again.", input: "" });
});

test("a replacement whose stream drops after it committed recovers the new response", async () => {
  let dropping = false;
  start(reply("Rain."), async (send) => {
    const response = await send();
    if (!dropping) return response;
    await response.text();
    throw new Error("connection lost");
  });
  const id = await app.createSave();
  await play(id, "I wait.");
  dropping = true;

  const { result } = await replace(id, 2, "");

  expect(result).toEqual({ messages: [{ id: 3, role: "narrator", text: "Rain." }] });
});

test("a replacement whose stream drops with nothing committed says so, and keeps the feedback", async () => {
  let dropping = false;
  start(reply("Rain."), (send) => (dropping ? Promise.reject(new Error("connection lost")) : send()));
  const id = await app.createSave();
  await play(id, "I wait.");
  dropping = true;

  const { result } = await replace(id, 2, "Make it snow.");

  expect(result).toEqual({
    error: "The connection dropped and this wasn't saved. Try again.",
    input: "Make it snow.",
  });
});

test("the Load Story calls duplicate, import and delete a Save", async () => {
  start(reply("Unused."));
  const id = await app.createSave();
  const bytes = await app.get(`/saves/${id}/export`).then((r) => r.bytes());

  const { id: copy } = await duplicateSave(id);
  const { id: imported } = await importSave(new File([bytes], "ash.sqlite"));
  await deleteSave(id);

  const listed = (await listSaves()).map((save) => save.id);
  expect(listed.toSorted()).toEqual([copy, imported].toSorted());
  await expect(deleteSave(id)).rejects.toThrow("Save not found");
  await expect(importSave(new File(["junk"], "junk.sqlite"))).rejects.toThrow("isn't a valid Save");
});

const worldReply = (overview: string) =>
  JSON.stringify({
    world_overview: overview,
    calendar: "Days run in weeks of seven under the Tide Reckoning.",
    start_date: "3rd of Lowtide",
    start_time_of_day: "dusk",
    lore_entries: [{ title: "T", keywords: ["a", "b", "c"], content: "C" }],
    world_rules: ["R"],
    plot_threads: ["P"],
  });

test("the wizard's calls carry a world from Pick for me to a Save", async () => {
  const sheet = JSON.stringify({ wearing: ["coat"], carrying: [], health: "unhurt", injuries: [], conditions: [] });
  const replies = [JSON.stringify({ worldBrief: "A city on a whale.", title: "The Salt Reckoning", background: "Sailing" }), JSON.stringify({ text: "A vast city on a sleeping whale." }), sheet, worldReply("First."), worldReply("Second.")];
  start(async () => replies.shift()!);

  const pc = { name: "Ash", background: "", physicalTraits: "T", inventory: "coat" };
  const { worldBrief, title, background } = await pickForMe("Steampunk", { title: "", worldBrief: "", pc });
  const choices = { title: title!, theme: "Steampunk", worldBrief: worldBrief!, startingHook: "" };
  const enhanced = await enhance("worldBrief", worldBrief!, choices);
  const { id: world, overview } = await generateWorld({ ...choices, pc: { name: "Ash" }, inventory: "a coat" });
  const regenerated = await regenerateWorld(world, choices);
  const { id } = await beginStory(world, "Ink");

  expect(worldBrief).toBe("A city on a whale.");
  expect(enhanced).toBe("A vast city on a sleeping whale.");
  expect(overview).toBe("First.");
  expect(regenerated.overview).toBe("Second.");
  expect(background).toBe("Sailing");
  expect(await getSave(id)).toMatchObject({ worldBrief, artStyle: "Ink" });
});

test("a failed generation reaches the wizard as an error it can show", async () => {
  start(unreachable("offline"));

  await expect(generateWorld({ title: "Dust", theme: "Western", worldBrief: "Dust", startingHook: "", pc: { name: "Ash" }, inventory: "" })).rejects.toThrow(
    "The Text Provider request failed",
  );
});

const slowly =
  (text: string, ms: number): TextProvider =>
  async (_prompt, { onText }) => {
    onText(narration(text).slice(0, -2).slice(0, 40));
    await Bun.sleep(ms);
    return narration(text);
  };

test("a dropped stream waits for the Turn that is still running, then shows it", async () => {
  const realEvery = turnPolling.everyMs;
  turnPolling.everyMs = 20;
  try {
    start(slowly("The tide rises.", 120), async (send) => {
      void send();
      await Bun.sleep(30);
      return new Response("");
    });
    const id = await app.createSave();

    const { result } = await play(id, "I wade forward.");

    expect(result).toMatchObject({ messages: [{ id: 1 }, { id: 2, text: "The tide rises." }] });
  } finally {
    turnPolling.everyMs = realEvery;
  }
});

test("a page that returns to a running Turn picks it up, and finishes with its Messages", async () => {
  const realEvery = turnPolling.everyMs;
  turnPolling.everyMs = 20;
  try {
    start(slowly("The tide rises.", 120));
    const id = await app.createSave();
    const started = playTurn(id, "I wade forward.", 0, () => {}, new AbortController().signal);
    await Bun.sleep(40);

    const { running } = await getTurn(id);
    const result = await resumeTurn(id, running!, () => {});

    expect(result).toMatchObject({ messages: [{ id: 1 }, { id: 2, text: "The tide rises." }] });
    await started;
  } finally {
    turnPolling.everyMs = realEvery;
  }
});

test("coming back to the page reads a stream that has gone quiet from the Turn instead", async () => {
  const realEvery = turnPolling.everyMs;
  turnPolling.everyMs = 20;
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  (globalThis as { document?: unknown }).document = page;
  try {
    start(slowly("The tide rises.", 120));
    const id = await app.createSave();
    const playing = playTurn(id, "I wade forward.", 0, () => {}, new AbortController().signal);
    await Bun.sleep(40);

    page.dispatchEvent(new Event("visibilitychange"));

    const log = await logOf(async () => {
      expect(await playing).toMatchObject({ messages: [{ id: 1 }, { id: 2, text: "The tide rises." }] });
      await Bun.sleep(20);
    });
    expect(log).toMatch(/INFO page stream-lost .*"returned":1/);
    expect(log).toMatch(/VERBOSE page polling-fallback/);
    const asked = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([path]) => String(path));
    expect(asked.some((path) => path.endsWith("/turn"))).toBe(true);
  } finally {
    turnPolling.everyMs = realEvery;
    delete (globalThis as { document?: unknown }).document;
  }
});

test("a failure the stream delivered isn't told a second time", async () => {
  start(async () => {
    throw new ContentRefused();
  });
  const id = await app.createSave();

  await playTurn(id, "I wade forward.", 0, () => {}, new AbortController().signal);
  await Bun.sleep(20);

  expect(await getTurn(id)).toEqual({});
});

test("a Save deleted once its Turn has gone stops the page waiting", async () => {
  const realEvery = turnPolling.everyMs;
  turnPolling.everyMs = 1;
  try {
    start(reply("Unused."));
    const id = await app.createSave();
    await deleteSave(id);

    const result = await resumeTurn(id, { input: "I wade forward.", narration: "", after: 0 }, () => {});

    expect(result).toMatchObject({ input: "I wade forward." });
    expect((result as { error: string }).error).toContain("can't be reached");
  } finally {
    turnPolling.everyMs = realEvery;
  }
});
