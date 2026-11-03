import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Dice } from "../src/check-resolver";
import { startServer } from "../src/rest-api";
import type { Prompt } from "../src/prompt-assembler";
import { settingsStore } from "../src/settings-store";
import type { TextProvider } from "../src/turn-engine";

export const narration = (text: string, ...state_operations: unknown[]) =>
  JSON.stringify({ narration: text, state_operations });

/** Replies with each entry in turn, throwing Errors, and records every prompt. */
export function scriptedTextProvider(...replies: (string | Error)[]) {
  const prompts: Prompt[] = [];
  const textProvider: TextProvider = async (prompt) => {
    prompts.push(prompt);
    const reply = replies.shift() ?? new Error("Text Provider script exhausted");
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { textProvider, prompts };
}

/** Rolls each entry in turn. Rolling past the script fails the request, so an extra roll cannot pass unnoticed. */
export function scriptedDice(...rolls: number[]): Dice {
  return () => {
    const roll = rolls.shift();
    if (roll === undefined) throw new Error("Dice script exhausted");
    return roll;
  };
}

export function tempFolder() {
  const path = mkdtempSync(join(tmpdir(), "novelforge-"));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

const sendJson = (method: string, url: URL, body: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const postJson = (url: URL, body: unknown) => sendJson("POST", url, body);

/** A real server over a real Saves folder. `restart` keeps the folder. */
export function startGame(
  savesDir: string,
  textProvider: TextProvider,
  dice = scriptedDice(),
  nearMissMargin = 2,
) {
  const settings = settingsStore(join(dirname(savesDir), "settings.json"));
  const start = () => startServer({ savesDir, settings, textProvider, dice, nearMissMargin, port: 0 });
  let server = start();
  const post = (path: string, body: unknown) => postJson(new URL(path, server.url), body);
  return {
    post,
    patch: (path: string, body: unknown) => sendJson("PATCH", new URL(path, server.url), body),
    get: (path: string) => fetch(new URL(path, server.url)),
    url: (path: string) => new URL(path, server.url),
    createSave: async () => {
      const response = await post("/saves", { worldBrief: "A drowned city", pc: { name: "Ash" } });
      return ((await response.json()) as { id: string }).id;
    },
    restart: async () => {
      await server.stop(true);
      server = start();
    },
    stop: () => server.stop(true),
  };
}

/** One text delta as an OpenAI-compatible server streams it. */
export const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

type FakeReply = Response | string[] | (() => AsyncIterable<string>);

/**
 * A local OpenAI-compatible server, so the real client code path runs. Answers each chat request with the next
 * reply: a Response, whole SSE strings, or a generator that can wait between them. Records every chat request.
 */
export function fakeOpenAi(replies: FakeReply[], initialModels: unknown = { data: [] }) {
  let models = initialModels;
  const requests: { body: any; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    routes: {
      "/v1/models": () => (models ? Response.json(models) : new Response("Not found", { status: 404 })),
      "/v1/chat/completions": async (req) => {
        requests.push({ body: await req.json(), authorization: req.headers.get("authorization") });
        const reply = replies.shift() ?? new Response("script exhausted", { status: 500 });
        if (reply instanceof Response) return reply;
        const parts = typeof reply === "function" ? reply() : (async function* () { yield* reply; })();
        return new Response(parts as unknown as ReadableStream, { headers: { "Content-Type": "text/event-stream" } });
      },
    },
  });
  return {
    requests,
    baseUrl: new URL("/v1", server.url).href,
    setModels: (next: unknown) => void (models = next),
    stop: () => server.stop(true),
  };
}

export async function turnEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [, event, data] = block.match(/^event: (.+)\ndata: (.+)$/)!;
      return { event: event!, data: JSON.parse(data!) };
    });
}
