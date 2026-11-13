import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { newStory } from "../e2e/support";

// The player's longest story had 1,199 Messages on 2026-11-12. Each budget is about twice what a fast machine takes, so only a real slowdown fails.
const MESSAGES = 1200;
const BUDGET = { firstKeyMs: 200, keyMedianMs: 34, keyWorstMs: 100, openMs: 3000, openBlockMs: 1000, turnBlockMs: 200 };

let page: Page;
let id: string;
let narrations: number;

/**
 * Fills a fake story to MESSAGES by copying its Messages below the real ones. The real ones move up past the copies with
 * everything that names them, so the newest Turn keeps its Snapshot and pictures, and the copies are history that is only read.
 */
function grow(saveId: string) {
  const db = new DatabaseSync(join(import.meta.dirname, ".data", "fake", "Saves", `${saveId}.sqlite`));
  const rows = db.prepare("SELECT role, text, hidden_check, created_at, edits, direction FROM messages ORDER BY id").all() as Record<string, SQLInputValue>[];
  const copies = MESSAGES - rows.length;
  // Past every id in use, so no row meets another on the way up.
  const shift = MESSAGES;
  db.exec("BEGIN");
  db.exec(`UPDATE messages SET id = id + ${shift}`);
  for (const table of ["snapshot_sections", "scene_images", "requested_images"]) db.exec(`UPDATE ${table} SET message_id = message_id + ${shift}`);
  // The PC's portrait is message 0, which stays.
  db.exec(`UPDATE portraits SET message_id = message_id + ${shift} WHERE message_id > 0`);
  db.exec(`UPDATE save SET memory_start = memory_start + ${shift} WHERE memory_start > 0`);
  const insert = db.prepare(
    "INSERT INTO messages (id, role, text, hidden_check, created_at, edits, direction) VALUES (:id, :role, :text, :hidden_check, :created_at, :edits, :direction)",
  );
  for (let i = 0; i < copies; i++) {
    insert.run({ ...rows[i % rows.length], id: i + 1 });
  }
  db.exec("COMMIT");
  const { narrations } = db.prepare("SELECT count(*) AS narrations FROM messages WHERE role = 'narrator'").get() as { narrations: number };
  db.close();
  return narrations;
}

/** Counts the main thread's longest stall while `run` goes, which is what the player feels as a freeze. */
async function longestBlock(run: () => Promise<unknown>) {
  await page.evaluate(() => {
    const w = window as unknown as { longest: number; watching: PerformanceObserver };
    w.longest = 0;
    w.watching = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.longest = Math.max(w.longest, entry.duration);
    });
    w.watching.observe({ type: "longtask" });
  });
  await run();
  return page.evaluate(() => {
    const w = window as unknown as { longest: number; watching: PerformanceObserver };
    w.watching.disconnect();
    return Math.round(w.longest);
  });
}

const report = (name: string, numbers: Record<string, number>) =>
  console.log(
    `  ${name}: ${Object.entries(numbers)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
const input = () => page.getByRole("textbox", { name: /say or do\?$/ });
const narrator = () => page.getByTestId("message-narrator");

/** Opens the grown story, as a failed test leaves a fresh worker on the home page. Only the hash changes, so a watch on the page keeps going. */
async function openStory() {
  await page.goto(`/#/play/${id}`);
  await expect(narrator()).toHaveCount(narrations, { timeout: 30_000 });
}

async function playTurn(words: string) {
  const before = await narrator().count();
  await input().fill(words);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(narrator()).toHaveCount(before + 1);
  await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await newStory(page);
  for (const words of ["I walk to the harbour.", "I ask about the lighthouse."]) await playTurn(words);
  id = page.url().split("/").at(-1)!;
  await page.goto("/");
  narrations = grow(id);
});

test.afterAll(() => page.close());

test(`opening a ${MESSAGES}-message story`, async () => {
  await page.goto("/");
  const start = Date.now();
  const block = await longestBlock(openStory);
  const openMs = Date.now() - start;
  report("open", { ms: openMs, longestBlockMs: block });
  expect.soft(openMs).toBeLessThan(BUDGET.openMs);
  expect.soft(block).toBeLessThan(BUDGET.openBlockMs);
});

test("typing in the chat box", async () => {
  await openStory();
  await input().click();
  const times = await page.evaluate(async () => {
    const box = document.querySelector("textarea")!;
    const taken: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      box.focus();
      document.execCommand("insertText", false, i % 8 === 7 ? " " : "a");
      // Until the frame after the key is painted.
      await new Promise((painted) => requestAnimationFrame(() => setTimeout(painted)));
      taken.push(performance.now() - start);
    }
    return taken;
  });
  // The first key turns Continue into Send, a change the page has to show, so it has its own budget.
  const first = Math.round(times.shift()!);
  times.sort((a, b) => a - b);
  const [median, worst] = [Math.round(times[29]!), Math.round(times.at(-1)!)];
  report("typing", { firstKeyMs: first, medianMs: median, worstMs: worst });
  await input().fill("");
  expect.soft(first).toBeLessThan(BUDGET.firstKeyMs);
  expect.soft(median).toBeLessThan(BUDGET.keyMedianMs);
  expect.soft(worst).toBeLessThan(BUDGET.keyWorstMs);
});

test("a Turn coming in", async () => {
  await openStory();
  const block = await longestBlock(() => playTurn("I wait for the tide."));
  report("turn", { longestBlockMs: block });
  expect.soft(block).toBeLessThan(BUDGET.turnBlockMs);
});
