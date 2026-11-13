import { expect, type Page, test } from "@playwright/test";
import { newStory } from "./support";

const PC_INPUT = /say or do\?$/;
const choiceButtons = (page: Page) => page.getByRole("group", { name: "Choices" }).getByRole("button");
const modeButton = (page: Page) => page.getByRole("button", { name: "Choices", exact: true });

test("a story begun in Choices mode opens with three Choices, and picking one sends it as the PC's words", async ({ page }) => {
  await newStory(page, "Choices");
  await expect(choiceButtons(page)).toHaveCount(3);
  // The text box stays, as a fourth box under the Choices.
  await expect(page.getByRole("group", { name: "Choices" }).getByRole("textbox", { name: PC_INPUT })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decide for me" })).toHaveCount(0);
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "true");

  const picked = (await choiceButtons(page).first().textContent())!;
  await choiceButtons(page).first().click();

  await expect(page.getByTestId("message-narrator")).toHaveCount(2);
  await expect(page.getByTestId("message-player").last()).toContainText(picked);
  await expect(choiceButtons(page)).toHaveCount(3);
});

test("switching to Choices asks to write the response again, and switching back brings the text box", async ({ page }) => {
  await newStory(page);
  const textbox = page.getByRole("textbox", { name: PC_INPUT });
  const offer = page.getByRole("dialog", { name: "Write this response with Choices?" });

  // Cancel leaves the story in Free Text.
  await modeButton(page).click();
  await offer.getByRole("button", { name: "Cancel" }).click();
  await expect(modeButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(textbox).toBeVisible();

  await modeButton(page).click();
  await offer.getByRole("button", { name: "Regenerate" }).click();
  await expect(choiceButtons(page)).toHaveCount(3);
  await expect(textbox).toHaveAttribute("placeholder", "Or write your own…");
  await expect(page.getByTestId("message-narrator")).toHaveCount(1);

  // The Choices are kept while the player types instead, and come back without asking again.
  await modeButton(page).click();
  await expect(textbox).toBeVisible();
  await modeButton(page).click();
  await expect(offer).toHaveCount(0);
  await expect(choiceButtons(page)).toHaveCount(3);
});

test("in Choices mode the player can write their own move instead, and on a phone the Choices sit in the story", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await newStory(page, "Choices");
  const story = page.getByRole("region", { name: "Story" });
  await expect(story.getByRole("group", { name: "Choices" }).getByRole("button")).toHaveCount(3);

  await story.getByRole("textbox", { name: PC_INPUT }).fill("I wave to the ferryman.");
  await story.getByRole("textbox", { name: PC_INPUT }).press("Enter");

  await expect(page.getByTestId("message-player").last()).toContainText("I wave to the ferryman.");
  await expect(page.getByTestId("message-narrator")).toHaveCount(2);
  await expect(choiceButtons(page)).toHaveCount(3);
  await expect(story.getByRole("textbox", { name: PC_INPUT })).toHaveValue("");
});
