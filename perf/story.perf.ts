import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { growStory, newStory, sendTurn, STORY_WINDOW } from "../e2e/support";

// The player's longest story had 1,199 Messages on 2026-11-12. Each budget is about twice what a fast machine takes, so only a real slowdown fails.
const MESSAGES = 1200;
const BUDGET = { firstKeyMs: 200, keyMedianMs: 34, keyWorstMs: 100, openMs: 3000, openBlockMs: 1000, turnBlockMs: 200 };

let page: Page;
let id: string;

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

/** Opens the grown story, as a failed test leaves a fresh worker on the home page. Only the hash changes, so a watch on the page keeps going. */
async function openStory() {
  await page.goto(`/#/play/${id}`);
  // The newest Messages, which is all a long story draws until the player asks for more.
  await expect(page.locator("[data-testid^=message-]")).toHaveCount(STORY_WINDOW, { timeout: 30_000 });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await newStory(page);
  for (const words of ["I walk to the harbour.", "I ask about the lighthouse."]) await sendTurn(page, words);
  id = page.url().split("/").at(-1)!;
  await page.goto("/");
  growStory(join(import.meta.dirname, ".data"), id, MESSAGES);
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
  const block = await longestBlock(() => sendTurn(page, "I wait for the tide."));
  report("turn", { longestBlockMs: block });
  expect.soft(block).toBeLessThan(BUDGET.turnBlockMs);
});
