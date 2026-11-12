import { expect, test } from "@playwright/test";
import { newStory } from "./support";

test("a new story starts from the wizard, takes a Turn, and fills the Journal and Gallery", async ({ page }) => {
  await newStory(page);

  await page.getByRole("textbox", { name: /say or do\?$/ }).fill("I walk to the harbour.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("message-player")).toHaveText(["I walk to the harbour."]);
  await expect(page.getByTestId("message-narrator")).toHaveCount(2);

  await page.getByRole("link", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Characters" }).locator("~ ul > li").first()).toBeVisible();

  await page.getByRole("link", { name: "Gallery" }).click();
  await expect(page.getByRole("img", { name: "Cover" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scenes" })).toBeVisible();
});

test("Load Story opens a story, and a Duplicate is a second one", async ({ page }) => {
  const { title } = await newStory(page);

  await page.goto("/#/load");
  const listed = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Open ${title}` }) });
  await expect(listed.first()).toBeVisible();
  const before = await listed.count();
  await page.getByRole("button", { name: `Duplicate ${title}` }).first().click();
  await expect(listed).toHaveCount(before + 1);

  await page.getByRole("link", { name: `Open ${title}` }).first().click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
});
