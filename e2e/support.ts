import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** How many Messages the story draws before its up arrow, as in play.tsx. */
export const STORY_WINDOW = 200;

/** Plays one Turn of `words` and waits for it to be saved. A full story's window keeps its count, so this goes by the words. */
export async function sendTurn(page: Page, words: string) {
  await page.getByRole("textbox", { name: /say or do\?$/ }).fill(words);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("message-player").last()).toContainText(words);
  await expect(page.getByRole("button", { name: "Stop" })).toBeHidden();
}

/** Makes a story through the New Story wizard with the fake Narrator's picks, and leaves the page on its Opening. */
export async function newStory(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "New Story" }).click();
  await page.getByRole("button", { name: "Pick for me" }).click();
  await page.getByRole("dialog", { name: "Pick for me?" }).getByRole("button", { name: "Pick for me" }).click();
  await expect(page.getByLabel("What is your story called?")).not.toHaveValue("");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Generate the world" }).click();
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.getByTestId("message-narrator")).toHaveCount(1);
  return { title: (await page.getByRole("heading", { level: 1 }).textContent())! };
}

/**
 * Fills a fake story in `dataDir` to `total` Messages by copying its Messages below the real ones. The real ones move up past the copies with
 * everything that names them, so the newest Turn keeps its Snapshot and pictures, and the copies are history that is only read.
 */
export function growStory(dataDir: string, saveId: string, total: number) {
  const db = new DatabaseSync(join(dataDir, "fake", "Saves", `${saveId}.sqlite`));
  const rows = db.prepare("SELECT role, text, hidden_check, created_at, edits, direction FROM messages ORDER BY id").all() as Record<string, SQLInputValue>[];
  const copies = total - rows.length;
  // Past every id in use, so no row meets another on the way up.
  const shift = total;
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
  db.close();
}
