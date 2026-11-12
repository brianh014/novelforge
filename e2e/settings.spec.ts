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

test("a LoRA's strength box follows the list when switching back to a family brings back its LoRAs", async ({ page }) => {
  const loras = ["style.safetensors"];
  await page.route("**/settings/comfy-models", (route) =>
    route.fulfill({
      json: {
        reachable: true,
        hasFlux2: true,
        hasQwen21: true,
        checkpoints: [],
        diffusionModels: [],
        textEncoders: [],
        vaes: [],
        loras,
        samplers: [],
        schedulers: [],
      },
    }),
  );
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await page.getByRole("button", { name: /^Image provider/ }).click();
  await page.getByRole("option", { name: "Local (ComfyUI)" }).click();
  const family = async (name: string) => {
    await page.getByRole("button", { name: /^Model family/ }).click();
    await page.getByRole("option", { name }).click();
  };
  const strength = page.getByRole("spinbutton", { name: "LoRA 1 strength" });

  await page.getByRole("button", { name: "Add LoRA" }).click();
  await strength.fill("0.5");
  await family("FLUX.2");
  await page.getByRole("button", { name: "Add LoRA" }).click();
  await expect(strength).toHaveValue("1");
  await family("SD 1.5/SDXL (faces change between pictures)");

  await expect(strength).toHaveValue("0.5");
});
