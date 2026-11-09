import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { settingsStore } from "../src/settings-store";
import { TextProviderFailed } from "../src/turn-engine";
import { type PictureAsk, writePicturePrompt } from "../src/world-creation";
import { png, scriptedImages, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp> | undefined;

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await app?.stop();
  app = undefined;
  folder.remove();
});

const setting = { theme: "High Fantasy", world: "A drowned city", artStyle: "Ink wash: loose black brushwork" };
const cover: PictureAsk = { kind: "cover", title: "The Salt Reckoning", people: ["a tall woman in an oilskin coat"], ...setting };
const portrait: PictureAsk = { kind: "portrait", looks: "a tall woman, wearing an oilskin coat", ...setting };

const write = (ask: PictureAsk, style: "prose" | "keywords", ...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  const settings = settingsStore(join(folder.path, "settings.json"));
  const written = writePicturePrompt({ textProvider: script.textProvider, settings }, ask, style, "the template", new AbortController().signal);
  return { written, prompts: script.prompts };
};

const text = (words: string) => JSON.stringify({ text: words });

test("a Cover's prompt is written whole, Art Style and world included, from only what the player reads, and must letter the title", async () => {
  const { written, prompts } = write(cover, "prose", text("A drowned city at night."), text(`A drowned city at night, its title "The Salt Reckoning" lettered above.`));

  expect(await written).toBe(`A drowned city at night, its title "The Salt Reckoning" lettered above.`);
  expect(prompts).toHaveLength(2);
  const [system, user] = prompts[0]!;
  expect(system!.content).toContain("front cover of a novel");
  expect(system!.content).toContain("at most 160 words");
  expect(system!.content).toContain("Never name anyone");
  expect(system!.content).toContain("Open the prompt with the picture's art style");
  expect(system!.content).toContain("as that world and its era have them");
  expect(JSON.parse(user!.content)).toEqual({ title: cover.title, people: cover.people, ...setting });
});

test.each([
  ["prose", 120],
  ["keywords", 60],
] as const)("a %s portrait's prompt keeps to %i words, retrying a longer one", async (style, words) => {
  const { written, prompts } = write(portrait, style, text("tall ".repeat(words + 1)), text("A tall woman in an oilskin coat."));

  expect(await written).toBe("A tall woman in an oilskin coat.");
  expect(prompts[0]![0]!.content).toContain(`about ${Math.round(words * 0.75)} words and never over ${words}`);
  expect(prompts[0]![0]!.content).toContain(style === "keywords" ? "comma-separated keyword phrases" : "connected sentences");
});

test("a prompt the text model can't write falls back on its template", async () => {
  const failed = new TextProviderFailed("offline");
  const { written } = write(portrait, "prose", failed, failed, failed);

  expect(await written).toBe("the template");
});

test("the server draws a form's portrait from the written prompt, and shows that prompt for a Redraw", async () => {
  const script = scriptedTextProvider(text("A tall woman in an oilskin coat, facing the viewer."));
  const drawn = scriptedImages(png(1));
  const settings = settingsStore(join(folder.path, "settings.json"));
  app = startApp(join(folder.path, "Saves"), script.textProvider, undefined, undefined, drawn.imageAdapter, (ask, style, fallback, signal) =>
    writePicturePrompt({ textProvider: script.textProvider, settings }, ask, style, fallback, signal),
  );
  await app.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });

  const response = await app.post("/worlds/draw", { kind: "portrait", name: "Ash", physicalTraits: "Tall", inventory: "an oilskin coat", artStyle: "" });
  const { id } = (await response.json()) as { id: string };
  const details = (await (await app.get(`/worlds/${id}/portrait/details`)).json()) as { prompt: string };

  expect(drawn.payloads[0]!.prompt).toBe("A tall woman in an oilskin coat, facing the viewer.");
  expect(details.prompt).toBe("A tall woman in an oilskin coat, facing the viewer.");
  expect(script.prompts[0]![1]!.content).not.toContain("Ash");
});

test("a Cover or portrait follows the Image Instructions, and never the Model Instructions", async () => {
  const script = scriptedTextProvider(text("A tall woman in soft light."));
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ modelInstructions: "model-words", imageInstructions: "image-words" });

  await writePicturePrompt({ textProvider: script.textProvider, settings }, portrait, "prose", "the template", new AbortController().signal);

  const sent = JSON.stringify(script.prompts[0]);
  expect(sent).toContain("image-words");
  expect(sent).not.toContain("model-words");
});
