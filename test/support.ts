import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dice } from "../src/check-resolver";
import { startServer } from "../src/rest-api";
import type { Prompt } from "../src/prompt-assembler";
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

export const postJson = (url: URL, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** A real server over a real Saves folder. `restart` keeps the folder. */
export function startGame(
  savesDir: string,
  textProvider: TextProvider,
  dice = scriptedDice(),
  nearMissMargin = 2,
  modelInstructions = "",
) {
  const start = () => startServer({ savesDir, textProvider, dice, nearMissMargin, modelInstructions, port: 0 });
  let server = start();
  const post = (path: string, body: unknown) => postJson(new URL(path, server.url), body);
  return {
    post,
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
