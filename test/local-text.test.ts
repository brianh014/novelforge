import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { openRouterImages } from "../src/image-adapter";
import { settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { delta, fakeOpenAi, PNG, scriptedDice, startApp, tempFolder, turnEvents } from "./support";

const MODEL = "qwen-local";
const FINISHED = '{"check":null,"narration":"The tide rises.","state_operations":[]}';

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
let provider: ReturnType<typeof fakeOpenAi>;
let settings: ReturnType<typeof settingsStore>;
const others: { stop: (force: boolean) => unknown }[] = [];

/** The real client against a local server: no key, and a listing without `supported_parameters`. */
function playLocal(
  replies: Parameters<typeof fakeOpenAi>[0],
  { models = { data: [{ id: MODEL }] } as unknown, dice = scriptedDice(), limits = undefined as Parameters<typeof textProvider>[1] } = {},
) {
  provider = fakeOpenAi(replies, models);
  return startAt(provider.baseUrl, dice, limits);
}

function startAt(baseUrl: string, dice = scriptedDice(), limits?: Parameters<typeof textProvider>[1]) {
  settings.update({ textBaseUrl: baseUrl, textModel: MODEL });
  app = startApp(join(folder.path, "Saves"), textProvider(settings, limits), dice);
}

const streamTurn = (id: string, input: string) =>
  fetch(app.url(`/saves/${id}/turns`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ input }),
  });

const storedMessages = async (id: string) =>
  ((await app.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { text: string }[] }).messages;

/** A server that takes every request and never answers it. */
function silentServer() {
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Promise<Response>(() => {}) });
  others.push(server);
  return new URL("/v1", server.url).href;
}

/** An address nothing is listening on. */
async function closedAddress() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const address = new URL("/v1", server.url).href;
  await server.stop(true);
  return address;
}

beforeEach(() => {
  folder = tempFolder();
  settings = settingsStore(join(folder.path, "settings.json"));
});

afterEach(async () => {
  await app?.stop();
  provider?.stop();
  await Promise.all(others.splice(0).map((other) => other.stop(true)));
  folder.remove();
});

test("a server with no key and no schema mode plays a Turn on plain JSON", async () => {
  playLocal([[delta(FINISHED), "data: [DONE]\n\n"]]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)!.event).toBe("done");
  expect(provider.requests[0]!.authorization).toBeNull();
  expect(provider.requests[0]!.body.response_format).toBeUndefined();
  // Without schema mode the prompt is all that tells the model the shape.
  expect(JSON.stringify(provider.requests[0]!.body.messages)).toContain("state_operations");
});

test.each([
  ["in a code fence", `\`\`\`json\n${FINISHED}\n\`\`\``],
  ["in an unlabelled code fence", `\`\`\`\n${FINISHED}\n\`\`\`\n`],
  ["with prose around it", `Here is the reply:\n${FINISHED}\nLet me know what happens next.`],
  ["after a thinking block with braces in it", `<think>Maybe {"a":1}? Yes.</think>\n\n${FINISHED}`],
  ["after thinking whose opening tag came from the chat template", `Maybe {"a":1}? Yes.</think>

${FINISHED}`],
  ["without the optional keys", '{"narration":"The tide rises."}'],
  ["in another key order", '{"state_operations":[],"narration":"The tide rises.","check":null}'],
])("a reply %s is accepted", async (_, reply) => {
  playLocal([[delta(reply)]]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)!.event).toBe("done");
  expect((await storedMessages(id)).at(-1)!.text).toBe("The tide rises.");
});

test.each([
  ["no space after data:, CRLF lines and no [DONE]", `data:${delta(FINISHED).slice(6).replace("\n\n", "\r\n\r\n")}`],
  ["a last event with no newline", delta(FINISHED).trimEnd()],
])("a stream with %s still plays", async (_, stream) => {
  playLocal([[stream]]);
  const id = await app.createSave();

  expect((await turnEvents(await streamTurn(id, "I wade forward."))).at(-1)!.event).toBe("done");
});

test("a server that ignores `stream` and answers one JSON body still plays", async () => {
  playLocal([Response.json({ choices: [{ message: { content: FINISHED }, finish_reason: "stop" }] })]);
  const id = await app.createSave();

  expect((await turnEvents(await streamTurn(id, "I wade forward."))).at(-1)!.event).toBe("done");
});

test("a fenced reply streams its narration as it is written", async () => {
  playLocal([[delta("```json\n"), delta('{"check":null,"narration":"The tide '), delta('rises."}\n```')]]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.filter(({ event }) => event === "narration").map(({ data }) => data.text)).toEqual(["The tide ", "rises."]);
});

test("a reply in another key order shows no narration until done, as it could still be a Check", async () => {
  playLocal([[delta('{"narration":"You land"'), delta(',"check":{"action":"Leap","difficulty":"Hard"}}')], [delta(FINISHED)]], {
    dice: scriptedDice(18),
  });
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I leap the gap."));

  expect(events.map(({ event }) => event)).toEqual(["narration", "done"]);
  expect(events[0]!.data).toEqual({ text: "The tide rises." });
});

test("a Check request wrapped in a fence is still rolled", async () => {
  const fenced = '```json\n{"check":{"action":"Leap","difficulty":"Hard"},"narration":null}\n```';
  playLocal([[delta(fenced)], [delta(FINISHED)]], { dice: scriptedDice(18) });
  const id = await app.createSave();

  await turnEvents(await streamTurn(id, "I leap the gap."));

  expect(JSON.stringify(provider.requests[1]!.body.messages.at(-1))).toContain("The Check is resolved");
});

test("a reply cut off mid-thought is never taken for a finished Turn", async () => {
  playLocal([[delta(`<think>Perhaps ${FINISHED}`)], [delta(`{"check":null,"narration":"The rain stops."}`)]]);
  const id = await app.createSave();

  await turnEvents(await streamTurn(id, "I wade forward."));

  expect((await storedMessages(id)).at(-1)!.text).toBe("The rain stops.");
});

test("wizard calls accept wrapped JSON too", async () => {
  playLocal([[delta('Sure!\n```json\n{"worldBrief":"A city of canals"}\n```')]]);

  const response = await app.post("/worlds/pick", { theme: "Steampunk", title: "Canals", worldBrief: "" });

  expect(await response.json()).toEqual({ worldBrief: "A city of canals" });
});

test("a listing with unusual fields doesn't stop a Turn", async () => {
  playLocal([[delta(FINISHED)]], { models: { data: [{ id: MODEL, supported_parameters: { temperature: {} } }] } });
  const id = await app.createSave();

  expect((await turnEvents(await streamTurn(id, "I wade forward."))).at(-1)!.event).toBe("done");
});

const UNREACHABLE = /can't be reached.*address in Settings/;
const STOPPED = /stopped responding.*loading a model/;

test("a refused connection fails a Turn as retryable, keeps the player's text and commits nothing", async () => {
  startAt(await closedAddress());
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)).toEqual({
    event: "error",
    data: { status: 502, error: expect.stringMatching(UNREACHABLE), failure: "retryable", input: "I wade forward." },
  });
  expect(await storedMessages(id)).toEqual([]);
});

test("a refused connection gives a wizard call the same message, and it works once the server is up", async () => {
  startAt(await closedAddress());
  const pick = () => app.post("/worlds/pick", { theme: "Steampunk", title: "Canals", worldBrief: "" });

  const failed = await pick();

  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: expect.stringMatching(UNREACHABLE), failure: "retryable", input: "" });

  provider = fakeOpenAi([[delta('{"worldBrief":"A city of canals"}')]]);
  settings.update({ textBaseUrl: provider.baseUrl });
  expect((await pick()).status).toBe(200);
});

test("a server that never answers is reported as stopped, not unreachable", async () => {
  startAt(silentServer(), undefined, { silenceMs: 100, listMs: 50 });
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)).toMatchObject({ event: "error", data: { error: expect.stringMatching(STOPPED), input: "I wade forward." } });
});

test("a stream that stalls is reported as stopped", async () => {
  playLocal(
    [
      async function* () {
        yield delta('{"check":null,"narration":"The tide ');
        await new Promise(() => {});
      },
    ],
    { limits: { silenceMs: 100, listMs: 50 } },
  );
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)).toMatchObject({ event: "error", data: { error: expect.stringMatching(STOPPED) } });
});

test("a slow first response and gaps between chunks are fine, however long the reply takes overall", async () => {
  playLocal(
    [
      async function* () {
        await Bun.sleep(300);
        yield delta('{"check":null,"narration":"The ');
        await Bun.sleep(300);
        yield delta('tide ');
        await Bun.sleep(300);
        yield delta('rises."}');
      },
    ],
    { limits: { silenceMs: 500, listMs: 50 } },
  );
  const id = await app.createSave();

  expect((await turnEvents(await streamTurn(id, "I wade forward."))).at(-1)!.event).toBe("done");
});

test("a server's error names what to check, and its detail stays on the server", async () => {
  playLocal([Response.json({ error: { message: "PROVIDER-DETAIL: model not found" } }, { status: 404 })]);
  const id = await app.createSave();

  const events = await turnEvents(await streamTurn(id, "I wade forward."));

  expect(events.at(-1)).toMatchObject({ event: "error", data: { status: 502, error: expect.stringContaining("text model") } });
  expect(JSON.stringify(events)).not.toContain("PROVIDER-DETAIL");
});

test("Settings can list the saved server's models", async () => {
  playLocal([], { models: { data: [{ id: "qwen-local" }, { id: "llama-local" }] } });

  expect(await app.get("/settings/text-models").then((r) => r.json())).toEqual({ models: ["qwen-local", "llama-local"] });
});

test.each([
  ["has no list", 0],
  ["sends a different shape", { models: ["qwen-local"] }],
  ["sends entries without ids", { data: [{ name: "qwen-local" }] }],
])("a server that %s lists no models", async (_, models) => {
  playLocal([], { models });

  expect(await app.get("/settings/text-models").then((r) => r.json())).toEqual({ models: [] });
});

test("an unreachable server lists no models", async () => {
  startAt(await closedAddress());

  expect(await app.get("/settings/text-models").then((r) => r.json())).toEqual({ models: [] });
});

test("text on Local and images on OpenRouter each get their own address and key", async () => {
  playLocal([[delta(FINISHED)]]);
  const seen: { path: string; authorization: string | null }[] = [];
  const openRouter = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push({ path: new URL(req.url).pathname, authorization: req.headers.get("authorization") });
      return Response.json({ data: [{ b64_json: PNG.toString("base64") }] });
    },
  });
  others.push(openRouter);
  settings.update({ textApiKey: "local-key", imageApiKey: "image-key", imageModel: "fake/image" });
  const id = await app.createSave();

  await turnEvents(await streamTurn(id, "I wade forward."));
  await openRouterImages(settings, new URL("/v1", openRouter.url).href)(
    { prompt: "A flooded plaza", aspect_ratio: "16:9", reference_images: [], style_preset: "" },
    AbortSignal.timeout(5000),
  );

  expect(provider.requests.map(({ authorization }) => authorization)).toEqual(["Bearer local-key"]);
  expect(seen.map(({ path }) => path)).toEqual(["/v1/images/models", "/v1/images"]);
  expect(seen.map(({ authorization }) => authorization)).toEqual(["Bearer image-key", "Bearer image-key"]);

  settings.update({ textBaseUrl: "http://127.0.0.1:1/v1" });
  expect(settings.read()).toMatchObject({ textApiKey: "", imageApiKey: "image-key" });
});

test("a server that redirects can't take the key to another address", async () => {
  const authorizations: (string | null)[] = [];
  const elsewhere = Bun.serve({
    port: 0,
    fetch(req) {
      authorizations.push(req.headers.get("authorization"));
      return Response.json({ data: [] });
    },
  });
  const redirecting = Bun.serve({
    port: 0,
    fetch: (req) => Response.redirect(new URL(new URL(req.url).pathname, elsewhere.url), 307),
  });
  others.push(elsewhere, redirecting);
  startAt(new URL("/v1", redirecting.url).href);
  settings.update({ textBaseUrl: new URL("/v2", redirecting.url).href, textApiKey: "local-key" });
  const id = await app.createSave();

  await streamTurn(id, "I wade forward.").then((r) => r.text());
  await app.get("/settings/text-models").then((r) => r.text());

  expect(authorizations.length).toBeGreaterThan(0);
  expect(authorizations.every((authorization) => authorization === null)).toBe(true);
});
