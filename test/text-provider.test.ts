import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { delta, fakeOpenAi, logOf, scriptedDice, startApp, tempFolder, turnEvents } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
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
  app = startApp(savesDir, textProvider(settings), dice);
  return app;
}

const streamTurn = (id: string, input: string, signal?: AbortSignal) =>
  fetch(app.url(`/saves/${id}/turns`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ input }),
    signal,
  });

const storedMessages = async (id: string) =>
  ((await app.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { text: string }[] }).messages;

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await app?.stop();
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
  const id = await app.createSave();

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
  const id = await app.createSave();

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
  const id = await app.createSave();

  const response = await app.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(response.status).toBe(201);
  expect(((await response.json()) as { messages: unknown[] }).messages).toHaveLength(2);
});

const CHECK_REPLY = '{"check":{"action":"Leap the gap","difficulty":"Hard"},"narration":null,"state_operations":[]}';

test("a Check request shows no narration, and the result narration streams after the roll", async () => {
  play([[delta(CHECK_REPLY)], narrated("You land.")], undefined, scriptedDice(18));
  const id = await app.createSave();

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
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I leap the gap."));

  expect(events.map(({ event }) => event)).toEqual(["done"]);
  expect((await storedMessages(id)).at(-1)!.text).toBe("You land.");
});

test("a retry tells the client to discard the narration of the failed attempt", async () => {
  const refused = { op: "remove_item", item: "a key the PC does not have" };
  play([narrated("You unlock the door.", refused), narrated("The door stays shut.")]);
  const id = await app.createSave();

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
  const id = await app.createSave();

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
  const id = await app.createSave();

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
  const id = await app.createSave();

  const [first] = await turnEvents(await streamTurn(id, "Something refused."));

  expect(first).toMatchObject({ event: "error", data: { status: 422, failure: "refused", input: "Something refused." } });
  expect(await storedMessages(id)).toEqual([]);
});

test("a refusal after narration began ends in an error event, with no Turn stored", async () => {
  play([[delta('{"check":null,"narration":"You begin'), sse({ choices: [{ finish_reason: "content_filter" }] })]]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "Something refused."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "error"]);
  expect(await storedMessages(id)).toEqual([]);
});

test("a provider error mid-stream fails the Turn as retryable, and its detail stays on the server", async () => {
  const providerError = { code: "server_error", message: "PROVIDER-DETAIL" };
  play([[delta('{"check":null,"narration":"The ti'), errorChunk(providerError)]]);
  const id = await app.createSave();

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
  const id = await app.createSave();

  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  const { body, authorization } = provider.requests[0]!;
  expect(authorization).toBe("Bearer test-key");
  expect(body.model).toBe("fake/model");
  expect(body.stream).toBe(true);
  expect(body.provider).toEqual({ require_parameters: true });
  expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
});

test("the schema keeps to what strict schema modes accept, with check first", async () => {
  play([narrated("Rain.")], schemaModel);
  const id = await app.createSave();
  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  const { schema } = provider.requests[0]!.body.response_format.json_schema;

  expect(schema.type).toBe("object");
  expect(Object.keys(schema.properties)).toEqual(["check", "narration", "state_operations", "people", "summary", "scene_changed", "visual_description"]);
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
  const id = await app.createSave();

  const response = await app.post(`/saves/${id}/turns`, { input: "I wait." });

  expect(response.status).toBe(201);
  expect(provider.requests).toHaveLength(2);
  expect(provider.requests[0]!.body.response_format).toBeUndefined();
});

test("a model whose listing claims schema support but rejects the schema still plays, without schema mode", async () => {
  const rejected = () => Response.json({ error: { code: 400, message: "Invalid schema" } }, { status: 400 });
  play([rejected(), narrated("Rain."), narrated("Wind.")], schemaModel);
  const id = await app.createSave();

  const response = await app.post(`/saves/${id}/turns`, { input: "I wait." });
  await app.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(response.status).toBe(201);
  expect(provider.requests.map(({ body }) => !!body.response_format)).toEqual([true, false, false]);
});

test("an answer without a model list is not remembered, so schema mode is tried again", async () => {
  play([narrated("Rain."), narrated("Wind.")], {});
  const id = await app.createSave();
  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  provider.setModels(schemaModel);
  await app.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(provider.requests.map(({ body }) => !!body.response_format)).toEqual([false, true]);
});

test("earlier narration in the prompt shows the Narrator the key order a new reply needs", async () => {
  play([narrated("Rain."), narrated("Wind.")]);
  const id = await app.createSave();
  await app.post(`/saves/${id}/turns`, { input: "I wait." });
  await app.post(`/saves/${id}/turns`, { input: "I wait more." });

  const history = provider.requests[1]!.body.messages.find(({ role }: { role: string }) => role === "assistant");

  expect(history.content).toStartWith('{"check":null,"narration":"Rain."');
});

test("the prompt reaches the provider in order, so world_rules and the Check result stay late", async () => {
  play([[delta(CHECK_REPLY)], narrated("You land.")], undefined, scriptedDice(18));
  const id = await app.createSave();

  await app.post(`/saves/${id}/turns`, { input: "I leap." });

  const messages: { role: string; content: string }[] = provider.requests[1]!.body.messages;
  expect(messages.map(({ role }) => role)).toEqual(["system", "system", "user", "system"]);
  expect(messages[1]!.content).toStartWith("world_rules:");
  expect(messages[2]!.content).toContain("I leap.");
  expect(messages[3]!.content).toStartWith("The Check is resolved");
});

test("the model and Model Instructions can change between Turns of a Save", async () => {
  play([narrated("Rain."), narrated("Wind.")]);
  const id = await app.createSave();
  await app.post(`/saves/${id}/turns`, { input: "I wait." });

  await app.patch("/settings", { textModel: "fake/other", modelInstructions: "Write in present tense." });
  await app.post(`/saves/${id}/turns`, { input: "I wait more." });

  expect(provider.requests.map(({ body }) => body.model)).toEqual(["fake/model", "fake/other"]);
  expect(provider.requests[1]!.body.messages[0].content).toContain("Write in present tense.");
});

test("Settings survive a restart, and the API key never reaches a response, a Save or the log", async () => {
  play([httpError({ message: "Bad key test-key" }, 401)()]);
  const id = await app.createSave();
  let failed = "";
  const log = await logOf(async () => {
    failed = await app.post(`/saves/${id}/turns`, { input: "I wait." }).then((r) => r.text());
  });
  await app.restart();

  const settings = await app.get("/settings").then((r) => r.text());

  expect(JSON.parse(settings)).toMatchObject({
    textBaseUrl: provider.baseUrl,
    textModel: "fake/model",
    hasTextApiKey: true,
    modelInstructions: "",
  });
  expect(provider.requests[0]!.authorization).toBe("Bearer test-key");
  expect(log).toContain("Bad key [key]");
  const save = await Bun.file(join(folder.path, "Saves", `${id}.sqlite`)).text();
  for (const place of [failed, settings, log, save]) expect(place).not.toContain("test-key");
});

test("changing the base URL drops a stored key unless a new one comes with it", async () => {
  play([]);
  const change = (body: unknown) => app.patch("/settings", body).then((r) => r.json());

  expect(await change({ textBaseUrl: "http://localhost:1234/v1" })).toMatchObject({ hasTextApiKey: false });
  expect(await change({ textBaseUrl: "http://localhost:1235/v1", textApiKey: "new" })).toMatchObject({
    hasTextApiKey: true,
  });
  expect(await change({ textModel: "local" })).toMatchObject({ hasTextApiKey: true });
  expect((await app.patch("/settings", { textBaseUrl: "file:///etc/passwd" })).status).toBe(400);
});

test("a client that leaves mid-stream doesn't stop the Turn, which is saved", async () => {
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The tide ');
      yield delta("rises");
      await Bun.sleep(150);
      yield delta('"}');
      yield "data: [DONE]\n\n";
    },
  ]);
  const id = await app.createSave();
  const client = new AbortController();

  const response = await streamTurn(id, "I wade forward.", client.signal);
  await response.body!.getReader().read();
  client.abort();

  await Bun.sleep(300);
  expect((await storedMessages(id)).map(({ text }) => text)).toEqual(["I wade forward.", "The tide rises"]);
});

test("a streamed Turn survives a silence longer than Bun's default idle timeout", async () => {
  play([
    async function* () {
      await Bun.sleep(14_000);
      yield* narrated("The tide rises.");
    },
  ]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)!.event).toBe("done");
}, 20_000);

const textTest = (prompt: string) => app.post("/settings/text-test", { prompt });
const body = (response: Response) => response.json() as Promise<Record<string, any>>;

test("with no Model Instructions the Settings text test sends just the prompt, and returns the reply with how it went", async () => {
  play([[delta("Hello "), delta("there."), "data: [DONE]\n\n"]], schemaModel);

  const response = await textTest("Say hello");

  expect(response.status).toBe(200);
  const { seconds, firstSeconds, ...rest } = await body(response);
  expect(rest).toEqual({ reply: "Hello there.", tokens: 3, model: "fake/model" });
  expect(firstSeconds).toBeGreaterThanOrEqual(0);
  expect(seconds).toBeGreaterThanOrEqual(firstSeconds);
  const sent = provider.requests[0]!.body;
  expect(sent.messages).toEqual([{ role: "user", content: "Say hello" }]);
  expect(sent.response_format).toBeUndefined();
  expect(sent.provider).toBeUndefined();
});

test("the Settings text test sends the Model Instructions as the system prompt", async () => {
  play([[delta("Aye."), "data: [DONE]\n\n"]]);
  await app.patch("/settings", { modelInstructions: "Answer like a sailor." });

  await textTest("Say hello");

  expect(provider.requests[0]!.body.messages).toEqual([
    { role: "system", content: "Answer like a sailor." },
    { role: "user", content: "Say hello" },
  ]);
});

test("the Settings text test refuses an empty prompt without calling the model", async () => {
  play([]);

  expect((await textTest("   ")).status).toBe(400);
  expect(provider.requests).toHaveLength(0);
});

test("the Settings text test says when the model refused", async () => {
  play([[`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "content_filter" }] })}\n\n`]]);

  const response = await textTest("Say hello");

  expect(response.status).toBe(422);
  expect((await body(response)).error).toBe("The model refused this prompt.");
});

test("the Settings text test says when the server can't be reached", async () => {
  play([]);
  provider.stop();

  const response = await textTest("Say hello");

  expect(response.status).toBe(502);
  expect((await body(response)).error).toContain("can't be reached");
});

const broken = ['data: {"choices":[{"delta":{"content":"The ti\n\n'];

test("a broken line in the stream retries the Turn, and the log shows why", async () => {
  play([broken, narrated("The tide rises.")]);
  const id = await app.createSave();

  const log = await logOf(async () => {
    const events = await turnEvents(await streamTurn(id, "I wade forward."));
    expect(events.at(-1)!.event).toBe("done");
  });

  expect(provider.requests).toHaveLength(2);
  expect((await storedMessages(id)).at(-1)!.text).toBe("The tide rises.");
  expect(log).toContain('"attempt":1,"of":3');
  expect(log).toContain('"last":{"chars":');
  expect(log).not.toContain("The ti");
});

test("a stream that stays broken fails the Turn as retryable once the retries run out", async () => {
  play([broken, broken, broken]);
  const id = await app.createSave();

  await logOf(async () => {
    const events = await turnEvents(await streamTurn(id, "I wade forward."));
    expect(events.at(-1)).toEqual({
      event: "error",
      data: { status: 502, error: "The Narrator gave no usable response", failure: "retryable", input: "I wade forward." },
    });
  });

  expect(provider.requests).toHaveLength(3);
  expect(await storedMessages(id)).toEqual([]);
});

test("the log shows how each reply went, and none of the story", async () => {
  const finished = sse({
    id: "gen-1",
    provider: "FakeHost",
    choices: [{ delta: { content: "" }, finish_reason: "stop", native_finish_reason: "STOP" }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  });
  const reply = { check: null, narration: "The tide rises.", state_operations: [], people: [{ name: "Ada", appearance: "tall" }], summary: "A wet day." };
  play([[delta(JSON.stringify(reply)), finished, "data: [DONE]\n\n"]]);
  const id = await app.createSave();

  const log = await logOf(() => streamTurn(id, "I wade forward.").then(turnEvents));

  for (const fact of ['"generation":"gen-1"', '"provider":"FakeHost"', '"finish":"stop"', '"nativeFinish":"STOP"', '"completion_tokens":7']) {
    expect(log).toContain(fact);
  }
  expect(log).toContain('"people":1');
  expect(log).toContain('"summary":10');
  expect(log).toContain('"attempts":1');
  for (const story of ["The tide rises", "A wet day", "I wade forward", "Ada"]) expect(log).not.toContain(story);
});

test("a client that leaves is logged as that, not as a failed Turn", async () => {
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The tide ');
      await Bun.sleep(100);
      yield delta('"}');
    },
  ]);
  const id = await app.createSave();
  const client = new AbortController();

  const log = await logOf(async () => {
    const response = await streamTurn(id, "I wade forward.", client.signal);
    await response.body!.getReader().read();
    client.abort();
    await Bun.sleep(300);
  });

  expect(log).toContain("A Turn lost its client");
  expect(log).toContain("A Turn ended after its client left");
  expect(log.indexOf("lost its client")).toBeLessThan(log.indexOf("ended after its client left"));
  expect(log).not.toContain("A Turn failed");
  expect(log).not.toContain("I wade forward");
});

const liveTurn = (id: string) => app.get(`/saves/${id}/turn`).then((r) => r.json());

test("a running Turn can be read back with its text so far, and is gone once saved", async () => {
  const { promise: release, resolve: finish } = Promise.withResolvers<void>();
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The tide ');
      yield delta("rises");
      await release;
      yield delta('"}');
    },
  ]);
  const id = await app.createSave();
  const client = new AbortController();
  const response = await streamTurn(id, "I wade forward.", client.signal);
  await response.body!.getReader().read();
  client.abort();
  await Bun.sleep(50);

  expect(await liveTurn(id)).toEqual({ running: { input: "I wade forward.", narration: "The tide rises", after: 0 } });

  finish();
  await Bun.sleep(100);
  expect(await liveTurn(id)).toEqual({});
});

test("a replacement that is running names the Message it replaces", async () => {
  const { promise: release, resolve: finish } = Promise.withResolvers<void>();
  play([
    narrated("The tide rises."),
    async function* () {
      await release;
      yield* narrated("The tide falls.");
    },
  ]);
  const id = await app.createSave();
  await streamTurn(id, "I wade forward.").then(turnEvents);

  const replacing = app.post(`/saves/${id}/messages/2/regenerate`, {});
  await Bun.sleep(50);

  expect(await liveTurn(id)).toEqual({ running: { input: "", narration: "", after: 2, replaces: 2 } });
  finish();
  await replacing;
});

test("a Turn that fails with nobody there waits, once, for the player's return", async () => {
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The ti');
      await Bun.sleep(50);
      throw new Error("The stream broke");
    },
  ]);
  const id = await app.createSave();
  const client = new AbortController();

  await logOf(async () => {
    const response = await streamTurn(id, "I wade forward.", client.signal);
    await response.body!.getReader().read();
    client.abort();
    await Bun.sleep(150);
  });

  expect(await liveTurn(id)).toMatchObject({ failed: { status: 502, input: "I wade forward.", error: expect.any(String) } });
  expect(await liveTurn(id)).toEqual({});
  expect(await storedMessages(id)).toEqual([]);
});

test("a second Turn while one runs is refused, and never reaches the model", async () => {
  const { promise: release, resolve: finish } = Promise.withResolvers<void>();
  play([
    async function* () {
      await release;
      yield* narrated("The tide rises.");
    },
    narrated("Never asked for."),
  ]);
  const id = await app.createSave();
  const first = streamTurn(id, "I wade forward.").then(turnEvents);
  await Bun.sleep(50);

  const second = await app.post(`/saves/${id}/turns`, { input: "I run." });

  expect(second.status).toBe(409);
  expect(provider.requests).toHaveLength(1);
  finish();
  expect((await first).at(-1)!.event).toBe("done");
});

test("a second Turn is allowed once the first has finished", async () => {
  play([narrated("One."), narrated("Two.")]);
  const id = await app.createSave();

  await streamTurn(id, "First.").then(turnEvents);
  const events = await streamTurn(id, "Second.").then(turnEvents);

  expect(events.at(-1)!.event).toBe("done");
});

test("a client that cancels its stream doesn't fail the Turn, which is saved", async () => {
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The tide ');
      await Bun.sleep(100);
      yield delta("rises");
      await Bun.sleep(100);
      yield delta('"}');
    },
  ]);
  const id = await app.createSave();

  const log = await logOf(async () => {
    const reader = (await streamTurn(id, "I wade forward.")).body!.getReader();
    await reader.read();
    await reader.cancel();
    await Bun.sleep(400);
  });

  expect((await storedMessages(id)).at(-1)?.text).toBe("The tide rises");
  expect(log).not.toContain("A Turn failed");
});

test("an Opening that fails with nobody there hands back no input", async () => {
  play([
    async function* () {
      yield delta('{"check":null,"narration":"The ti');
      await Bun.sleep(50);
      throw new Error("The stream broke");
    },
  ]);
  const id = await app.createSave();
  const client = new AbortController();

  await logOf(async () => {
    const response = await fetch(app.url(`/saves/${id}/opening`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: "{}",
      signal: client.signal,
    });
    await response.body!.getReader().read();
    client.abort();
    await Bun.sleep(150);
  });

  expect(await liveTurn(id)).toMatchObject({ failed: { input: "" } });
});

test("a reply that isn't JSON leaves none of its words in the log", async () => {
  const prose = [delta("Marcus waits by the door."), "data: [DONE]\n\n"];
  play([prose, prose, prose]);
  const id = await app.createSave();

  const log = await logOf(() => streamTurn(id, "I wade forward.").then(turnEvents));

  expect(log).toContain('"attempt":3,"of":3');
  expect(log).not.toContain("Marcus");
});

test("a provider's error is cut short in the log, as it may echo the story", async () => {
  play([httpError({ message: "x".repeat(1000) }, 500)()]);
  const id = await app.createSave();

  const log = await logOf(() => streamTurn(id, "I wade forward.").then(turnEvents));

  expect(log).toContain("x".repeat(100));
  expect(log).not.toContain("x".repeat(400));
});

test("a provider's error that repeats the prompt is held back from the log", async () => {
  play([httpError({ message: "You sent: ZQX-the-words-of-the-player" }, 500)()]);
  const id = await app.createSave();

  const log = await logOf(() => streamTurn(id, "ZQX-the-words-of-the-player").then(turnEvents));

  expect(log).toContain("it repeats the prompt");
  expect(log).not.toContain("ZQX");
});
