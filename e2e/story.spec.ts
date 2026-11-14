import { expect, type Locator, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { growStory, newStory, sendTurn, STORY_WINDOW } from "./support";

const PC_INPUT = /say or do\?$/;
const IMPORTANT = "Nell Brack";

/** The left page's Story Time, newest Loose End and newest Recent Character. The fake Narrator changes each every Turn. */
const leftPage = (page: Page) => {
  const firstIn = (heading: string) => page.getByRole("heading", { name: heading }).locator("~ ul > li").first();
  return [page.getByTestId("story-time"), firstIn("Loose Ends"), firstIn("Recent Characters").getByRole("img")] as const;
};
const leftPageNow = async (page: Page) => {
  const [time, looseEnd, character] = leftPage(page);
  await expect(character).toBeVisible();
  return [await time.textContent(), await looseEnd.textContent(), await character.getAttribute("alt")] as const;
};

/** Plays one Turn with `send` and checks the story and every left page panel moved on. No `input` is a Continue. */
async function playTurn(page: Page, send: () => Promise<unknown>, input?: string) {
  const narrator = page.getByTestId("message-narrator");
  const players = page.getByTestId("message-player");
  const [narrated, played, before] = [await narrator.count(), await players.count(), await leftPageNow(page)];

  await send();

  await expect(narrator).toHaveCount(narrated + 1);
  await expect(players).toHaveCount(played + 1);
  if (input) await expect(players.last()).toHaveText(input);
  else await expect(players.last().getByRole("separator", { name: "The story continues" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: PC_INPUT })).toHaveValue("");
  const [time, looseEnd, character] = leftPage(page);
  await expect(time).not.toHaveText(before[0]!);
  await expect(looseEnd).not.toHaveText(before[1]!);
  await expect(character).not.toHaveAttribute("alt", before[2]!);
}

/** Waits for every picture still being drawn. */
const picturesDone = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Drawing/ })).toHaveCount(0, { timeout: 20_000 });

/** Each picture in `scope` is a real image the server serves, not a placeholder or a broken link. */
async function expectRealImages(page: Page, scope: Locator) {
  const images = await scope.getByRole("img").all();
  for (const image of images) {
    await image.scrollIntoViewIfNeeded();
    const src = await image.evaluate((element: HTMLImageElement) => element.currentSrc || element.src);
    const response = await page.request.get(src);
    expect(response.ok(), src).toBe(true);
    expect(response.headers()["content-type"], src).toMatch(/^image\//);
  }
  return images.length;
}

/** The items of the Journal list under `heading`, all of them, past "Show more". */
async function journalItems(page: Page, heading: string | RegExp) {
  const list = page.getByRole("heading", { name: heading }).locator("~ ul").first();
  const more = list.locator("+ button.show-more");
  while (await more.isVisible()) await more.click();
  return list.locator("> li");
}

async function journal(page: Page) {
  await page.getByRole("link", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "Journal", level: 1 })).toBeVisible();
  const counts = { facts: await (await journalItems(page, /knows$/)).count(), looseEnds: await (await journalItems(page, "Loose Ends")).count() };
  return counts;
}

test("a story makes and shows everything: pictures, characters, Turns, a Question, a Chapter and the Journal", async ({ page }) => {
  test.setTimeout(90_000);

  // The wizard, with an Important Character of the player's own.
  await page.goto("/#/new");
  await page.getByRole("button", { name: "Add a character" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(IMPORTANT);
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("An old woman who mends nets on the quay.");
  await page.getByRole("button", { name: "Pick for me" }).click();
  await page.getByRole("dialog", { name: "Pick for me?" }).getByRole("button", { name: "Pick for me" }).click();
  await expect(page.getByLabel("What is your story called?")).not.toHaveValue("");
  const pc = await page.getByLabel("What is your character's name?").inputValue();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Generate the world" }).click();

  // The world's overview shows the Cover and every portrait it drew.
  await expect(page.getByRole("img", { name: "The cover of your story" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your PC's portrait" })).toBeVisible();
  await expect(page.getByRole("img", { name: `${IMPORTANT}'s portrait` })).toBeVisible();
  await expectRealImages(page, page.locator("main"));
  await page.getByRole("button", { name: "Begin" }).click();

  // The Opening: a reply, its Scene Image, and the left page filled.
  const story = page.getByRole("region", { name: "Story" });
  await expect(page.getByTestId("message-narrator")).toHaveCount(1);
  await picturesDone(page);
  await expect(story.getByRole("img", { name: /^Scene Image/ }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently" }).locator("+ p")).not.toBeEmpty();
  const journalBefore = await journal(page);
  await page.getByRole("link", { name: "Story" }).click();

  // Turns: typed, decided by the Narrator, and a Continue with no words.
  const input = page.getByRole("textbox", { name: PC_INPUT });
  await playTurn(page, () => input.fill("I walk to the harbour.").then(() => page.getByRole("button", { name: "Send" }).click()), "I walk to the harbour.");
  await page.getByRole("button", { name: "Decide for me" }).click();
  await expect(input).not.toHaveValue("");
  const decided = await input.inputValue();
  await playTurn(page, () => page.getByRole("button", { name: "Send" }).click(), decided);

  // Words in the box: Enhance rewrites them, Undo puts them back, and they wait while the player is elsewhere.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await input.fill("I look around.");
  await expect(continueButton).toBeHidden();
  await page.getByRole("button", { name: "Enhance" }).click();
  await expect(input).not.toHaveValue("I look around.");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(input).toHaveValue("I look around.");
  await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
  await page.getByRole("link", { name: "Journal" }).click();
  await page.getByRole("link", { name: "Story" }).click();
  await expect(input).toHaveValue("I look around.");
  await input.fill("");
  await expect(continueButton).toBeVisible();

  // A Question is answered and changes nothing in the story.
  await page.getByRole("button", { name: "Ask the Narrator" }).click();
  await page.getByPlaceholder(/know about this place/).fill("Who keeps the lighthouse?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.locator("p.answer");
  await expect(answer).not.toHaveText(/thinking/);
  await expect(answer).not.toBeEmpty();
  await page.getByRole("button", { name: "Close" }).click();

  // Draw a picture adds a Scene Image of the scene.
  await picturesDone(page);
  const scenes = story.getByRole("img", { name: /^(Scene Image|Picture): / });
  const sceneCount = await scenes.count();
  await page.getByRole("button", { name: "Draw a picture" }).click();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(scenes).toHaveCount(sceneCount + 1, { timeout: 20_000 });

  // Ending the Chapter: the next Turn opens Chapter II.
  await page.getByRole("button", { name: "End the chapter here" }).last().click();
  await page.getByRole("button", { name: "End the chapter", exact: true }).click();
  await playTurn(page, () => page.getByRole("button", { name: "Continue" }).click());
  await expect(story.getByRole("heading", { name: "Chapter II" })).toBeVisible();

  // Every picture and portrait in the story is real, folded ones too once opened.
  await picturesDone(page);
  const folded = story.locator("details:not([open]) > summary");
  while ((await folded.count()) > 0) await folded.first().click();
  const storyPictures = await story.locator("details > summary", { hasText: /^Picture/ }).count();
  const portraits = await story.locator("details > summary", { hasText: /^Portrait: / }).count();
  expect(portraits).toBeGreaterThan(0);
  expect(await expectRealImages(page, story)).toBe(storyPictures + portraits);
  await expectRealImages(page, page.getByRole("heading", { name: "Recent Characters" }).locator("~ ul"));

  // The Journal: the PC with a portrait and status, the story so far, and every character with a portrait and who they are.
  const after = await journal(page);
  expect(after.facts).toBe(journalBefore.facts + 3);
  expect(after.looseEnds).toBe(journalBefore.looseEnds + 3);
  const pcEntry = page.locator(".journal > .person.pc");
  await expect(pcEntry.getByRole("img", { name: pc })).toBeVisible();
  await expect(pcEntry.locator(".about")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "Story Time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent summary" }).locator("xpath=following::p[1]")).not.toHaveText("Nothing recent yet.");
  await expect(page.getByRole("heading", { name: "Story Summary" }).locator("xpath=following::p[1]")).not.toHaveText("Nothing to look back on yet.");
  const characters = await journalItems(page, "Characters");
  const names: string[] = [];
  for (const character of await characters.all()) {
    const portrait = character.getByRole("img");
    await expect(portrait).toBeVisible();
    names.push((await portrait.getAttribute("alt"))!);
    await expect(character.locator(".about")).not.toBeEmpty();
  }
  expect(names).toContain(IMPORTANT);
  await expectRealImages(page, page.locator(".journal"));
  // The ended Chapter has the title the Narrator gave it.
  await expect(page.getByRole("heading", { name: "Chapters" }).locator("+ ol").getByRole("button")).toHaveText(["Chapter 2 · in progress", /^Chapter 1 · \S/]);

  // The Gallery: the Cover, the PC and every character, and each Scene Image.
  await page.getByRole("link", { name: "Gallery" }).click();
  await expect(page.getByRole("img", { name: "Cover" })).toBeVisible();
  const gallery = (heading: string) => page.getByRole("heading", { name: heading }).locator("+ ul");
  const galleryNames = await gallery("Characters")
    .getByRole("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("alt")));
  expect(galleryNames.toSorted()).toEqual([pc, ...names].toSorted());
  await expect(gallery("Scenes").getByRole("img")).toHaveCount(storyPictures);
  await expectRealImages(page, page.locator("main"));
});

test("the wizard asks before removing an Important Character and before regenerating the world", async ({ page }) => {
  await page.goto("/#/new");
  await page.getByRole("button", { name: "Add a character" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(IMPORTANT);
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const remove = page.getByRole("button", { name: /^Remove / });
  const removeDialog = page.getByRole("dialog", { name: `Remove ${IMPORTANT}?` });

  await remove.click();
  await removeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(name).toHaveValue(IMPORTANT);
  await remove.click();
  await removeDialog.getByRole("button", { name: "Remove" }).click();
  await expect(name).toHaveCount(0);

  await page.getByRole("button", { name: "Pick for me" }).click();
  await page.getByRole("dialog", { name: "Pick for me?" }).getByRole("button", { name: "Pick for me" }).click();
  await expect(page.getByLabel("What is your story called?")).not.toHaveValue("");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Generate the world" }).click();
  const regenerate = page.getByRole("button", { name: "Regenerate" });
  const regenerateDialog = page.getByRole("dialog", { name: "Regenerate this world?" });
  await regenerate.click();
  await regenerateDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(regenerateDialog).toHaveCount(0);
  await regenerate.click();
  await regenerateDialog.getByRole("button", { name: "Regenerate" }).click();
  // Rebuilt, and the dialog doesn't come back with the page's foot.
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await expect(regenerateDialog).toHaveCount(0);
});

test("Load Story opens a story, and a Duplicate is a second one", async ({ page }) => {
  const { title } = await newStory(page);

  await page.goto("/#/load");
  const listed = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Open ${title}` }) });
  await expect(listed.first()).toBeVisible();
  const before = await listed.count();
  await page
    .getByRole("button", { name: `Duplicate ${title}` })
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Duplicate" }).click();
  await expect(listed).toHaveCount(before + 1);

  await page
    .getByRole("link", { name: `Open ${title}` })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
});

test("Duplicate from here asks first, and then opens the copy", async ({ page }) => {
  await newStory(page);
  const story = page.url();
  const duplicate = page.getByRole("button", { name: /^Duplicate from this Message/ }).first();

  await duplicate.click();
  await page.getByRole("dialog", { name: "Duplicate from this Message?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(story);

  await duplicate.click();
  await page.getByRole("dialog", { name: "Duplicate from this Message?" }).getByRole("button", { name: "Duplicate" }).click();
  await expect(page).not.toHaveURL(story);
  await expect(page).toHaveURL(/#\/play\//);
});

test("the latest response can be edited, rewritten and regenerated, and the story reverted", async ({ page }) => {
  await newStory(page);
  const narrator = page.getByTestId("message-narrator");
  const regenerate = page.getByRole("button", { name: "Regenerate" });
  await page.getByRole("textbox", { name: PC_INPUT }).fill("I knock on the door.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(narrator).toHaveCount(2);
  await expect(regenerate).toBeVisible();

  // An Edit puts the player's own words in place of the response.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit the response" }).fill("The door creaks open.");
  await page.getByRole("button", { name: "Save the edit" }).click();
  await expect(regenerate).toBeVisible();
  await expect(narrator.last()).toHaveText("The door creaks open.");

  // A Rewrite and a Regenerate each replace it, still one response to the Turn.
  await page.getByRole("button", { name: "Rewrite", exact: true }).click();
  await page.getByRole("textbox", { name: "What should the Narrator change?" }).fill("Make it raining.");
  await page.getByRole("button", { name: "Rewrite the response" }).click();
  await expect(narrator.last()).not.toHaveText("The door creaks open.");
  await expect(regenerate).toBeVisible();
  await regenerate.click();
  await page.getByRole("dialog", { name: "Regenerate this response?" }).getByRole("button", { name: "Regenerate" }).click();
  await expect(regenerate).toBeVisible();
  await expect(narrator).toHaveCount(2);

  // A Revert to the Opening takes the Turn away.
  await page
    .getByRole("button", { name: /^Revert to this Message/ })
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Revert", exact: true }).click();
  await expect(narrator).toHaveCount(1);
  await expect(page.getByTestId("message-player")).toHaveCount(0);
});

test("a Revert to the player's own words has the Narrator answer them again", async ({ page }) => {
  await newStory(page);
  const narrator = page.getByTestId("message-narrator");
  const player = page.getByTestId("message-player");
  for (const words of ["I knock on the door.", "I wait."]) {
    await page.getByRole("textbox", { name: PC_INPUT }).fill(words);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  }
  await expect(narrator).toHaveCount(3);

  await page.getByRole("button", { name: /^Revert to this Message: I knock/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("then the Narrator answers it again");
  await dialog.getByRole("button", { name: "Revert", exact: true }).click();

  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  await expect(player).toHaveCount(1);
  await expect(player).toContainText("I knock on the door.");
  await expect(narrator).toHaveCount(2);
});

test("on a phone, a Journal change that can't be refreshed says so on the page it was made", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newStory(page);
  await journal(page);
  await page.getByRole("button", { name: "Summary & Chapters" }).click();
  await page.getByRole("button", { name: "Edit: Story Summary" }).click();
  await page.getByRole("textbox", { name: "Story Summary" }).fill("A changed summary.");
  // The change saves, but the fresh copy of the Journal doesn't come back.
  await page.route(/\/saves\/[^/]+\/journal$/, (route) => (route.request().method() === "GET" ? route.fulfill({ status: 500 }) : route.continue()));
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Saved, but the Journal couldn't be refreshed.").filter({ visible: true })).toHaveCount(1);
});

test("a long story draws its newest Messages, and the up arrow shows 50 earlier at a time", async ({ page }) => {
  await newStory(page);
  await sendTurn(page, "I walk to the harbour.");
  const id = page.url().split("/").at(-1)!;
  await page.goto("/");
  // The first Message is the Opening's hidden input, so 260 draw as 259.
  growStory(join(import.meta.dirname, ".data"), id, 260);
  await page.goto(`/#/play/${id}`);
  const messages = page.locator("[data-testid^=message-]");
  const earlier = page.getByRole("button", { name: "Show earlier messages" });
  await expect(messages).toHaveCount(STORY_WINDOW);
  await earlier.click();
  await expect(messages).toHaveCount(STORY_WINDOW + 50);
  await earlier.click();
  await expect(messages).toHaveCount(259);
  await expect(earlier).toBeHidden();
  await expect(page.getByRole("region", { name: "Story" })).toBeFocused();
});
