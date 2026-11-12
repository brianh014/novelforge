import { expect, type Page, test } from "@playwright/test";
import { newStory } from "./support";

/** The left page's Story Time, newest Loose End and newest Recent Character. The fake Narrator changes each every Turn. */
const leftPage = (page: Page) => {
  const firstIn = (heading: string) => page.getByRole("heading", { name: heading }).locator("~ ul > li").first();
  return [page.getByTestId("story-time"), firstIn("Loose Ends"), firstIn("Recent Characters").getByRole("img")];
};
const textsOf = async (page: Page) => {
  const [time, looseEnd, character] = leftPage(page);
  await expect(character!).toBeVisible();
  return [await time!.textContent(), await looseEnd!.textContent(), await character!.getAttribute("alt")];
};

async function journalCounts(page: Page) {
  await page.getByRole("link", { name: "Journal" }).click();
  const items = (heading: string | RegExp) => page.getByRole("heading", { name: heading }).locator("~ ul").first().locator("> li");
  await expect(items(/knows$/).first()).toBeVisible();
  const counts = { facts: await items(/knows$/).count(), looseEnds: await items("Loose Ends").count() };
  await page.getByRole("link", { name: "Story" }).click();
  return counts;
}

test("each Turn adds to the story and updates the left page and the Journal", async ({ page }) => {
  await newStory(page);
  const journalBefore = await journalCounts(page);
  let before = await textsOf(page);

  for (const [index, input] of ["I walk to the harbour.", "I ask about the lighthouse."].entries()) {
    await page.getByRole("textbox", { name: /say or do\?$/ }).fill(input);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByTestId("message-player").last()).toHaveText(input);
    await expect(page.getByTestId("message-narrator")).toHaveCount(index + 2);
    await expect(page.getByRole("textbox", { name: /say or do\?$/ })).toHaveValue("");
    const [time, looseEnd, character] = leftPage(page);
    await expect(time!).not.toHaveText(before[0]!);
    await expect(looseEnd!).not.toHaveText(before[1]!);
    await expect(character!).not.toHaveAttribute("alt", before[2]!);
    before = await textsOf(page);
  }

  const journalAfter = await journalCounts(page);
  expect(journalAfter.facts).toBe(journalBefore.facts + 2);
  expect(journalAfter.looseEnds).toBe(journalBefore.looseEnds + 2);

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
