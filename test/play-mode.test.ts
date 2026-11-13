import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { saveStore } from "../src/save-store";
import { narration, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let app: ReturnType<typeof startApp> | undefined;

const CHOICES = ["I wade on.", "I call for help.", "I climb the wall."];
const withChoices = (text: string, choices: unknown = CHOICES) => JSON.stringify({ narration: text, state_operations: [], choices });

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  app = startApp(savesDir, script.textProvider);
  return { app, ...script };
};

/** A Save in Choices mode with one Turn played. */
async function choosing(...replies: string[]) {
  const script = play(withChoices("The tide rises."), ...replies);
  const id = await script.app.createSave();
  await script.app.patch(`/saves/${id}`, { playMode: "choices" });
  const turn = await script.app.post(`/saves/${id}/turns`, { input: "I wade forward." }).then((r) => r.json());
  return { ...script, id, turn };
}

const latestChoices = (id: string) => app!.get(`/saves/${id}/messages`).then(async (r) => ((await r.json()) as { choices?: string[] }).choices);
const schemaKeys = (schema: unknown) => Object.keys((schema as { properties: object }).properties);

beforeEach(() => {
  folder = tempFolder();
  savesDir = join(folder.path, "Saves");
});

afterEach(async () => {
  await app?.stop();
  folder.remove();
});

test("a Save starts in Free Text, whose Narrator is asked for no Choices and whose responses store none", async () => {
  const { app, schemas, prompts } = play(narration("The tide rises."));
  const id = await app.createSave();

  expect(await app.get(`/saves/${id}`).then((r) => r.json())).toMatchObject({ playMode: "free" });
  await app.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(schemaKeys(schemas[0])).not.toContain("choices");
  expect(JSON.stringify(prompts[0])).not.toContain("choices");
  expect(await latestChoices(id)).toBeUndefined();
});

test("in Choices mode a response keeps its three Choices, sent last in the schema and with the Messages", async () => {
  const { id, turn, schemas } = await choosing();

  expect(schemaKeys(schemas[0]).at(-1)).toBe("choices");
  expect(turn.messages.at(-1)).toMatchObject({ role: "narrator", text: "The tide rises.", choices: CHOICES });
  expect(await latestChoices(id)).toEqual(CHOICES);
  expect(await app!.get(`/saves/${id}`).then((r) => r.json())).toMatchObject({ playMode: "choices" });
});

test("switching to Free Text and back keeps the latest Choices, and the next Turn ends them", async () => {
  const { id } = await choosing(narration("The wall holds."));

  await app!.patch(`/saves/${id}`, { playMode: "free" });
  expect(await latestChoices(id)).toEqual(CHOICES);
  await app!.patch(`/saves/${id}`, { playMode: "choices" });
  expect(await latestChoices(id)).toEqual(CHOICES);

  await app!.patch(`/saves/${id}`, { playMode: "free" });
  await app!.post(`/saves/${id}/turns`, { input: "I climb." });
  expect(await latestChoices(id)).toBeUndefined();
});

test("a reply without three different Choices is retried, and the last try is kept without any", async () => {
  const { id, prompts } = await choosing(
    narration("Missing."),
    withChoices("Too few.", ["I run."]),
    withChoices("Repeated.", ["I run.", "I run.", " I run. "]),
  );

  const response = await app!.post(`/saves/${id}/turns`, { input: "I look around." });

  expect(response.status).toBe(201);
  expect(prompts).toHaveLength(4);
  expect(((await response.json()) as { messages: object[] }).messages.at(-1)).toEqual({
    id: 4,
    role: "narrator",
    text: "Repeated.",
  });
  expect(await latestChoices(id)).toBeUndefined();
});

test("Regenerate, Rewrite and Edit each write new Choices", async () => {
  const fresh = (n: number) => CHOICES.map((choice) => `${choice} ${n}`);
  const { id } = await choosing(withChoices("Again.", fresh(1)), withChoices("Rewritten.", fresh(2)), withChoices("ignored", fresh(3)));

  await app!.post(`/saves/${id}/messages/2/regenerate`, {});
  expect(await latestChoices(id)).toEqual(fresh(1));
  await app!.post(`/saves/${id}/messages/3/rewrite`, { feedback: "Make it stormy." });
  expect(await latestChoices(id)).toEqual(fresh(2));
  await app!.post(`/saves/${id}/messages/4/edit`, { text: "The storm breaks." });
  expect(await latestChoices(id)).toEqual(fresh(3));
});

test("Choices go with a Save through export and import", async () => {
  const { id } = await choosing();
  const saves = saveStore(savesDir);

  const copy = saves.import(new Uint8Array(saves.export(id)));

  expect(saves.latestChoices(copy)).toEqual(CHOICES);
  expect(saves.read(copy).playMode).toBe("choices");
});

test("a Play Mode that isn't Free Text or Choices is refused", async () => {
  const { app } = play();
  const id = await app.createSave();

  expect((await app.patch(`/saves/${id}`, { playMode: "auto" })).status).toBe(400);
});
