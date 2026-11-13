import { expect, type Page, test } from "@playwright/test";
import { newStory } from "./support";

const PC_INPUT = /say or do\?$/;
const choiceButtons = (page: Page) => page.getByRole("group", { name: "Choices" }).getByRole("button");
const modeButton = (page: Page) => page.getByRole("button", { name: "Choices", exact: true });

test("a story begun in Choices mode opens with three Choices, and picking one sends it as the PC's words", async ({ page }) => {
  await newStory(page, "Choices");
  await expect(choiceButtons(page)).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: PC_INPUT })).toHaveCount(0);
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
  await expect(textbox).toHaveCount(0);
  await expect(page.getByTestId("message-narrator")).toHaveCount(1);

  // The Choices are kept while the player types instead, and come back without asking again.
  await modeButton(page).click();
  await expect(textbox).toBeVisible();
  await modeButton(page).click();
  await expect(offer).toHaveCount(0);
  await expect(choiceButtons(page)).toHaveCount(3);
});
