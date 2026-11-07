import { expect, test } from "bun:test";
import { matches } from "../src/web/settings";

test("a search finds every word in any order, in any case, and nothing searched finds everything", () => {
  expect(matches("xiaomi/mimo-v2.6-pro", "PRO mimo")).toBe(true);
  expect(matches("xiaomi/mimo-v2.6", "pro mimo")).toBe(false);
  expect(matches("DeepInfra", "  ")).toBe(true);
});
