import { expect, test } from "@playwright/test";

test("a Reading setting is saved and still applies after a reload", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Reading" }).click();
  await page.getByRole("button", { name: /^Font size/ }).click();
  await page.getByRole("option", { name: "Large" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
  await page.getByRole("button", { name: "Reading" }).click();
  await expect(page.getByRole("button", { name: /^Font size/ })).toContainText("Large");
});

test("a long picker's search box finds a choice, a click picks it, and Tab away closes the list", async ({ page }) => {
  const models = Array.from({ length: 12 }, (_, index) => `maker/model-${index + 1}`);
  await page.route("**/settings/text-models", (route) => route.fulfill({ json: { models } }));
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const picker = page.getByRole("button", { name: /^Text model/ });

  await picker.click();
  await page.getByRole("combobox", { name: "Search Text model" }).fill("model-11");
  await page.getByRole("option", { name: "maker/model-11" }).click();
  await expect(picker).toContainText("maker/model-11");

  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toBeHidden();
});
