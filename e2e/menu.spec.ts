import { expect, test } from "@playwright/test";

test("the Reader's Guide opens from the Menu, and each section keeps its place in the address", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main Menu" }).getByRole("link", { name: "Reader's Guide" }).click();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();

  await page.getByRole("navigation", { name: "Guide sections" }).getByRole("link", { name: "Changing the story" }).click();
  await expect(page.getByRole("heading", { name: "Changing the story" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Changing the story" })).toBeVisible();
});

test("a new version is offered on the Menu, and Install reloads the page once the server answers as it", async ({ page }) => {
  let installed = false;
  await page.route("**/update", (route) => {
    if (route.request().method() === "POST") {
      installed = true;
      return route.fulfill({ status: 202, json: { version: "9.0.0" } });
    }
    return route.fulfill({
      json: installed
        ? { version: "9.0.0", installable: false }
        : { version: "0.1.0", latest: { version: "9.0.0", url: "https://github.com/brianh014/novelforge/releases/tag/v9.0.0", notes: "" }, installable: true },
    });
  });
  await page.goto("/");
  await expect(page.getByText("NovelForge 9.0.0 is out.")).toBeVisible();
  await expect(page.getByText("Version 0.1.0")).toBeVisible();

  await page.getByRole("button", { name: "Install" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Install" }).click();

  await expect(page.getByText("Version 9.0.0")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("is out.")).toHaveCount(0);
});
