import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { settingsStore } from "../src/settings-store";
import { TextProviderFailed } from "../src/turn-engine";
import { coverPrompt } from "../src/image-pipeline";
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
  const written = writePicturePrompt({ textProvider: script.textProvider, settings }, ask, style, new AbortController().signal);
  return { written, prompts: script.prompts };
};

const text = (words: string) => JSON.stringify({ text: words });

test("a Cover's prompt is written whole, Art Style and world included, from only what the player reads, and must letter the title", async () => {
  const { written, prompts } = write(
    cover,
    "prose",
    text("A drowned city at night."),
    text("The Salt Reckoning, a drowned city at night."),
    text(`A drowned city at night, its title "The Salt Reckoning" lettered above.`),
  );

  expect(await written).toBe(`A drowned city at night, its title "The Salt Reckoning" lettered above.`);
  expect(prompts).toHaveLength(3);
  const [system, user] = prompts[0]!;
  expect(system!.content).toContain("front cover of a novel");
  expect(system!.content).toContain("about 170 words and never over 250");
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

test("a prompt the text model can't write fails with a reason to show, and nothing is drawn from a template", async () => {
  const failed = new TextProviderFailed("offline");
  const { written } = write(portrait, "prose", failed, failed, failed);

  expect(written).rejects.toThrow("The text model couldn't write this picture's prompt. Try again.");
});

test("the server draws a form's portrait from the written prompt, and shows that prompt for a Redraw", async () => {
  const script = scriptedTextProvider(text("A tall woman in an oilskin coat, facing the viewer."));
  const drawn = scriptedImages(png(1));
  const settings = settingsStore(join(folder.path, "settings.json"));
  app = startApp(join(folder.path, "Saves"), script.textProvider, undefined, undefined, drawn.imageAdapter, (ask, style, _template, signal) =>
    writePicturePrompt({ textProvider: script.textProvider, settings }, ask, style, signal),
  );
  await app.patch("/settings", { imageModel: "fake/image", imageApiKey: "image-key" });

  const response = await app.post("/worlds/draw", { kind: "portrait", name: "Ash", physicalTraits: "Tall", inventory: "an oilskin coat", artStyle: "" });
  const { id } = (await response.json()) as { id: string };
  const details = (await (await app.get(`/worlds/${id}/portrait/details`)).json()) as { prompt: string };

  expect(drawn.payloads[0]!.prompt).toBe("A tall woman in an oilskin coat, facing the viewer.");
  expect(details.prompt).toBe("A tall woman in an oilskin coat, facing the viewer.");
  expect(script.prompts[0]![1]!.content).not.toContain("Ash");
});

test("a Cover's title may be lettered in capitals", async () => {
  const { written, prompts } = write(cover, "prose", text(`A drowned city, "THE SALT RECKONING" lettered above.`));

  expect(await written).toBe(`A drowned city, "THE SALT RECKONING" lettered above.`);
  expect(prompts).toHaveLength(1);
});

test("a Cover's template takes only the opening of a long world and of each person", () => {
  const long = coverPrompt({ title: "The Salt Reckoning", theme: "Western", world: `Rain never stops. ${"word ".repeat(500)}`, people: [`Tall.

${"more ".repeat(500)}`] });

  expect(long).toContain("Rain never stops.");
  expect(long).toContain("(Tall. more");
  expect(long.split(/\s+/).length).toBeLessThan(300);
});

test("a nudge is the player's request for that picture, which the prompt must show", async () => {
  const { written, prompts } = write({ ...portrait, nudge: "smiling" }, "prose", text("A tall woman, smiling."));

  expect(await written).toBe("A tall woman, smiling.");
  expect(prompts[0]![0]!.content).toContain("nudge is the player's own request for this picture");
  expect(JSON.parse(prompts[0]![1]!.content)).toMatchObject({ nudge: "smiling" });
  const plain = write(portrait, "prose", text("A tall woman."));
  await plain.written;
  expect(plain.prompts[0]![0]!.content).not.toContain("nudge");
});

test("an Update's portrait prompt is an edit of the old portrait, saying what changes and to keep the rest", async () => {
  const { written, prompts } = write({ ...portrait, was: "A tall woman in a green shirt." }, "prose", text("Replace the green shirt with an oilskin coat. Keep everything else the same."));

  expect(await written).toBe("Replace the green shirt with an oilskin coat. Keep everything else the same.");
  const system = prompts[0]![0]!.content;
  expect(system).toContain("The image model is given the portrait that was describes, and edits it.");
  expect(system).not.toContain("Open the prompt with the picture's art style");
  expect(system).not.toContain("never what isn't");
  expect(JSON.parse(prompts[0]![1]!.content)).toMatchObject({ was: "A tall woman in a green shirt.", looks: portrait.looks });
  const whole = write(portrait, "prose", text("A tall woman."));
  await whole.written;
  expect(whole.prompts[0]![0]!.content).not.toContain("edits it");
});

test("a Cover or portrait follows the Image Instructions, and never the Model Instructions", async () => {
  const script = scriptedTextProvider(text("A tall woman in soft light."));
  const settings = settingsStore(join(folder.path, "settings.json"));
  settings.update({ modelInstructions: "model-words", imageInstructions: "image-words" });

  await writePicturePrompt({ textProvider: script.textProvider, settings }, portrait, "prose", new AbortController().signal);

  const sent = JSON.stringify(script.prompts[0]);
  expect(sent).toContain("image-words");
  expect(sent).not.toContain("model-words");
});
