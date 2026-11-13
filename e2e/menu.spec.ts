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

const NEW = { version: "9.0.0", url: "https://github.com/brianh014/novelforge/releases/tag/v9.0.0", notes: "" };

test("a new version's toast shows on any screen, and Install reloads the page once the server answers as it", async ({ page }) => {
  let installed = false;
  await page.route("**/update", (route) => {
    if (route.request().method() === "POST") {
      installed = true;
      return route.fulfill({ status: 202, json: { version: "9.0.0" } });
    }
    return route.fulfill({
      json: installed ? { version: "9.0.0", failed: false, installable: false } : { version: "0.1.0", failed: false, latest: NEW, installable: true },
    });
  });
  await page.goto("/#/load");
  const toast = page.getByRole("complementary", { name: "New version" });
  await expect(toast).toContainText("NovelForge 9.0.0 is out.");

  await toast.getByRole("button", { name: "Install" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Install" }).click();

  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await page.goto("/");
  await expect(page.getByText("Version 9.0.0")).toBeVisible();
});

test("a dismissed toast stays away for that version", async ({ page }) => {
  await page.route("**/update", (route) => route.fulfill({ json: { version: "0.1.0", failed: false, latest: NEW, installable: true } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss the new version" }).click();
  await page.reload();
  await expect(page.getByText("Version 0.1.0")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "New version" })).toHaveCount(0);
});

test("Settings → Updates checks GitHub on request and offers what it finds", async ({ page }) => {
  let fresh = false;
  await page.route("**/update*", (route) => {
    fresh ||= new URL(route.request().url()).searchParams.get("fresh") === "1";
    return route.fulfill({
      json: fresh ? { version: "0.1.0", failed: false, latest: NEW, installable: true } : { version: "0.1.0", failed: false, installable: false },
    });
  });
  await page.goto("/#/settings");
  await page.evaluate(() => localStorage.setItem("novelforge-dismissed-version", "9.0.0"));
  await page.getByRole("button", { name: "Updates" }).click();
  await expect(page.getByText("It's the newest version.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);

  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("NovelForge 9.0.0 is out.")).toBeVisible();

  // Installed from here, the toast put off for this version may show again.
  await page.route("**/update", (route) => {
    fresh = false;
    return route.request().method() === "POST"
      ? route.fulfill({ status: 202, json: { version: "9.0.0" } })
      : route.fulfill({ json: { version: "9.0.0", failed: false, installable: false } });
  });
  await page.getByRole("button", { name: "Install" }).click();
  // The page reloads as the new version, on Settings' first section.
  const reloaded = page.waitForEvent("load");
  await page.getByRole("dialog").getByRole("button", { name: "Install" }).click();
  await reloaded;
  await page.getByRole("button", { name: "Updates" }).click();
  await expect(page.getByText("This is NovelForge 9.0.0.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("novelforge-dismissed-version"))).toBeNull();
});
