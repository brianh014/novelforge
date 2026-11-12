import { expect, type Page } from "@playwright/test";

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
