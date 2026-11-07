import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { MIN_CHAPTER_MESSAGES } from "../src/rest-api";
import { scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let app: ReturnType<typeof startApp>;
let prompts: ReturnType<typeof scriptedTextProvider>["prompts"];

beforeEach(() => {
  folder = tempFolder();
});

afterEach(async () => {
  await app?.stop();
  folder.remove();
});

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  prompts = script.prompts;
  app = startApp(join(folder.path, "Saves"), script.textProvider);
};

const reply = (text: string, chapter_ends = false) => JSON.stringify({ narration: text, state_operations: [], chapter_ends });
const title = (text: string) => JSON.stringify({ title: text });
const turn = (id: string, input = "I wait.") => app.post(`/saves/${id}/turns`, { input });
type Chapters = { chapters: { title: string; lastMessage: number | null }[]; offer: boolean };
const chaptersOf = async (id: string) => (await (await app.get(`/saves/${id}/chapters`)).json()) as Chapters;
const close = (id: string) => app.post(`/saves/${id}/chapters`, {});

test("a new story is one open chapter", async () => {
  play();
  const id = await app.createSave();
  expect(await chaptersOf(id)).toEqual({ chapters: [{ title: "", lastMessage: null }], offer: false });
});

test("closing ends the chapter after the latest Message, titled by the model from what the player can read, and the next Turn starts a new one", async () => {
  play(reply("The ferry docks."), title("The Last Ferry"), reply("Rain begins."));
  const id = await app.createSave();
  await turn(id);

  expect((await close(id)).status).toBe(200);
  expect(prompts[1]!.at(-1)!.content).toContain("The ferry docks.");
  expect(JSON.stringify(prompts[1])).not.toContain("A drowned city");
  expect((await chaptersOf(id)).chapters).toEqual([{ title: "The Last Ferry", lastMessage: 2 }, { title: "", lastMessage: null }]);

  await turn(id);
  expect((await chaptersOf(id)).chapters).toEqual([{ title: "The Last Ferry", lastMessage: 2 }, { title: "", lastMessage: null }]);
  expect(JSON.stringify(prompts[2])).not.toContain("The Last Ferry");
});

test("a second close before any new Message changes nothing, and an empty story has nothing to close", async () => {
  play(reply("The ferry docks."), title("One"), title("Two"));
  const id = await app.createSave();
  expect((await close(id)).status).toBe(409);
  await turn(id);
  await close(id);
  expect((await close(id)).status).toBe(409);
  expect((await chaptersOf(id)).chapters).toHaveLength(2);
});

test("a title the model won't give leaves the chapter closed and untitled, and the player can title it", async () => {
  play(reply("The ferry docks."), "not json", "not json", "not json");
  const id = await app.createSave();
  await turn(id);
  expect((await close(id)).status).toBe(200);
  expect((await chaptersOf(id)).chapters[0]).toEqual({ title: "", lastMessage: 2 });

  await app.post(`/saves/${id}/edits`, { edit: "chapterTitle", index: 0, title: "Arrival" });
  expect((await chaptersOf(id)).chapters[0]).toEqual({ title: "Arrival", lastMessage: 2 });
  expect((await app.post(`/saves/${id}/edits`, { edit: "chapterTitle", index: 1, title: "Nope" })).status).toBe(404);
});

test("a Regenerate after closing keeps the new response in the closed chapter", async () => {
  play(reply("The ferry docks."), title("The Last Ferry"), reply("The ferry docks again."), reply("Rain begins."));
  const id = await app.createSave();
  await turn(id);
  await close(id);
  await app.post(`/saves/${id}/messages/2/regenerate`, {});
  await turn(id);
  expect((await chaptersOf(id)).chapters[0]).toEqual({ title: "The Last Ferry", lastMessage: 3 });
});

test("a Revert to before the close reopens the chapter", async () => {
  play(reply("One."), reply("Two."), title("Both"), reply("Three."));
  const id = await app.createSave();
  await turn(id);
  await turn(id);
  await close(id);
  await turn(id);
  await app.post(`/saves/${id}/messages/2/revert`, {});
  expect((await chaptersOf(id)).chapters).toEqual([{ title: "", lastMessage: null }]);
});

test("the Narrator's suggestion to end the chapter is offered only once the chapter is long enough, and only until the next reply", async () => {
  const turns = MIN_CHAPTER_MESSAGES / 2;
  play(...Array.from({ length: turns }, (_, index) => reply(`Beat ${index}.`, true)), reply("Quiet."), reply("Done.", true), title("Done"), reply("Again.", true));
  const id = await app.createSave();
  for (let index = 0; index < turns - 1; index++) await turn(id);
  expect((await chaptersOf(id)).offer).toBe(false);
  await turn(id);
  expect((await chaptersOf(id)).offer).toBe(true);
  await turn(id);
  expect((await chaptersOf(id)).offer).toBe(false);
  await turn(id);
  expect((await chaptersOf(id)).offer).toBe(true);
  await close(id);
  expect((await chaptersOf(id)).offer).toBe(false);
  await turn(id);
  expect((await chaptersOf(id)).offer).toBe(false);
});
