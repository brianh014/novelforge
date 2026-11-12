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
