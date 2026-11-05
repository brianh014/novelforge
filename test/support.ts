import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Dice } from "../src/check-resolver";
import type { ImageAdapter, ImagePayload } from "../src/image-adapter";
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

/** A real one-pixel PNG. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** The same picture with a trailing byte, to tell one image from another. */
export const png = (mark: number) => Uint8Array.of(...PNG, mark);

/**
 * Answers each image request with the next entry, throwing Errors, and records every payload. A promise stays in
 * flight until it settles or the request is aborted, like a slow image model.
 */
export function scriptedImages(...replies: (Uint8Array | Error | Promise<Uint8Array>)[]) {
  const payloads: ImagePayload[] = [];
  const aborted: number[] = [];
  const imageAdapter: ImageAdapter = async (payload, signal) => {
    const request = payloads.push(payload);
    const reply = await Promise.race([
      replies.shift() ?? new Error("Image script exhausted"),
      new Promise<Error>((resolve) =>
        signal.addEventListener("abort", () => {
          aborted.push(request);
          resolve(new Error("aborted"));
        }),
      ),
    ]);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { imageAdapter, payloads, aborted };
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
export function startApp(
  savesDir: string,
  textProvider: TextProvider,
  dice = scriptedDice(),
  nearMissMargin = 2,
  imageAdapter = scriptedImages().imageAdapter,
) {
  const settings = settingsStore(join(dirname(savesDir), "settings.json"));
  const start = () => startServer({ savesDir, settings, textProvider, imageAdapter, dice, nearMissMargin, port: 0 });
  let server = start();
  const post = (path: string, body: unknown) => postJson(new URL(path, server.url), body);
  return {
    post,
    patch: (path: string, body: unknown) => sendJson("PATCH", new URL(path, server.url), body),
    delete: (path: string) => fetch(new URL(path, server.url), { method: "DELETE" }),
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
