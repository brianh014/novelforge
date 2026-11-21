import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { startServer } from "../src/rest-api";
import { saveStore } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { logOf, narration, scriptedDice, scriptedImages, scriptedTextProvider, tempFolder } from "./support";

const folder = tempFolder();
let server: ReturnType<typeof startServer>;
afterEach(async () => {
  await server.stop(true);
});

test("at the world's moving on the Scribe adds Lore for what the replies established, never over an entry already there nor one that tells nothing", async () => {
  const savesDir = join(folder.path, "Saves");
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ textModel: "narrator/model" });
  const THIEF = "A thief plans to rob the library at the next high tide.";
  const narrator = scriptedTextProvider(
    narration("Ash meets Mother Gray, who has kept the ferry since the flood.", {
      op: "set_story_time",
      days_passed: 1,
      date: "2nd of Thaw",
      time_of_day: "dawn",
    }),
    JSON.stringify({ left: [{ thread: THIEF, answer: null, question: "Whether the theft happens." }], plot_threads: [] }),
    narration("Ash goes home."),
  );
  const scribe = scriptedTextProvider(
    // Upkeep's, then the Lore call's, then Upkeep's again.
    JSON.stringify({ state_operations: [] }),
    JSON.stringify({
      named: ["Mother Gray", "the flood", "Ash"],
      entries: [
        { title: "Mother Gray", keywords: ["Mother Gray", "ferrywoman", "the ferry"], content: "She has kept the ferry since the flood." },
        { title: "Gulls", keywords: ["gull", "gulls", "birds"], content: "Gulls are spies." },
        // Tells no more than its name.
        { title: "The ferry rope", keywords: ["rope", "ferry rope", "line"], content: "The ferry has a rope." },
      ],
    }),
    JSON.stringify({ state_operations: [] }),
  );
  server = startServer({
    savesDir,
    settings,
    textProvider: narrator.textProvider,
    reviewProvider: scribe.textProvider,
    imageAdapter: scriptedImages().imageAdapter,
    dice: scriptedDice(),
    nearMissMargin: 2,
    port: 0,
    moveWorld: true,
    writePicture: async (_ask, _style, fallback) => fallback,
    reviewPicture: async (description) => description,
  });
  const id = saveStore(savesDir).create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: [], carrying: [] },
      scene: { location: "The library", visibleCast: [] },
      summary: "",
      worldRules: [],
      plotThreads: [THIEF],
      worldBible: [{ title: "Gulls", keywords: ["gull"], content: "Gulls nest on the dome.", alwaysOn: false }],
    },
  });
  const turn = (input: string) =>
    fetch(new URL(`/saves/${id}/turns`, server.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });

  const log = await logOf(async () => {
    for (const input of ["I take the ferry.", "I go home."]) expect((await turn(input)).ok).toBe(true);
  }, "info");

  const bible = saveStore(savesDir).latestState(id).worldBible;
  expect(bible.find(({ title }) => title === "Mother Gray")).toMatchObject({ keywords: ["Mother Gray", "ferrywoman", "the ferry"], alwaysOn: false });
  expect(bible.find(({ title }) => title === "Gulls")?.content).toBe("Gulls nest on the dome.");
  expect(log).toContain('"named":3,"added":1,"dropped":2');
  // The Scribe never reads a thread's secret.
  expect(scribe.prompts.some((prompt) => JSON.stringify(prompt).includes("rob the library"))).toBe(false);
  folder.remove();
});
