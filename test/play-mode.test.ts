import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { saveStore } from "../src/save-store";
import type { TextProvider } from "../src/turn-engine";
import { logOf, narration, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;
let savesDir: string;
let app: ReturnType<typeof startApp> | undefined;

const CHOICES = ["I wade on.", "I call for help.", "I climb the wall."];
/** The reply of the call that writes the Choices, apart from the Narrator's reply. */
const chosen = (choices: unknown = CHOICES) => JSON.stringify({ choices });

const play = (...replies: (string | Error)[]) => {
  const script = scriptedTextProvider(...replies);
  app = startApp(savesDir, script.textProvider);
  return { app, ...script };
};

/** A Save in Choices mode with one Turn played. */
async function choosing(...replies: string[]) {
  const script = play(narration("The tide rises."), chosen(), ...replies);
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
  expect(prompts).toHaveLength(1);
  expect(await latestChoices(id)).toBeUndefined();
});

test("in Choices mode the Narrator writes no Choices: they are written apart, by a call sent no secret, and kept with the Messages", async () => {
  const secret = "The harbourmaster hides the stolen bell in the lighthouse.";
  const script = play(narration("The tide rises."), chosen());
  const id = saveStore(savesDir).create({ worldBrief: "A drowned city", pc: { name: "Ash" }, opening: { plotThreads: [secret] } });
  await script.app.patch(`/saves/${id}`, { playMode: "choices" });

  const log = await logOf(async () => {
    const turn = (await script.app.post(`/saves/${id}/turns`, { input: "I wade forward." }).then((r) => r.json())) as { messages: object[] };
    expect(turn.messages.at(-1)).toMatchObject({ role: "narrator", text: "The tide rises.", choices: CHOICES });
  }, "info");

  // The Narrator, who sees the secrets, is asked for none, as its own Choices named them in everyday words.
  expect(schemaKeys(script.schemas[0])).not.toContain("choices");
  expect(JSON.stringify(script.prompts[0])).toContain("stolen bell");
  expect(script.prompts[1]![0]!.content).toContain("You offer the player");
  expect(JSON.stringify(script.prompts[1])).not.toContain("stolen bell");
  expect(await latestChoices(id)).toEqual(CHOICES);
  expect(log).toContain('Choices written apart from the reply {"route":"/saves/:id/turns","save":"');
  expect(log).toContain('"kept":3}');
  expect(await app!.get(`/saves/${id}`).then((r) => r.json())).toMatchObject({ playMode: "choices" });
});

test("the Choices call is sent who the PC is, what they wear and carry, where they are and who they know is there, and no one else", async () => {
  const script = play(narration("The tide rises."), chosen());
  const id = saveStore(savesDir).create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      inventory: { wearing: ["a grey shawl"], carrying: ["a sealed packet"] },
      scene: { location: "The quay", visibleCast: ["Wren", "Corr"] },
      npcs: [
        { name: "Wren", appearance: "a boatwoman" },
        { name: "Corr", appearance: "a stranger" },
      ],
      pcKnown: { facts: [], npcs: ["Wren"] },
    },
  });
  await script.app.patch(`/saves/${id}`, { playMode: "choices" });
  await script.app.post(`/saves/${id}/turns`, { input: "I wade forward." });

  // Without these, Choices took a letter for the PC's own and offered again a deed already done.
  expect(JSON.parse(script.prompts[1]!.at(-1)!.content).pc).toEqual({
    name: "Ash",
    wearing: ["a grey shawl"],
    carrying: ["a sealed packet"],
    place: "The quay",
    present: ["Wren"],
  });
});

test("a Choice that names the PC, written as someone else, is dropped and the others kept", async () => {
  const script = play(narration("The tide rises."), chosen(["I wade on.", "I crouch beside Ash and tell him to keep still.", "I climb the wall."]));
  const id = await script.app.createSave();
  await script.app.patch(`/saves/${id}`, { playMode: "choices" });

  const log = await logOf(() => script.app.post(`/saves/${id}/turns`, { input: "I wade forward." }), "info");

  expect(await latestChoices(id)).toEqual(["I wade on.", "I climb the wall."]);
  expect(log).toContain("Choices naming the PC dropped");
});

test("a Choice where the PC gives their own name is kept", async () => {
  const own = ["I'll answer that I'm Ash and ask his name.", "I shout, “Call me Ash!”", "I tell her my name is Ash."];
  const script = play(narration("A voice calls."), chosen(own));
  const id = await script.app.createSave();
  await script.app.patch(`/saves/${id}`, { playMode: "choices" });

  await script.app.post(`/saves/${id}/turns`, { input: "I listen." });

  expect(await latestChoices(id)).toEqual(own);
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

test("Choices that aren't three different ones are asked for again, and the reply keeps its story", async () => {
  const { id, prompts } = await choosing(narration("Missing."), chosen(["I run."]), chosen());

  const response = await app!.post(`/saves/${id}/turns`, { input: "I look around." });

  expect(response.status).toBe(201);
  expect(prompts).toHaveLength(5);
  // With the player's move as well as the reply, as Choices written from the reply alone were the weakest of a run.
  expect(prompts[3]!.at(-1)!.content).toContain("I look around.");
  expect(((await response.json()) as { messages: object[] }).messages.at(-1)).toMatchObject({ role: "narrator", text: "Missing." });
  expect(await latestChoices(id)).toEqual(CHOICES);
});

test("when fewer than three Choices are left once those built on the unknown are dropped, they are asked for again and merged", async () => {
  // The reviewer answers State Upkeep with nothing.
  const reviewer: TextProvider = async () => JSON.stringify({ state_operations: [] });
  const script = scriptedTextProvider(
    narration("The tide rises."),
    chosen(["I ride for Qasr.", "I climb the wall.", "I wade on."]),
    chosen(["I ride to Qasr at dawn.", "I call for help.", "I wade on."]),
  );
  app = startApp(savesDir, script.textProvider, undefined, undefined, undefined, undefined, undefined, reviewer);
  const id = await app.createSave();
  await app.patch(`/saves/${id}`, { playMode: "choices" });

  const log = await logOf(() => app!.post(`/saves/${id}/turns`, { input: "I wade forward." }), "info");

  expect(script.prompts).toHaveLength(3);
  // The first ask's kept first, then the new ones.
  expect(await latestChoices(id)).toEqual(["I climb the wall.", "I wade on.", "I call for help."]);
  expect(log).toContain("Choices with unknown words dropped");
});

test("a Choice asked for again that takes the same approach as a kept one, in other words, is not added beside it", async () => {
  const reviewer: TextProvider = async () => JSON.stringify({ state_operations: [] });
  const kept = "I turn back the sheet and examine the man's neck and scalp closely.";
  const script = scriptedTextProvider(
    narration("The tide rises."),
    chosen(["I ride for Qasr.", kept, "I wade on."]),
    chosen(["I'll pull back the sheet and examine the man's body closely, writing every mark.", "I call for help.", "I wade on."]),
  );
  app = startApp(savesDir, script.textProvider, undefined, undefined, undefined, undefined, undefined, reviewer);
  const id = await app.createSave();
  await app.patch(`/saves/${id}`, { playMode: "choices" });
  await app.post(`/saves/${id}/turns`, { input: "I wade forward." });

  expect(await latestChoices(id)).toEqual([kept, "I wade on.", "I call for help."]);
});

test("a Turn whose Choices can't be written is kept without any", async () => {
  const repeated = chosen(["I run.", "I run.", " I run. "]);
  const { id, prompts } = await choosing(narration("Repeated."), repeated, repeated, repeated);

  expect((await app!.post(`/saves/${id}/turns`, { input: "I look around." })).status).toBe(201);

  expect(prompts).toHaveLength(6);
  expect(await latestChoices(id)).toBeUndefined();
});

test("Regenerate, Rewrite and Edit each write new Choices", async () => {
  const fresh = (n: number) => CHOICES.map((choice) => `${choice} ${n}`);
  const { id } = await choosing(narration("Again."), chosen(fresh(1)), narration("Rewritten."), chosen(fresh(2)), narration("ignored"), chosen(fresh(3)));

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

test("the log names which Choice was picked by number, and only Story in log shows the Choices' words", async () => {
  // Choices that leave out the one just picked, which would be dropped as a repeat of the player's move.
  const OTHERS = ["I wade on.", "I climb the wall.", "I swim for it."];
  const { id } = await choosing(narration("The wall holds."), chosen(OTHERS), narration("The rope frays."), chosen(OTHERS));

  const quiet = await logOf(() => app!.post(`/saves/${id}/turns`, { input: CHOICES[1] }), "info");
  expect(quiet).toContain('Choice picked {"route":"/saves/:id/turns","save":"');
  expect(quiet).toContain('"choice":2}');
  expect(quiet).not.toContain(CHOICES[0]!);

  await app!.patch("/settings", { storyInLog: true });
  const told = await logOf(() => app!.post(`/saves/${id}/turns`, { input: "I shout at the tide." }), "info");
  expect(told).toContain('"choice":"own words"');
  expect(told).toContain(`Choices offered {"route":"/saves/:id/turns","save":"${id}","choices":${JSON.stringify(OTHERS)}}`);
});
