import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { delta, fakeOpenAi, scriptedDice, startGame, tempFolder, turnEvents } from "./support";

let folder: ReturnType<typeof tempFolder>;
let game: ReturnType<typeof startGame>;
let provider: ReturnType<typeof fakeOpenAi>;

const narrated = (text: string, ...state_operations: unknown[]) => [
  delta(JSON.stringify({ check: null, narration: text, state_operations })),
  "data: [DONE]\n\n",
];

/** The real client against a fake server. */
function play(replies: Parameters<typeof fakeOpenAi>[0], models?: unknown, dice = scriptedDice()) {
  provider = fakeOpenAi(replies, models);
  const savesDir = join(folder.path, "Saves");
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ textBaseUrl: provider.baseUrl, textApiKey: "test-key", textModel: "fake/model" });
  game = startGame(savesDir, textProvider(settings), dice);
  return game;
}

const streamTurn = (id: string, input: string, signal?: AbortSignal) =>
  fetch(game.url(`/saves/${id}/turns`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ input }),
    signal,
  });

const storedMessages = async (id: string) =>
  ((await game.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { text: string }[] }).messages;

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await game?.stop();
  provider?.stop();
  folder.remove();
});

test("a spoken line streams intact, even when a chunk ends inside its line break", async () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const text = "[Ashley]: \“Hey [sic].\”\n\nShe looks up.";
  const reply = JSON.stringify({ check: null, narration: text, state_operations: [] });
  const cut = reply.indexOf("\\n") + 1;
  play([
    async function* () {
      yield delta(reply.slice(0, cut));
      await released;
      yield delta(reply.slice(cut));
      yield "data: [DONE]\n\n";
    },
  ]);
  const id = await game.createSave();

  const response = await streamTurn(id, "I wave.");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const { value: first } = await reader.read();
  expect(first).toContain('"[Ashley]: \“Hey [sic].\”"');
  release();
  let rest = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) rest += part.value;

  expect(rest).toContain(String.raw`"\n\nShe looks up."`);
  expect((await storedMessages(id)).at(-1)!.text).toBe(text);
});

test("narration reaches the client as it is written, and nothing is stored until the Turn is valid", async () => {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The tide ');
      await released;
      yield delta('rises."}');
      yield "data: [DONE]\n\n";
    },
  ]);
  const id = await game.createSave();

  const response = await streamTurn(id, "I wade forward.");
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const { value: first } = await reader.read();

  expect(first).toBe('event: narration\ndata: {"text":"The tide "}\n\n');
  expect(await storedMessages(id)).toEqual([]);

  release();
  let rest = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) rest += part.value;
  expect(rest).toContain('event: narration\ndata: {"text":"rises."}\n\n');
  expect(rest).toContain(
    `event: done\ndata: ${JSON.stringify({
      messages: [
        { id: 1, role: "player", text: "I wade forward." },
        { id: 2, role: "narrator", text: "The tide rises." },
      ],
    })}\n\n`,
  );
  expect(await storedMessages(id)).toHaveLength(2);
});

test("without the streaming Accept header a Turn still answers with plain JSON", async () => {
  play([narrated("Rain.")]);
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(response.status).toBe(201);
  expect(((await response.json()) as { messages: unknown[] }).messages).toHaveLength(2);
});

const CHECK_REPLY = '{"check":{"action":"Leap the gap","difficulty":"Hard"},"narration":null,"state_operations":[]}';

test("a Check request shows no narration, and the result narration streams after the roll", async () => {
  play([[delta(CHECK_REPLY)], narrated("You land.")], undefined, scriptedDice(18));
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I leap the gap."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "done"]);
  expect(events[0]!.data).toEqual({ text: "You land." });
  expect(JSON.stringify(provider.requests[1]!.body.messages.at(-1))).toContain("The Check is resolved");
});

test("narration written before the reply shows it is not a Check request is never shown early", async () => {
  play(
    [
      [delta('{"narration":"You start to leap","check":{"action":"Leap the gap","difficulty":"Hard"}}')],
      [delta('{"narration":"You land."}')],
    ],
    undefined,
    scriptedDice(18),
  );
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I leap the gap."));

  expect(events.map(({ event }) => event)).toEqual(["done"]);
  expect((await storedMessages(id)).at(-1)!.text).toBe("You land.");
});

test("a retry tells the client to discard the narration of the failed attempt", async () => {
  const refused = { op: "remove_item", item: "a key the PC does not have" };
  play([narrated("You unlock the door.", refused), narrated("The door stays shut.")]);
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I unlock the door."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "restart", "narration", "done"]);
  expect(events[2]!.data).toEqual({ text: "The door stays shut." });
  expect((await storedMessages(id)).map(({ text }) => text)).toEqual(["I unlock the door.", "The door stays shut."]);
});

test("a reply that turns into a Check request after narration began restarts the client", async () => {
  play(
    [
      [delta('{"check":null,"narration":"You leap","check":{"action":"Leap","difficulty":"Easy"}}')],
      narrated("You land."),
    ],
    undefined,
    scriptedDice(18),
  );
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I leap."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "restart", "narration", "done"]);
});

test("escapes and multi-byte characters split across network reads reach the client intact", async () => {
  const text = 'She said "café\n\u{1F30A}" \\ end';
  const reply = JSON.stringify({ check: null, narration: text, state_operations: [] });
  const bytes = new TextEncoder().encode(delta(reply).replaceAll("\n\n", "\r\n\r\n"));
  play([
    async function* () {
      yield ": OPENROUTER PROCESSING\n\n";
      for (let i = 0; i < bytes.length; i += 3) {
        yield bytes.slice(i, i + 3) as unknown as string;
        await Bun.sleep(0);
      }
      yield "data: [DONE]\n\n";
    },
  ]);
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I listen."));

  expect(events.at(-1)!.event).toBe("done");
  const shown = events.filter(({ event }) => event === "narration").map(({ data }) => data.text);
  expect(shown.join("")).toBe(text);
});

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const errorChunk = (error: unknown) => sse({ error, choices: [{ delta: { content: "" }, finish_reason: "error" }] });
const httpError = (error: unknown, status: number) => () => Response.json({ error }, { status });

const refusals: [string, () => Parameters<typeof fakeOpenAi>[0][number]][] = [
  ["a refusal delta", () => [sse({ choices: [{ delta: { refusal: "I cannot" } }] })]],
  ["a content_filter finish", () => [sse({ choices: [{ delta: {}, finish_reason: "content_filter" }] })]],
  ["a refusal error mid-stream", () => [errorChunk({ code: 403, metadata: { error_type: "refusal" } })]],
  [
    "a content policy error before the stream",
    httpError({ code: 403, metadata: { error_type: "content_policy_violation" } }, 403),
  ],
  ["a moderation error", httpError({ code: 403, metadata: { reasons: ["violence"] } }, 403)],
];

test.each(refusals)("%s is reported as refused and commits nothing", async (_, refusal) => {
  play([refusal()]);
  const id = await game.createSave();

  const [first] = await turnEvents(await streamTurn(id, "Something refused."));

  expect(first).toMatchObject({ event: "error", data: { status: 422, failure: "refused", input: "Something refused." } });
  expect(await storedMessages(id)).toEqual([]);
});

test("a refusal after narration began ends in an error event, with no Turn stored", async () => {
  play([[delta('{"check":null,"narration":"You begin'), sse({ choices: [{ finish_reason: "content_filter" }] })]]);
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "Something refused."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "error"]);
  expect(await storedMessages(id)).toEqual([]);
});

test("a provider error mid-stream fails the Turn as retryable, and its detail stays on the server", async () => {
  const providerError = { code: "server_error", message: "PROVIDER-DETAIL" };
  play([[delta('{"check":null,"narration":"The ti'), errorChunk(providerError)]]);
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)).toEqual({
    event: "error",
    data: { status: 502, error: expect.stringContaining("returned an error"), failure: "retryable", input: "I wade forward." },
  });
  expect(await storedMessages(id)).toEqual([]);
});

const schemaModel = { data: [{ id: "fake/model", supported_parameters: ["structured_outputs", "response_format"] }] };

test("schema mode is used on a model that supports it", async () => {
  play([narrated("Rain.")], schemaModel);
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const { body, authorization } = provider.requests[0]!;
  expect(authorization).toBe("Bearer test-key");
  expect(body.model).toBe("fake/model");
  expect(body.stream).toBe(true);
  expect(body.provider).toEqual({ require_parameters: true });
  expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
});

test("the schema keeps to what strict schema modes accept, with check first", async () => {
  play([narrated("Rain.")], schemaModel);
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  const { schema } = provider.requests[0]!.body.response_format.json_schema;

  expect(schema.type).toBe("object");
  expect(Object.keys(schema.properties)).toEqual(["check", "narration", "state_operations", "scene_changed", "visual_description"]);
  const visit = (node: any) => {
    if (typeof node !== "object" || node === null) return;
    for (const refused of ["oneOf", "minLength", "$schema"]) expect(Object.keys(node)).not.toContain(refused);
    if (node.type === "object") {
      expect(node.additionalProperties).toBe(false);
      expect(node.required.toSorted()).toEqual(Object.keys(node.properties).toSorted());
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
});

test.each([
  ["does not list structured outputs", { data: [{ id: "fake/model", supported_parameters: ["temperature"] }] }],
  ["is unknown to the server", { data: [] }],
  ["cannot be looked up", null],
])("a model that %s falls back to JSON validation and retries", async (_, models) => {
  play([[delta("not json")], narrated("Rain.")], models);
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(response.status).toBe(201);
  expect(provider.requests).toHaveLength(2);
  expect(provider.requests[0]!.body.response_format).toBeUndefined();
});

test("a model whose listing claims schema support but rejects the schema still plays, without schema mode", async () => {
  const rejected = () => Response.json({ error: { code: 400, message: "Invalid schema" } }, { status: 400 });
  play([rejected(), narrated("Rain."), narrated("Wind.")], schemaModel);
  const id = await game.createSave();

  const response = await game.post(`/saves/${id}/turns`, { input: "I wait." });
  await game.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(response.status).toBe(201);
  expect(provider.requests.map(({ body }) => !!body.response_format)).toEqual([true, false, false]);
});

test("an answer without a model list is not remembered, so schema mode is tried again", async () => {
  play([narrated("Rain."), narrated("Wind.")], {});
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  provider.setModels(schemaModel);
  await game.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(provider.requests.map(({ body }) => !!body.response_format)).toEqual([false, true]);
});

test("earlier narration in the prompt shows the Narrator the key order a new reply needs", async () => {
  play([narrated("Rain."), narrated("Wind.")]);
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });
  await game.post(`/saves/${id}/turns`, { input: "I wait more." });

  const history = provider.requests[1]!.body.messages.find(({ role }: { role: string }) => role === "assistant");

  expect(history.content).toStartWith('{"check":null,"narration":"Rain."');
});

test("the prompt reaches the provider in order, so world_rules and the Check result stay late", async () => {
  play([[delta(CHECK_REPLY)], narrated("You land.")], undefined, scriptedDice(18));
  const id = await game.createSave();

  await game.post(`/saves/${id}/turns`, { input: "I leap." });

  const messages: { role: string; content: string }[] = provider.requests[1]!.body.messages;
  expect(messages.map(({ role }) => role)).toEqual(["system", "system", "user", "system"]);
  expect(messages[1]!.content).toStartWith("world_rules:");
  expect(messages[2]!.content).toContain("I leap.");
  expect(messages[3]!.content).toStartWith("The Check is resolved");
});

test("the model and Model Instructions can change between Turns of a Save", async () => {
  play([narrated("Rain."), narrated("Wind.")]);
  const id = await game.createSave();
  await game.post(`/saves/${id}/turns`, { input: "I wait." });

  await game.patch("/settings", { textModel: "fake/other", modelInstructions: "Write in present tense." });
  await game.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(provider.requests.map(({ body }) => body.model)).toEqual(["fake/model", "fake/other"]);
  expect(provider.requests[1]!.body.messages[0].content).toContain("Write in present tense.");
});

test("Settings survive a restart, and the API key never reaches a response, a Save or the log", async () => {
  const realError = console.error;
  const logged: unknown[] = [];
  console.error = (...args) => void logged.push(...args);
  try {
    play([httpError({ message: "Bad key test-key" }, 401)()]);
    const id = await game.createSave();
    const failed = await game.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
    await game.restart();

    const settings = await game.get("/settings").then((r) => r.text());

    expect(JSON.parse(settings)).toMatchObject({
      textBaseUrl: provider.baseUrl,
      textModel: "fake/model",
      hasTextApiKey: true,
      modelInstructions: "",
    });
    expect(provider.requests[0]!.authorization).toBe("Bearer test-key");
    const log = logged.map((entry) => Bun.inspect(entry)).join("\n");
    expect(log).toContain("Bad key [key]");
    const save = await Bun.file(join(folder.path, "Saves", `${id}.sqlite`)).text();
    for (const place of [failed, settings, log, save]) expect(place).not.toContain("test-key");
  } finally {
    console.error = realError;
  }
});

test("changing the base URL drops a stored key unless a new one comes with it", async () => {
  play([]);
  const change = (body: unknown) => game.patch("/settings", body).then((r) => r.json());

  expect(await change({ textBaseUrl: "http://localhost:1234/v1" })).toMatchObject({ hasTextApiKey: false });
  expect(await change({ textBaseUrl: "http://localhost:1235/v1", textApiKey: "new" })).toMatchObject({
    hasTextApiKey: true,
  });
  expect(await change({ textModel: "local" })).toMatchObject({ hasTextApiKey: true });
  expect((await game.patch("/settings", { textBaseUrl: "file:///etc/passwd" })).status).toBe(400);
});

test("a client that leaves mid-stream stops the Turn, and nothing is committed", async () => {
  const { promise: stopped, resolve: stop } = Promise.withResolvers<void>();
  play([
    async function* () {
      try {
        yield delta('{"check":null,"narration":"The tide ');
        yield delta("rises");
        await Bun.sleep(300);
        yield delta('"}');
      } finally {
        stop();
      }
    },
  ]);
  const id = await game.createSave();
  const client = new AbortController();

  const response = await streamTurn(id, "I wade forward.", client.signal);
  await response.body!.getReader().read();
  client.abort();

  await Promise.race([stopped, Bun.sleep(1000)]);
  await Bun.sleep(100);
  expect(await storedMessages(id)).toEqual([]);
});

test("a streamed Turn survives a silence longer than Bun's default idle timeout", async () => {
  play([
    async function* () {
      await Bun.sleep(14_000);
      yield* narrated("The tide rises.");
    },
  ]);
  const id = await game.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)!.event).toBe("done");
}, 20_000);
