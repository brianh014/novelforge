import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOperations, openingState } from "../src/state-applier";
import { defaultLevelFor, defaultLogLevel, errorFields, log, setLogLevel, startLog, withLogContext } from "../src/logger";
import { saveStore } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { reportEvent } from "../src/web/api";
import { delta, fakeOpenAi, logOf, narration, png, postJson, scriptedImages, scriptedTextProvider, startApp, tempFolder } from "./support";

let folder: ReturnType<typeof tempFolder>;

beforeEach(() => {
  folder = tempFolder();
});

afterEach(() => {
  startLog("warning");
  setLogLevel(undefined);
  folder.remove();
});

test("a line has the time, level, area, message and fields as JSON, in that order, and each level has its console method", async () => {
  const written = (["error", "warn", "info", "debug"] as const).map((method) => spyOn(console, method).mockImplementation(() => {}));
  setLogLevel("verbose");

  log.error("area", "one", { a: 1 });
  log.warning("area", "two");
  log.info("area", "three");
  log.verbose("area", "four");

  expect(written.map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1]);
  expect(written[0]!.mock.calls[0]![0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z ERROR area one \{"a":1\}$/);
  for (const spy of written) spy.mockRestore();
});

test("a line below the Log Level never builds its fields, and each level includes those above it", async () => {
  let built = 0;
  const line = await logOf(async () => {
    log.verbose("area", "too quiet", () => ({ built: ++built }));
    log.error("area", "heard");
    log.warning("area", "heard too");
  }, "warning");

  expect(built).toBe(0);
  expect(line).toContain("heard too");
  expect(line).toContain("heard");
});

test("nothing a logger is given can throw", async () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const line = await logOf(async () => {
    log.error("area", "circular", circular);
    log.error("area", "bigint", { big: 1n });
    log.error("area", "a throwing field", () => {
      throw new Error("no");
    });
    log.error("area", "still going");
  });

  expect(line).toContain("unserializable");
  expect(line).toContain("still going");
});

test("context reaches every line it causes, and an error's cause and a parser's words never do", async () => {
  const error = new Error("the message", { cause: new Error("the prompt") });

  const line = await logOf(() =>
    withLogContext({ save: "s1" }, async () => {
      await Bun.sleep(1);
      log.error("area", "later", errorFields(error));
    }),
  );

  expect(line).toContain('"save":"s1"');
  expect(line).toContain("the message");
  expect(line).not.toContain("the prompt");
  expect(errorFields(new SyntaxError("Unexpected token the story"))).toEqual({ type: "SyntaxError" });
});

test("the default is Verbose on a debug build and Warning on a compiled one", () => {
  expect(defaultLevelFor(false)).toBe("verbose");
  expect(defaultLevelFor(true)).toBe("warning");
});

test("a saved Log Level beats the default and applies at once, and clearing it follows the default again", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const level = () => app.get("/settings").then((r) => r.json()) as Promise<{ logLevel: string | null; defaultLogLevel: string }>;
  const stored = () => JSON.parse(readFileSync(join(folder.path, "settings.json"), "utf8"));
  startLog("verbose");
  const printed = spyOn(console, "error").mockImplementation(() => {});

  expect(await level()).toEqual(expect.objectContaining({ logLevel: null, defaultLogLevel: "verbose" }));

  await app.patch("/settings", { fontSize: "large" });
  expect(stored()).not.toHaveProperty("logLevel");

  const debug = spyOn(console, "debug").mockImplementation(() => {});
  await app.patch("/settings", { logLevel: "error" });
  expect((await level()).logLevel).toBe("error");
  debug.mockClear();
  log.verbose("area", "silent");
  expect(debug).not.toHaveBeenCalled();

  await app.restart();
  debug.mockClear();
  log.verbose("area", "silent after a restart");
  expect(debug).not.toHaveBeenCalled();

  await app.patch("/settings", { logLevel: null });
  expect(stored()).not.toHaveProperty("logLevel");
  expect(defaultLogLevel()).toBe("verbose");
  debug.mockClear();
  log.verbose("area", "heard");
  expect(debug).toHaveBeenCalled();

  debug.mockRestore();
  printed.mockRestore();
  await app.stop();
});

test("a Settings change logs the names of the fields it changed, and no value", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);

  const line = await logOf(async () => {
    await app.patch("/settings", { textApiKey: "ZQX-KEY", theme: "system", modelInstructions: "ZQX-WORDS" });
  });

  expect(line).toContain('"fields":["textApiKey","modelInstructions"]');
  expect(line).not.toContain("ZQX");
  await app.stop();
});

test("a request logs its route pattern and the Save it's about, never the real path", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const id = await app.createSave();

  const line = await logOf(async () => {
    await app.get(`/saves/${id}/status`);
    await app.get("/saves/not-a-uuid-secret/status");
  });

  expect(line).toContain('"route":"/saves/:id/status"');
  expect(line).toContain(`"save":"${id}"`);
  expect(line).toContain('"status":200');
  expect(line).not.toContain("not-a-uuid-secret");
  await app.stop();
});

test("a story that isn't a Save yet is never named as one", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const world = crypto.randomUUID();

  const line = await logOf(() => app.get(`/worlds/${world}/cover`));

  expect(line).toContain('"route":"/worlds/:id/cover"');
  expect(line).not.toContain(world);
  await app.stop();
});

test("an older Save logs its upgrade only once it's done", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const open = async (id: string) => logOf(() => app.get(`/saves/${id}`));
  const older = (id: string, change: string) => {
    using db = new Database(join(folder.path, "Saves", `${id}.sqlite`));
    db.run(change);
  };
  const upgrades = await app.createSave();
  older(
    upgrades,
    "ALTER TABLE save DROP COLUMN art_style; ALTER TABLE save DROP COLUMN starting_hook; ALTER TABLE save DROP COLUMN pc_details; PRAGMA user_version = 1",
  );
  // Its columns are all there already, so the step that adds one fails.
  const fails = await app.createSave();
  older(fails, "PRAGMA user_version = 1");

  expect(await open(upgrades)).toMatch(/INFO saves Save upgraded .*"from":1/);
  expect(await open(fails)).not.toContain("Save upgraded");
  await app.stop();
});

test("a refused operation gives a reason, and a repeat is counted, not refused", () => {
  const { refused } = applyOperations(openingState, [
    { op: "remove_item", item: "ZQX" },
    { op: "update_npc", name: "ZQX", appearance: "tall" },
  ]);
  expect(refused).toEqual([
    { op: "remove_item", reason: "not held" },
    { op: "update_npc", reason: "no such NPC" },
  ]);

  const fact = { op: "add_known_fact", fact: "ZQX" } as const;
  expect(applyOperations(openingState, [fact, fact, fact])).toMatchObject({ refused: [], repeats: 2 });
});

test("a stranger with no record or a repeated status is ignored, so the Turn isn't thrown away", () => {
  const status = { op: "add_status", kind: "conditions", text: "tired" } as const;
  const { next, refused, ignored } = applyOperations(openingState, [
    { op: "add_known_npc", name: "ZQX" },
    { op: "set_known_npc_summary", name: "ZQX", summary: "A stranger." },
    status,
    status,
  ]);

  expect(refused).toEqual([]);
  expect(ignored.map(({ reason }) => reason)).toEqual(["no such NPC", "NPC not known", "already there"]);
  expect(next.pcKnown.npcs).not.toContain("ZQX");
});

test("a refused Turn logs why, a retry its generation, and a repeat a count", async () => {
  const provider = fakeOpenAi([
    [`data: ${JSON.stringify({ id: "gen-bad", choices: [{ delta: { content: narration("ZQX", { op: "remove_item", item: "ZQX" }) } }] })}\n\n`],
    [delta(narration("A line.", { op: "add_known_fact", fact: "ZQX" }, { op: "add_known_fact", fact: "ZQX" }))],
  ]);
  const settingsPath = join(folder.path, "settings.json");
  const app = startApp(join(folder.path, "Saves"), textProvider(settingsStore(settingsPath)));
  await app.patch("/settings", { textBaseUrl: provider.baseUrl, textModel: "fake/model" });
  const id = await app.createSave();

  const line = await logOf(() => app.post(`/saves/${id}/turns`, { input: "ZQX" }).then((r) => r.text()));

  expect(line).toContain("refused operations: remove_item: not held");
  expect(line).toContain('"generation":"gen-bad"');
  expect(line).toMatch(/Repeats ignored .*"count":1/);
  expect(line).toContain('"kind":"turn"');
  expect(line).toContain(`"save":"${id}"`);
  expect(line).not.toContain("ZQX");
  provider.stop();
  await app.stop();
});

test("the page's events land in the log marked as the page's, and anything else gets a 400", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const id = crypto.randomUUID();
  const send = (body: unknown) => app.post("/log", body).then((r) => r.status);

  const line = await logOf(async () => {
    expect(await send({ event: "stream-lost", save: id, after: 4, returned: 1 })).toBe(204);
    expect(await send({ event: "page-error", line: 3, column: 9 })).toBe(204);
    expect(await send({ event: "made-up" })).toBe(400);
    expect(await send({ event: "page-error", message: "ZQX story" })).toBe(400);
    expect(await send({ event: "stream-lost", after: "ZQX" })).toBe(400);
    expect(await send({ event: "stream-lost", save: "ZQX" })).toBe(400);
    expect(await send({ event: "stream-lost", after: 1, pad: "x".repeat(5000) })).toBe(400);
  });

  expect(line).toMatch(/INFO page stream-lost .*"after":4/);
  expect(line).toContain(id);
  expect(line).toMatch(/ERROR page page-error/);
  expect(line).not.toContain("ZQX");

  const form = await fetch(app.url("/log"), { method: "POST", body: '{"event":"page-error"}' });
  expect(form.status).toBe(400);
  await app.stop();
});

test("a failed report never bothers the player", async () => {
  const unreachable = spyOn(globalThis, "fetch").mockImplementation((() => Promise.reject(new Error("gone"))) as unknown as typeof fetch);

  expect(() => reportEvent("stream-lost")).not.toThrow();
  await Bun.sleep(1);

  unreachable.mockRestore();
});

test("lines also go to the log file, at the same level, and it rotates at 10 MB keeping one older file", async () => {
  const logs = join(folder.path, "logs");
  const file = join(logs, "novelforge.log");
  const quiet = spyOn(console, "warn").mockImplementation(() => {});
  const silent = spyOn(console, "error").mockImplementation(() => {});

  startLog("warning", logs);
  log.warning("area", "kept");
  log.info("area", "below the level");
  const written = readFileSync(file, "utf8");
  expect(written).toContain("kept");
  expect(written).not.toContain("below the level");
  if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);

  for (const pass of ["first", "second"]) {
    writeFileSync(file, "x".repeat(10 * 1024 * 1024));
    startLog("warning", logs);
    log.warning("area", pass);
    expect(readFileSync(file, "utf8")).toContain(pass);
    expect(statSync(file).size).toBeLessThan(1000);
  }
  expect(readdirSync(logs).toSorted()).toEqual(["novelforge.log", "novelforge.log.1"]);

  quiet.mockRestore();
  silent.mockRestore();
});

test("a log file that can't be written leaves the console, and warns once", async () => {
  const blocked = join(folder.path, "blocked");
  writeFileSync(blocked, "a file where the folder should be");
  const warned = spyOn(console, "warn").mockImplementation(() => {});

  startLog("warning", blocked);
  log.warning("area", "one");
  log.warning("area", "two");

  const lines = warned.mock.calls.map(([line]) => String(line));
  expect(lines.filter((line) => line.includes("Can't write the log file"))).toHaveLength(1);
  expect(lines.filter((line) => /area (one|two)/.test(line))).toHaveLength(2);
  expect(existsSync(join(blocked, "novelforge.log"))).toBe(false);
  warned.mockRestore();
});

test("no console call lives outside the logger, page included", () => {
  const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync("src")].filter((file) => !file.endsWith("logger.ts"));
  expect(files.length).toBeGreaterThan(20);
  for (const file of files) expect([file, /\bconsole\./.test(readFileSync(join("src", file), "utf8"))]).toEqual([file, false]);
});

test("a Save's life logs at Info, and a refused import at Error", async () => {
  const app = startApp(join(folder.path, "Saves"), scriptedTextProvider().textProvider);
  const id = await app.createSave();

  const line = await logOf(async () => {
    const file = await app.get(`/saves/${id}/export`).then((r) => r.bytes());
    await fetch(app.url("/saves/import"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    await fetch(app.url("/saves/import"), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "ZQX not a Save" });
    await postJson(app.url(`/saves/${id}/duplicate`), {});
    await app.delete(`/saves/${id}`);
  });

  for (const said of ["Save exported", "Save imported", "Save duplicated", "Save deleted"]) expect(line).toMatch(new RegExp(`INFO saves ${said}`));
  expect(line).toMatch(/ERROR saves A Save was refused/);
  expect(line).not.toContain("ZQX");
  await app.stop();
});

const hide = (kind: string) => `ZQX-${kind}-a-long-enough-mark`;
const SECRETS = ["BIBLE", "THREAD", "RULE", "NARRATION", "INPUT", "FEEDBACK", "CHANGE", "WORDS", "IMAGEPROMPT", "NEWLORE", "APIKEY"].map(hide);

test("a Turn, Rewrite, World Change and Requested Image log none of the story at Verbose, even when providers fail and echo it", async () => {
  const echo = (mark: string) => Response.json({ error: { message: `You sent: ${mark}` } }, { status: 500 });
  const turnReply = (visual_description: string) => [
    delta(
      JSON.stringify({
        check: null,
        narration: hide("NARRATION"),
        state_operations: [{ op: "set_scene", location: "A place", visible_cast: [] }],
        scene_changed: true,
        visual_description,
      }),
    ),
  ];
  const provider = fakeOpenAi([
    echo(hide("BIBLE")),
    [delta(`prose with ${hide("NARRATION")} and no JSON`)],
    turnReply(hide("IMAGEPROMPT")),
    new Response(`{"error":{"message":"bad ${hide("INPUT")}"}}`, { status: 500 }),
    turnReply(hide("IMAGEPROMPT")),
    echo(hide("THREAD")),
    [
      delta(
        JSON.stringify({
          lore_entries: [{ title: hide("NEWLORE"), keywords: ["a", "b", "c"], content: hide("NEWLORE") }],
          removed_lore: [],
          world_rules: [],
          plot_threads: [],
          world_brief: null,
          summary: null,
          facts: [],
          npc_summaries: [],
        }),
      ),
    ],
    echo(hide("RULE")),
    [delta(JSON.stringify({ text: hide("IMAGEPROMPT") }))],
    [delta(JSON.stringify({ text: hide("IMAGEPROMPT") }))],
  ]);
  const images = scriptedImages(new Error(`Image API error: ${hide("IMAGEPROMPT")}`), png(1), new Error(`Image API error: ${hide("IMAGEPROMPT")}`));
  const savesDir = join(folder.path, "Saves");
  const settings = settingsStore(join(folder.path, "settings.json"));
  const app = startApp(savesDir, textProvider(settings), undefined, undefined, images.imageAdapter);
  await app.patch("/settings", {
    textBaseUrl: provider.baseUrl,
    textModel: "fake/model",
    textApiKey: hide("APIKEY"),
    imageModel: "fake/image",
    imageApiKey: hide("APIKEY"),
  });
  const id = saveStore(savesDir).create({
    worldBrief: "A drowned city",
    pc: { name: "Ash" },
    opening: {
      worldBible: [{ title: "Lore", keywords: ["city"], content: hide("BIBLE"), alwaysOn: true }],
      plotThreads: [hide("THREAD")],
      worldRules: [hide("RULE")],
    },
  });
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const { pending } = (await app.get(`/saves/${id}/images`).then((r) => r.json())) as { pending: boolean };
      if (!pending) return;
      await Bun.sleep(5);
    }
  };

  const line = await logOf(async () => {
    expect((await app.post(`/saves/${id}/turns`, { input: hide("INPUT") })).status).toBe(502);
    expect((await app.post(`/saves/${id}/turns`, { input: hide("INPUT") })).status).toBe(201);
    await settled();
    const { messages } = (await app.get(`/saves/${id}/messages`).then((r) => r.json())) as { messages: { id: number }[] };
    const latest = messages.at(-1)!.id;
    expect((await app.post(`/saves/${id}/messages/${latest}/rewrite`, { feedback: hide("FEEDBACK") })).status).toBe(502);
    expect((await app.post(`/saves/${id}/messages/${latest}/rewrite`, { feedback: hide("FEEDBACK") })).status).toBe(201);
    await settled();
    expect((await app.post(`/saves/${id}/world-change`, { change: hide("CHANGE") })).status).toBe(502);
    expect((await app.post(`/saves/${id}/world-change`, { change: hide("CHANGE") })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      await app.post(`/saves/${id}/requested-images`, { words: hide("WORDS") });
      await settled();
    }
  });

  for (const secret of SECRETS) expect(line).not.toContain(secret);
  expect(line).not.toContain("ZQX");
  for (const said of [
    "Turn committed",
    "Text Provider error",
    "Image queued",
    "Image started",
    "Image failed",
    '"kind":"rewrite"',
    "World Change applied",
    "A World Change failed",
    "A requested image failed",
  ])
    expect(line).toContain(said);
  provider.stop();
  await app.stop();
});
