// The Narrator bench: plays bench/worlds/adventure.json in Choices mode on the real models from a Settings file, through the real server,
// (each play in a process of its own, all at once unless the Narrator is a local model) and records what every Narrator feature did, how long each step took, what it cost, and a judge's scores. It costs real money,
// so it asks before it starts. The real AI writes every Image Prompt, to be judged, but a stand-in draws it, unless --draw.
//   bun bench run --rounds N --runs M [--settings bench/settings.json] [--judge self|narrator] [--label name] [--seed 1] [--yes]
//   bun bench run --moves moves.txt --runs M [...]   plays in Free Text instead, one move per line (# starts a comment), to
//                                                    steer the story a chosen way; the rounds are the moves
//   bun bench run --world <file> [...]   plays another world shaped like bench/worlds/adventure.json, such as one kept out of git
//   bun bench run --draw [...]   draws the pictures on the Settings file's local ComfyUI, never a paid API, into each play's
//                                pictures folder, to judge the pictures themselves
//   bun bench run --keep-save [...]   keeps each play's Saves folder in its run folder, to open or play on later
//   bun bench run --from <Saves folder> --world <its world> [...]   plays on from a kept Save for --rounds more, with no
//                                                                   opening, numbering rounds after those it has
//   bun bench judge <run folder> --by <model> --scores <scores.json>   (scores for a --judge self run, one entry per play)
//   bun bench keep <run folder>        copies the run's numbers, never its story, to bench/results to commit
//   bun bench table [--csv]            every kept and recent run, side by side
//   bun bench chart [--rounds N]       the kept, judged, drawn Choices runs of one length (45) as charts, with a pick of bench
//                                      version, score and story, to bench/charts/bench-chart.html
// To bench a setup without editing the Settings copy: --narrator <model>, --narrator-only (no other Scribe) and
// --reviewer <model>, the Scribe. The copy's pinned provider stays, so a model it doesn't offer fails, never reroutes.
//   --host <provider>   pins the OpenRouter provider (DeepInfra, say) with no fallback, on the copy only, for the Narrator and
//                       a Scribe on the same server.
//   --reviewer-anywhere  leaves the Scribe unpinned, on the same server, for a Scribe the Narrator's host doesn't offer.
//   --review-thinking <same|default|low|medium|high>   the Scribe's Thinking, on the copy only.
// Each result and transcript header records the host.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { fakeImages, fakeTextProvider } from "../src/fake-services";
import { setLogLevel, startLog } from "../src/logger";
import { CONTINUE } from "../src/prompt-assembler";
import { startServer } from "../src/rest-api";
import { MAX_NPC_KNOWS, type State, StateOperation } from "../src/state-applier";
import { saveStore } from "../src/save-store";
import { localIsSetUp } from "../src/graph-builder";
import { reviewerSettings, settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { VERSION } from "../src/updater";
import { askForJson, type TextProvider, worldMoved } from "../src/turn-engine";
import { chartPage } from "./chart";
import { resultFiles } from "./result-files";
import { capsOf, GENRES, type GenreKey, JUDGE_RULES, JudgeReply, MISTAKES, RUBRIC, RUBRIC_VERSION, scorePlay } from "./rubric";
import { stateFaults } from "./state-checks";
import { type Call, tokenTable, tokenUse } from "./token-use";

const BENCH = import.meta.dir;
// The world a run plays without --world. Results from before it had a name of its own recorded it as "world.json".
const DEFAULT_WORLD = "adventure.json";
// The app's version, then the iteration on it: bump the iteration whenever the prompts, the rubric, a world or how a Turn is
// checked and retried change, and start it again at 1 when the app's version changes. A chart compares only runs of one version.
const BENCH_ITERATION = 2;
const BENCH_VERSION = `${VERSION}.${BENCH_ITERATION}`;
// The length a chart compares, as a longer story scores differently; runs of another length are left out.
const CHART_ROUNDS = 45;
// --fake plays on the stand-in models, free and offline, to try the bench itself; its numbers say nothing of a real Narrator.
const fake = process.argv.includes("--fake");
// --draw draws on local ComfyUI, which costs nothing per picture; a paid image API is never drawn on.
const draw = process.argv.includes("--draw");
// Keeps each play's Saves in its folder, to open or play on later, as a long story to test against.
const keepSave = process.argv.includes("--keep-save");
// A kept Saves folder to play on from, as long play is tested by going on from a judged run.
const fromSaves = process.argv.includes("--from") ? resolve(process.argv[process.argv.indexOf("--from") + 1]!) : undefined;
const narratorOf = (settings: ReturnType<typeof settingsStore>) => (fake ? fakeTextProvider : textProvider(settings));
const RUNS = join(BENCH, "runs");
const RESULTS = join(BENCH, "results");
const World = z.object({
  save: z.object({
    title: z.string(),
    theme: z.string(),
    artStyle: z.string(),
    worldBrief: z.string(),
    startingHook: z.string(),
    pc: z.object({ name: z.string() }).catchall(z.string()),
    importantCharacters: z.array(z.object({ name: z.string(), description: z.string(), onCover: z.boolean() })),
  }),
  opening: z.record(z.string(), z.unknown()),
  actions: z.object({ rewrite: z.string(), edit: z.string(), worldChange: z.string() }),
  /** Extra judging rules for this world alone, added after the shared rubric, such as what a world-specific score should weigh. */
  judge: z.string().optional(),
  /** The genre scores (keys of GENRES) every play of this world must get, as the story was written for them. */
  genres: z.array(z.string()).optional(),
  /** The Model and Image Instructions this world plays with. The player's own are never used, so runs compare on every machine. */
  modelInstructions: z.string().optional(),
  imageInstructions: z.string().optional(),
});

/** Each feature the bench looks for, and how a play shows it fired. Judged ones come from the judge's `happened`. */
const COVERAGE: [string, string[]][] = [
  ["Hidden Check", ["checks.asked"]],
  ["Plot Thread added", ["ops.add_plot_thread", "moves.added"]],
  ["Plot Thread moved on", ["ops.update_plot_thread", "moves.rewritten"]],
  ["Plot Thread resolved", ["ops.resolve_plot_thread", "moves.removed"]],
  ["NPC learns (npcKnows)", ["ops.npc_learns", "upkeep.npc_learns"]],
  ["Known fact added", ["ops.add_known_fact"]],
  ["Known fact changed", ["ops.update_known_fact", "ops.remove_known_fact", "upkeep.update_known_fact", "upkeep.remove_known_fact"]],
  ["Known NPC summary", ["ops.set_known_npc_summary"]],
  ["Loose End added", ["ops.add_loose_end"]],
  ["Loose End resolved", ["ops.resolve_loose_end", "upkeep.resolve_loose_end"]],
  ["World Bible grew", ["ops.add_lore_entry", "lore.added"]],
  ["World Bible entry updated", ["ops.update_lore_entry"]],
  ["New NPC", ["ops.add_npc"]],
  ["NPC look changed", ["ops.update_npc", "upkeep.update_npc"]],
  ["Scene moved", ["ops.set_scene", "upkeep.set_scene"]],
  ["Item picked up or put on", ["ops.add_item", "upkeep.add_item"]],
  ["Item lost or taken off", ["ops.remove_item", "upkeep.remove_item"]],
  ["Story Time moved", ["ops.set_story_time", "upkeep.set_story_time"]],
  ["PC hurt or changed", ["ops.set_health", "ops.add_status", "ops.set_pc_appearance"]],
  ["Scene picture", ["images.scene"]],
  ["Portrait", ["images.portrait"]],
  ["Scene Memory", ["end.sceneMemories"]],
  ["Chapter closed", ["chapters.closed"]],
  ["State Upkeep changed state", ["upkeep.total"]],
  ["World Change", ["actions.worldChange"]],
  ["Rewrite", ["actions.rewrite"]],
  ["Regenerate", ["actions.regenerate"]],
  ["Continue", ["actions.continue"]],
  ["Edit", ["actions.edit"]],
  ["An NPC died (judged)", ["judged.npcDied"]],
  ["PC in mortal danger and lived (judged)", ["judged.pcInMortalDanger"]],
];

/** The headline numbers a comparison and the table show. Every number is in result.json. */
const HEADLINE = [
  "turns",
  "retries",
  "failed",
  "checks.asked",
  "ops.update_plot_thread",
  "ops.resolve_plot_thread",
  "moves.rewritten",
  "moves.added",
  "moves.removed",
  "moves.failed",
  "ops.npc_learns",
  "ops.add_lore_entry",
  "ops.add_loose_end",
  "ops.resolve_loose_end",
  "upkeep.total",
  "coverage.fired",
  "timing.firstText.median",
  "timing.reply.median",
  "timing.reply.max",
  "timing.turn.median",
  "timing.turn.max",
  "timing.upkeep.median",
  "timing.picture.median",
  "images.scene",
  "images.portrait",
  "cost.perRound",
  "cost.total",
  "stateFaults.total",
  // The tally first: what a reader would notice, less noisy than any score.
  "mistakes.major",
  "mistakes.minor",
  ...Object.keys(RUBRIC).map((key) => `judge.${key}`),
  "judge.craft",
  "judge.overall",
  ...Object.keys(GENRES).map((key) => `judge.${key}`),
];

type Flat = Record<string, number>;
type Result = {
  /** BENCH_VERSION when it ran: the app's version and the iteration on it, or a plain number before that scheme. Absent on runs before either. */
  version?: string | number;
  /** The Narrator alone (no other Scribe), or with a Scribe chosen. */
  setup?: "narrator" | "full";
  date: string;
  label: string;
  commit: string;
  provider: string;
  /** `consistency` only on runs from before the Consistency check was removed, "off" when it was. */
  models: { narrator: string; reviewer: string; reviewThinking: string; consistency?: string };
  /** The OpenRouter provider the Narrator's calls were pinned to (--host or the Settings copy's own), with no fallback when `hostFallback` is false. Absent when unpinned. */
  host?: string;
  hostFallback?: boolean;
  /** Seeded Choices, or Free Text from a moves file, which runs compare only within. */
  mode?: string;
  /** Plays that failed and were left out, when any did; `runs` then counts only those kept. */
  failedPlays?: number[];
  /** The world file played, by name, as runs compare only on one world. Absent on runs before --world, which played the adventure. */
  world?: string;
  /** Whether the pictures were drawn (--draw), so judged as pictures, or judged from their prompts alone. Absent on older runs. */
  drawn?: boolean;
  thinking: string;
  seed: number;
  rounds: number;
  runs: number;
  estimate: number | null;
  summary: Flat;
  range: Record<string, [number, number]>;
  coverage: Record<string, number>;
  judge: { by: string; plays: JudgeReply[] } | null;
  /** RUBRIC_VERSION it was judged by; absent on runs judged before the second, whose scores don't compare. */
  rubric?: number;
  plays: Flat[];
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const count = (name: string) => {
  const value = Number(option(name));
  if (!Number.isInteger(value) || value < 1) fail(`${name} is required: a whole number of at least 1.`);
  return value;
};
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const safe = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, "-") || "none";
const median = (values: number[]) => (values.length ? values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]! : 0);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const providerOf = (url: string) =>
  url.includes("openrouter.ai")
    ? "openrouter"
    : url.includes("nano-gpt.com")
      ? "nanogpt"
      : url.includes("generativelanguage")
        ? "google"
        : /localhost|127\.0\.0\.1/.test(url)
          ? "local"
          : safe(new URL(url).host);

/** A small seeded generator (mulberry32), so a play's picks and rolls repeat for the same seed. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Cost estimate ----

// Before any run exists, about what one round sends and gets back, per side, in tokens.
const ROUGH = { narrator: { in: 30_000, out: 2_500 }, reviewer: { in: 5_000, out: 1_000 } };

/** Every run's result, kept and recent, newest first. */
function allResults() {
  const found = resultFiles(RESULTS, RUNS).map((path) => ({ path, result: JSON.parse(readFileSync(path, "utf8")) as Result }));
  // A kept run is listed once, as kept; results are walked first.
  const unique = found.filter(({ result }, at) => found.findIndex((other) => other.result.date === result.date) === at);
  return unique.toSorted((a, b) => b.result.date.localeCompare(a.result.date));
}

// shortcut: prices come from OpenRouter's public list only; other providers show "cost unknown", add their lists if players bench there.
async function pricesOf(models: string[]) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
    const { data } = z
      .object({ data: z.array(z.object({ id: z.string(), pricing: z.object({ prompt: z.coerce.number(), completion: z.coerce.number() }) })) })
      .parse(await response.json());
    return new Map(data.filter(({ id }) => models.includes(id)).map(({ id, pricing }) => [id, pricing]));
  } catch {
    return new Map<string, { prompt: number; completion: number }>();
  }
}

async function estimate(provider: string, narrator: string, reviewer: string, rounds: number, runs: number) {
  if (provider === "local") return { dollars: 0, how: "a local server costs nothing" };
  if (provider !== "openrouter") return { dollars: null, how: "cost unknown: only OpenRouter's prices are looked up" };
  // That Narrator's own, as another model's token counts gave twice the cost.
  const last = allResults().find(({ result }) => result.provider === provider && result.models.narrator === narrator)?.result.summary;
  const perRound = last
    ? {
        narrator: { in: last["perRound.narrator.in"] ?? 0, out: last["perRound.narrator.out"] ?? 0 },
        reviewer: { in: last["perRound.reviewer.in"] ?? 0, out: last["perRound.reviewer.out"] ?? 0 },
      }
    : ROUGH;
  const prices = await pricesOf([narrator, reviewer]);
  const n = prices.get(narrator);
  const r = prices.get(reviewer);
  if (!n || !r) return { dollars: null, how: `cost unknown: no OpenRouter price for ${!n ? narrator : reviewer}` };
  const round = perRound.narrator.in * n.prompt + perRound.narrator.out * n.completion + perRound.reviewer.in * r.prompt + perRound.reviewer.out * r.completion;
  return {
    dollars: round * rounds * runs,
    how: `${last ? "tokens per round from this Narrator's last run" : "a rough guess of tokens per round, as this Narrator has no run yet"}, at OpenRouter's list prices; thinking, caching and retries can make it half to double`,
  };
}

// ---- One play ----

type Side = "narrator" | "reviewer";

/** Each call named by its side and what the app says it is for, so each step's time and cost are told apart. `step` says which step it began in. */
function counted(provider: TextProvider, side: Side, calls: Call[], step = () => 0): TextProvider {
  return async (prompt, request) => {
    const call: Call = { role: `${side}.${request.call ?? "other"}`, ms: 0, in: 0, cached: 0, out: 0, reasoning: 0, cost: 0, step: step() };
    calls.push(call);
    const started = performance.now();
    try {
      return await provider(prompt, {
        ...request,
        onUsage: (usage) => {
          call.in += usage.prompt_tokens ?? 0;
          call.cached += usage.prompt_tokens_details?.cached_tokens ?? 0;
          call.out += usage.completion_tokens ?? 0;
          call.reasoning += usage.completion_tokens_details?.reasoning_tokens ?? 0;
          call.cost += usage.cost ?? 0;
          request.onUsage?.(usage);
        },
      });
    } finally {
      call.ms = performance.now() - started;
    }
  };
}

type Step = {
  round: number;
  action: string;
  input: string;
  ok: boolean;
  status: number;
  /** Until the next move can be sent: the reply, its State Upkeep and Choices. Pictures and World Moves On run on. */
  ms: number;
  firstText?: number;
  /** Until the reply's final text was shown, before its follow-ups. */
  reply?: number;
  hidden: string[];
  offered?: string[];
  /** The reply a bench action wrote, so the transcript can mark it as the bench's. */
  message?: number;
};

/** The hidden changes between two states, for the judge's timeline. Story text, so it stays in the run's transcript. */
function hiddenChanges(before: State, after: State) {
  const lines: string[] = [];
  const diff = (label: string, was: string[], now: string[]) => {
    for (const text of now.filter((item) => !was.includes(item))) lines.push(`${label} added: ${text}`);
    for (const text of was.filter((item) => !now.includes(item))) lines.push(`${label} gone: ${text}`);
  };
  diff("Plot Thread truth", before.plotThreads, after.plotThreads);
  for (const truth of after.plotThreads) {
    const now = after.threadsNow[truth];
    if (now && now !== before.threadsNow[truth]) lines.push(`Plot Thread now, of "${truth.split(" ").slice(0, 8).join(" ")}…": ${now}`);
    const plan = after.threadsPlan[truth];
    if (plan && plan !== before.threadsPlan[truth]) lines.push(`Plot Thread plan, of "${truth.split(" ").slice(0, 8).join(" ")}…": ${plan}`);
  }
  diff("Loose End", before.looseEnds, after.looseEnds);
  for (const name of new Set([...Object.keys(before.npcKnows), ...Object.keys(after.npcKnows)])) {
    const [was, now] = [before.npcKnows[name] ?? [], after.npcKnows[name] ?? []];
    for (const text of now.filter((item) => !was.includes(item))) lines.push(`${name} now knows: ${text}`);
    // Shown too, as a judge took a fact a Regenerate dropped for one it kept.
    // A full list that dropped its oldest for a new one is the cap making room, as judges read "no longer knows" as knowledge wiped.
    const room = was.length >= MAX_NPC_KNOWS && now.length >= MAX_NPC_KNOWS;
    for (const text of was.filter((item) => !now.includes(item))) lines.push(`${name} ${room ? "has dropped, for room" : "no longer knows"}: ${text}`);
  }
  // Its words too, as a long story is judged on lore staying true, and an entry rewritten keeps its title.
  diff(
    "Lore entry",
    before.worldBible.map(({ title, content }) => `${title}: ${content}`),
    after.worldBible.map(({ title, content }) => `${title}: ${content}`),
  );
  diff("World rule", before.worldRules, after.worldRules);
  diff("Director's note", before.directorsNotes, after.directorsNotes);
  diff("Known fact", before.pcKnown.facts, after.pcKnown.facts);
  diff("Known NPC", before.pcKnown.npcs, after.pcKnown.npcs);
  diff(
    "Known NPC summary",
    Object.entries(before.pcKnown.summaries ?? {}).map(([name, text]) => `${name}: ${text}`),
    Object.entries(after.pcKnown.summaries ?? {}).map(([name, text]) => `${name}: ${text}`),
  );
  diff(
    "Looks",
    before.npcs.map(({ name, appearance }) => `${name}: ${appearance}`),
    after.npcs.map(({ name, appearance }) => `${name}: ${appearance}`),
  );
  if (after.pcAppearance !== before.pcAppearance) lines.push(`PC looks now: ${after.pcAppearance}`);
  diff("Wearing", before.inventory.wearing, after.inventory.wearing);
  diff("Carrying", before.inventory.carrying, after.inventory.carrying);
  const status = ({ health, injuries, conditions }: State["status"]) => [health, ...injuries, ...conditions].join("; ");
  if (status(after.status) !== status(before.status)) lines.push(`PC status now: ${status(after.status)}`);
  const time = (at: State["storyTime"]) => (at ? `day ${at.day}, ${at.date}, ${at.timeOfDay}` : "");
  if (time(after.storyTime) !== time(before.storyTime)) lines.push(`Story time now: ${time(after.storyTime)}`);
  if (after.scene.location !== before.scene.location) lines.push(`Scene now: ${after.scene.location}`);
  // What the Narrator reads in place of the Messages it covers, once a long story outgrows the window.
  for (const { firstMessage, lastMessage, text } of after.sceneMemories.filter(
    ({ firstMessage }) => !before.sceneMemories.some((memory) => memory.firstMessage === firstMessage),
  ))
    lines.push(`Scene Memory of Messages ${firstMessage} to ${lastMessage}: ${text}`);
  for (const { title } of after.chapters.slice(before.chapters.length)) lines.push(`Chapter closed: ${title}`);
  return lines;
}

const ACTIONS = ["rewrite", "regenerate", "continue", "edit", "worldChange"] as const;

async function play(
  index: number,
  seed: number,
  rounds: number,
  moves: string[] | undefined,
  settingsPath: string,
  world: z.infer<typeof World>,
  folder: string,
) {
  mkdirSync(folder, { recursive: true });
  const savesDir = join(dirname(settingsPath), `saves-${index}`);
  const settings = settingsStore(settingsPath);
  const calls: Call[] = [];
  const pick = seeded(seed * 1000 + index);
  const roll = seeded(seed * 7919 + index);
  // The log goes to the play's folder, and only warnings and up to the terminal.
  // Never rotated, as the counts below read the whole play from it.
  startLog("verbose", folder, Number.POSITIVE_INFINITY);
  const { info, debug, warn } = console;
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  const server = startServer({
    savesDir,
    settings,
    textProvider: counted(narratorOf(settings), "narrator", calls, () => steps.length),
    reviewProvider: counted(fake ? fakeTextProvider : textProvider(reviewerSettings(settings)), "reviewer", calls, () => steps.length),
    // The real AI writes and checks every Image Prompt, to be judged, but a stand-in draws it, as real pictures cost money and time,
    // unless --draw, which draws on local ComfyUI only.
    imageAdapter: fakeImages,
    localImages: draw && !fake ? undefined : fakeImages,
    dice: () => Math.floor(roll() * 20) + 1,
    nearMissMargin: 3,
    moveWorld: true,
    port: 0,
  });
  setLogLevel("verbose");
  if (fromSaves) cpSync(fromSaves, savesDir, { recursive: true });
  const saves = saveStore(savesDir);
  const id = fromSaves ? saves.list()[0]!.id : saves.create({ ...world.save, playMode: moves ? "free" : "choices", opening: world.opening as Partial<State> });
  // The rounds a kept Save already holds, so the timeline's rounds follow on from them.
  const first = saves.messages(id).filter(({ role }) => role === "player").length;
  const steps: Step[] = [];
  // Each step's states, for the state checks code can make without a judge.
  const changes: { action: string; before: State; after: State }[] = [];

  async function send(round: number, action: string, path: string, body: object, input = "") {
    const before = saves.latestState(id);
    const started = performance.now();
    let firstText: number | undefined;
    let reply: number | undefined;
    let ok = false;
    let status = 0;
    // A request that dies, such as a provider that never answers past fetch's own time limit, is a failed step, not the end of the play.
    try {
      const response = await fetch(new URL(path, server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        // A browser waits as long as the server lets a Turn run; Bun's own 5 minutes ended the step while the Turn ran on, and left every later one busy.
        timeout: false,
        body: JSON.stringify(body),
      });
      ok = response.ok;
      status = response.status;
      if (response.headers.get("content-type")?.includes("event-stream") && response.body) {
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const event = block.match(/^event: (.+)$/m)?.[1];
            if (event === "narration") firstText ??= performance.now() - started;
            if (event === "reply") reply = performance.now() - started;
            if (event === "error") {
              ok = false;
              status = (JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? "{}") as { status?: number }).status ?? 0;
            }
          }
        }
      } else await response.body?.cancel();
    } catch {
      // Status 0 marks it, as the stream may have answered 200 before it died.
      ok = false;
      status = 0;
    }
    const after = saves.latestState(id);
    changes.push({ action, before, after });
    const step: Step = {
      round,
      action,
      input,
      ok,
      status,
      ms: performance.now() - started,
      firstText,
      reply,
      hidden: hiddenChanges(before, after),
    };
    steps.push(step);
    process.stdout.write(`  play ${index} round ${round} ${action}: ${ok ? "ok" : `failed (${status})`} in ${(step.ms / 1000).toFixed(1)} s\n`);
    return step;
  }

  const latestNarrator = () => saves.messages(id).findLast(({ role }) => role === "narrator");
  // Spread across the play, so each comes after some story; a short play may fit fewer.
  const due = new Map(ACTIONS.map((action, at) => [Math.max(1, Math.round((rounds * (at + 1)) / (ACTIONS.length + 1))), action] as const).reverse());
  try {
    // Tried again once, as a player would, since one dropped connection otherwise left the whole play without its opening.
    if (!fromSaves && !(await send(0, "opening", `/saves/${id}/opening`, {})).ok) await send(0, "opening", `/saves/${id}/opening`, {});
    for (let at = 1; at <= rounds; at++) {
      const round = first + at;
      const move = moves?.[at - 1];
      const choices = move === undefined ? saves.latestChoices(id) : undefined;
      // A reply kept without Choices leaves the player to Continue.
      const input = move ?? (choices ? choices[Math.floor(pick() * choices.length)]! : CONTINUE);
      const step = await send(round, move !== undefined ? "move" : choices ? "choice" : "continue (no Choices)", `/saves/${id}/turns`, { input }, input);
      // All three, so a judge can tell whether risky Choices were offered and passed over.
      step.offered = choices;
      const action = due.get(at);
      const narrator = latestNarrator();
      const sent =
        action === "rewrite" && narrator
          ? await send(round, action, `/saves/${id}/messages/${narrator.id}/rewrite`, { feedback: world.actions.rewrite })
          : action === "regenerate" && narrator
            ? await send(round, action, `/saves/${id}/messages/${narrator.id}/regenerate`, {})
            : action === "edit" && narrator
              ? await send(round, action, `/saves/${id}/messages/${narrator.id}/edit`, { text: `${narrator.text}\n\n${world.actions.edit}` })
              : undefined;
      if (sent?.ok) sent.message = latestNarrator()?.id;
      // Tried again once, as the opening is, since one DNS blip otherwise spent the play's only Continue.
      if (action === "continue" && !(await send(round, action, `/saves/${id}/turns`, { input: CONTINUE }, CONTINUE)).ok)
        await send(round, action, `/saves/${id}/turns`, { input: CONTINUE }, CONTINUE);
      if (action === "worldChange") await send(round, action, `/saves/${id}/world-change`, { change: world.actions.worldChange }, world.actions.worldChange);
      const { offer } = (await (await fetch(new URL(`/saves/${id}/chapters`, server.url))).json()) as { offer: boolean };
      if (offer) await send(round, "chapter", `/saves/${id}/chapters`, {});
    }
    // OpenRouter reports some usage a moment after the reply ends, and the last pictures may still be written, or with --draw
    // still drawing, which the count alone can't tell as one picture takes longer than a check.
    // The last move of the world too, as removing the Save under it lost it from the transcript. It stops itself at MOVE_LIMIT.
    await worldMoved(id, new AbortController().signal);
    await Bun.sleep(5000);
    const drawing = async () => ((await (await fetch(new URL(`/saves/${id}/images`, server.url))).json()) as { pending: boolean }).pending;
    for (let waited = 0, seen = -1; waited < 600 && (saves.gallery(id).length !== seen || (await drawing())); waited += 5) {
      seen = saves.gallery(id).length;
      await Bun.sleep(5000);
    }
  } finally {
    await server.stop(true);
    console.info = info;
    console.debug = debug;
    console.warn = warn;
  }

  const lines = readFileSync(join(folder, "inkandthread.log"), "utf8").split("\n");
  const logged = (message: string) =>
    lines.flatMap((line) => {
      const at = line.indexOf(` ${message} {`);
      return at === -1 ? [] : [JSON.parse(line.slice(at + message.length + 2)) as Record<string, unknown>];
    });
  // At 0 rather than missing, so a run shows what never happened.
  const flat: Flat = { rounds, turns: 0, retries: 0, "checks.asked": 0, "upkeep.total": 0 };
  const add = (key: string, by = 1) => (flat[key] = (flat[key] ?? 0) + by);
  // Every operation listed, at 0 if never given, so a run shows what the Narrator never did.
  for (const { shape } of StateOperation.options) flat[`ops.${shape.op.value}`] = 0;
  for (const turn of logged("Turn committed")) {
    add("turns");
    add(`turns.${turn.kind}`);
    add("retries", (turn.attempts as number) - 1);
    const check = turn.check as { outcome: string; difficulty: number } | false;
    if (check) {
      add("checks.asked");
      add(`checks.${check.outcome}`);
      add("checks.difficultySum", check.difficulty);
    }
    for (const op of turn.operations as string[]) add(`ops.${op}`);
    for (const op of (turn.upkeep as string[] | undefined) ?? []) {
      add(`upkeep.${op}`);
      add("upkeep.total");
    }
    add("upkeep.refused", (turn.upkeepRefused as number | undefined) ?? 0);
    if (turn.chapterEnds) add("chapterSuggested");
  }
  flat["checks.difficultyMean"] = flat["checks.asked"] ? (flat["checks.difficultySum"] ?? 0) / flat["checks.asked"] : 0;
  delete flat["checks.difficultySum"];
  // World Moves On changes the threads too, between Turns.
  Object.assign(flat, { "moves.rewritten": 0, "moves.added": 0, "moves.removed": 0 });
  for (const move of logged("World moved on")) {
    const [added, removed] = [move.added as number, move.removed as number];
    add("moves.rewritten", (move.threads as number) - added - removed);
    add("moves.added", added);
    add("moves.removed", removed);
  }
  // The Scribe's Lore at each pause, added by a World Change rather than a Turn's operation.
  flat["lore.added"] = logged("Lore grown").reduce((sum, grown) => sum + (grown.added as number), 0);
  flat["moves.failed"] = logged("World didn't move on").length;
  flat.unusable = logged("Unusable Narrator reply").length;
  flat.failed = steps.filter(({ ok }) => !ok).length;
  flat["chapters.closed"] = logged("Chapter closed").length;
  for (const action of ACTIONS) flat[`actions.${action}`] = steps.filter((step) => step.action === action && step.ok).length;
  const end = saves.latestState(id);
  Object.assign(flat, {
    "end.plotThreads": end.plotThreads.length,
    "end.npcKnows": Object.values(end.npcKnows).flat().length,
    "end.knownFacts": end.pcKnown.facts.length,
    "end.knownNpcs": end.pcKnown.npcs.length,
    "end.looseEnds": end.looseEnds.length,
    "end.sceneMemories": end.sceneMemories.length,
    "end.worldBible": end.worldBible.length,
    "end.npcs": end.npcs.length,
  });
  const played = steps.filter(({ ok, action }) => ok && action !== "chapter" && action !== "worldChange");
  const timing = (key: string, values: number[]) => {
    flat[`timing.${key}.median`] = Math.round(median(values));
    flat[`timing.${key}.max`] = Math.round(Math.max(0, ...values));
  };
  timing(
    "firstText",
    played.flatMap(({ firstText }) => (firstText === undefined ? [] : [firstText])),
  );
  timing(
    "reply",
    played.flatMap(({ reply }) => (reply === undefined ? [] : [reply])),
  );
  timing(
    "turn",
    played.map(({ ms }) => ms),
  );
  timing(
    "upkeep",
    calls.filter(({ role }) => role === "reviewer.upkeep").map(({ ms }) => ms),
  );
  timing(
    "memory",
    calls.filter(({ role }) => role === "narrator.memory").map(({ ms }) => ms),
  );
  timing(
    "picture",
    // Writing or checking an Image Prompt: a Cover's, a portrait's, a scene's or a requested one's.
    calls.filter(({ role }) => role.endsWith("Prompt")).map(({ ms }) => ms),
  );
  const gallery = saves.gallery(id);
  for (const kind of ["scene", "portrait", "requested"]) flat[`images.${kind}`] = gallery.filter((image) => image.kind === kind).length;
  Object.assign(
    flat,
    tokenUse(
      calls,
      steps.flatMap((step, at) => (played.includes(step) ? [at] : [])),
    ),
  );
  Object.assign(
    flat,
    stateFaults(
      changes,
      [...logged("Operations ignored"), ...logged("Upkeep operations dropped")].flatMap(({ reason }) => String(reason).split(", ")),
    ),
  );
  // The last Message, so a judge's mistake can't be placed past the story.
  flat.messages = saves.messages(id).at(-1)?.id ?? 0;
  flat["cost.total"] = calls.reduce((sum, { cost }) => sum + cost, 0);
  flat["cost.perRound"] = flat["cost.total"] / rounds;
  for (const side of ["narrator", "reviewer"] as const) {
    const mine = calls.filter(({ role }) => role.startsWith(`${side}.`));
    flat[`perRound.${side}.in`] = Math.round(mine.reduce((sum, { in: tokens }) => sum + tokens, 0) / rounds);
    flat[`perRound.${side}.out`] = Math.round(mine.reduce((sum, { out }) => sum + out, 0) / rounds);
  }

  const { textHost, textHostFallback } = settings.read();
  const setup = `Narrator host: ${textHost ? `${textHost}${textHostFallback ? ", falling back" : ", no fallback"}` : "any"}.`;
  writeFileSync(join(folder, "transcript.md"), transcript(world, saves, id, steps, setup));
  if (draw) keepPictures(saves, id, join(folder, "pictures"));
  if (keepSave) cpSync(savesDir, join(folder, "Saves"), { recursive: true });
  rmSync(savesDir, { recursive: true, force: true });
  return flat;
}

/** Each drawn picture as a file named as the transcript names it, so a judge can look at it. */
function keepPictures(saves: ReturnType<typeof saveStore>, id: string, into: string) {
  mkdirSync(into, { recursive: true });
  for (const { kind, ref, npc } of saves.gallery(id)) {
    const bytes =
      kind === "scene" ? saves.sceneImage(id, ref) : kind === "portrait" ? saves.portrait(id, ref) : kind === "original" ? saves.original(id, ref) : undefined;
    if (bytes) writeFileSync(join(into, pictureName(kind, ref, npc)), bytes);
  }
}
const pictureName = (kind: string, ref: number, npc: string | null) => `${kind}-${kind === "scene" ? ref : safe(npc ?? "pc")}.png`;

function transcript(world: z.infer<typeof World>, saves: ReturnType<typeof saveStore>, id: string, steps: Step[], setup: string) {
  const checks = new Map(saves.checks(id).map((check) => [check.messageId, check]));
  // Judges charged the bench's own words to the Narrator, such as an Edit's line taken for a habit of its prose, so each is marked.
  const byBench: Record<string, string> = {
    rewrite: `Written again at the bench's request: "${world.actions.rewrite}"`,
    regenerate: "Written again by the bench's Regenerate",
    edit: `The bench's Edit added the last paragraph: "${world.actions.edit}"`,
  };
  const benched = new Map(steps.flatMap(({ message, action }) => (message === undefined ? [] : [[message, byBench[action] ?? action] as const])));
  const gallery = saves.gallery(id);
  const scenes = new Map(gallery.filter(({ kind }) => kind === "scene").map(({ messageId, prompt }) => [messageId, prompt]));
  const story = saves.messages(id).map(({ id: messageId, role, text }) => {
    const check = checks.get(messageId);
    const rolled = check ? `\n\n> Hidden Check: ${check.action} (difficulty ${check.difficulty}, rolled ${check.roll}): ${check.outcome}` : "";
    const scene = scenes.get(messageId);
    const drawn = draw ? `\n>\n> Picture: pictures/${pictureName("scene", messageId, null)}` : "";
    const pictured = scene ? `\n\n> Picture prompt: ${scene}${drawn}` : "";
    // Numbered, so a Scene Memory's range of Messages can be found in the story.
    const bench = benched.get(messageId);
    // Every Message numbered as a judge names it, the Narrator's too.
    return role === "player"
      ? `**Player (M${messageId}):** ${text}`
      : `${bench ? `> ${bench}\n\n` : ""}**Narrator (M${messageId}):** ${text}${rolled}${pictured}`;
  });
  const portraits = gallery
    .filter(({ kind }) => kind === "portrait" || kind === "original")
    .map(
      ({ kind, ref, npc, prompt }) =>
        `- ${npc ?? world.save.pc.name}${kind === "original" ? " (first portrait)" : ""}: ${prompt ?? "(no prompt kept)"}${draw ? ` (pictures/${pictureName(kind, ref, npc)})` : ""}`,
    );
  const timeline = steps.map(({ round, action, input, ok, hidden, offered }) => {
    const lines = [...(offered ? [`Offered: ${offered.map((choice) => `"${choice}"`).join(", ")}`] : []), ...hidden];
    return `- Round ${round}, ${action}${input ? ` "${input}"` : ""}${ok ? "" : " (failed)"}${lines.map((line) => `\n  - ${line}`).join("")}`;
  });
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n") || "(none)";
  const start = world.opening as Partial<State>;
  const end = saves.latestState(id);
  // The world as it began and the summary as it ended, so the transcript alone holds what the Narrator was working from.
  const begun = `## World rules at the start\n\n${list(start.worldRules ?? [])}\n\n## Lore at the start (hidden)\n\n${list((start.worldBible ?? []).map(({ title, content }) => `${title}: ${content}`))}`;
  const time = end.storyTime ? `day ${end.storyTime.day}, ${end.storyTime.date}, ${end.storyTime.timeOfDay}` : "(none)";
  const ending = `## At the end\n\nStory time: ${time}\n\nSummary the Narrator reads: ${end.summary || "(none)"}\n\nPlot Threads:\n\n${list(end.plotThreads.map((truth) => `${truth}\n  - Now: ${end.threadsNow[truth] || "(none)"}\n  - Plan: ${end.threadsPlan[truth] || "(none)"}`))}\n\nLoose Ends:\n\n${list(end.looseEnds)}`;
  return `# ${world.save.title}\n\n${setup}\n\n## Plot Threads at the start (hidden)\n\n${list(world.opening.plotThreads as string[])}\n\n${begun}\n\n## The story\n\n${story.join("\n\n")}\n\n## Portrait prompts\n\n${portraits.join("\n") || "(none)"}\n\n## Hidden timeline\n\n${timeline.join("\n")}\n\n${ending}\n`;
}

// ---- Results ----

function summarise(result: Result) {
  const keys = [...new Set(result.plays.flatMap((flat) => Object.keys(flat)))];
  // A genre score is asked only of the plays of its kind, so it is their mean; anything else missing from a play is 0 there.
  const values = (key: string) =>
    key.startsWith("judge.") ? result.plays.flatMap((flat) => (key in flat ? [flat[key]!] : [])) : result.plays.map((flat) => flat[key] ?? 0);
  result.summary = Object.fromEntries(keys.map((key) => [key, mean(values(key))]));
  result.range = Object.fromEntries(keys.map((key) => [key, [Math.min(...values(key)), Math.max(...values(key))]]));
  result.coverage = Object.fromEntries(
    COVERAGE.map(([label, keys]) => [label, result.plays.filter((flat) => keys.some((key) => (flat[key] ?? 0) > 0)).length]),
  );
  result.summary["coverage.fired"] = Object.values(result.coverage).filter((plays) => plays > 0).length;
}

/** Scores each play on its own, caps and penalty included, so the run's numbers are the means of its plays'. */
function judged(result: Result, by: string, plays: JudgeReply[]) {
  result.judge = { by, plays };
  result.rubric = RUBRIC_VERSION;
  plays.forEach((reply, at) => {
    const flat = result.plays[at]!;
    // A re-judged play keeps none of its last judge's numbers.
    for (const key of Object.keys(flat)) if (/^(judge|mistakes|mistakeCount)\./.test(key)) delete flat[key];
    Object.assign(flat, scorePlay(reply, flat.turns ?? 0));
    flat["judged.npcDied"] = reply.happened.npcDied ? 1 : 0;
    flat["judged.pcInMortalDanger"] = reply.happened.pcInMortalDanger ? 1 : 0;
  });
  summarise(result);
}

const sameModels = (a: Result, b: Result) =>
  a.provider === b.provider &&
  (a.mode ?? "choices") === (b.mode ?? "choices") &&
  a.models.narrator === b.models.narrator &&
  a.models.reviewer === b.models.reviewer &&
  (a.models.consistency ?? "off") === (b.models.consistency ?? "off");

function report(result: Result) {
  const show = (value: number | undefined, key = "") =>
    value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(key.startsWith("cost") ? 4 : 2);
  console.log(
    `\n${result.provider} ${result.models.narrator}${result.host ? ` on ${result.host}` : ""}, reviewer ${result.models.reviewer} (${result.models.reviewThinking})${result.models.consistency ? `, consistency ${result.models.consistency}` : ""}`,
  );
  console.log(
    `${result.runs} play(s) of ${result.rounds} rounds, ${result.mode ?? "choices"}, seed ${result.seed}, judged by ${result.judge?.by ?? "no one yet"}`,
  );
  const kept = allResults().find(({ path, result: other }) => path.startsWith(RESULTS) && sameModels(other, result) && other.date !== result.date);
  const anyKept = kept ?? allResults().find(({ path, result: other }) => path.startsWith(RESULTS) && other.date !== result.date);
  if (!kept)
    console.log(
      anyKept
        ? `No kept result has the same three models, so this compares with ${relative(BENCH, anyKept.path)}, whose models differ.`
        : "No kept result to compare with.",
    );
  else console.log(`Compared with ${relative(BENCH, kept.path)}`);
  if (anyKept && (anyKept.result.host ?? "") !== (result.host ?? ""))
    console.log(`Its Narrator host differs: ${anyKept.result.host || "any"} there, ${result.host || "any"} here.`);
  const base = anyKept?.result.summary;
  // Scores from another rubric don't compare, so they aren't shown beside these; a run not judged yet has none to show.
  const sameRubric = (anyKept?.result.rubric ?? 1) === (result.rubric ?? 1);
  if (base && result.judge && !sameRubric) console.log("Its scores were judged by another rubric, so only its other numbers are shown.");
  for (const key of HEADLINE) {
    const [low, high] = result.range[key] ?? [];
    const range = low !== undefined && low !== high ? ` (${show(low, key)} to ${show(high, key)})` : "";
    const scored = key.startsWith("judge.") || key.startsWith("mistakes.");
    const was = base && (sameRubric || !scored) ? `   was ${show(base[key], key)}` : "";
    console.log(`  ${key.padEnd(26)} ${show(result.summary[key], key)}${range}${was}`);
  }
  if (result.judge) {
    const turns = result.summary.turns || 1;
    const kinds = Object.keys(MISTAKES).map((kind) => `${kind} ${show(((result.summary[`mistakeCount.${kind}`] ?? 0) * 10) / turns)}`);
    console.log(`  Mistakes per 10 Turns by kind: ${kinds.join(", ")}`);
    // Which major capped which score, as a silent cut read as unfair.
    result.judge.plays.forEach((reply, at) => {
      const caps = capsOf(reply).map(
        ({ item, at: cap, from, behind }) => `${item} ${from}→${cap} (${behind.map(({ kind, where }) => `${kind} ${where}`).join(", ")})`,
      );
      if (caps.length) console.log(`  Play ${at + 1} capped: ${caps.join("; ")}`);
    });
  }
  console.log(tokenTable(result.summary));
  const never = Object.entries(result.coverage).filter(([, plays]) => plays === 0);
  if (never.length) console.log(`Never fired: ${never.map(([label]) => label).join(", ")}`);
  const spent = (result.summary["cost.total"] ?? 0) * result.runs;
  console.log(`Cost $${spent.toFixed(3)}${result.estimate === null ? "" : ` against an estimate of $${result.estimate.toFixed(3)}`}`);
}

// ---- Commands ----

function readMoves(movesFile: string | undefined) {
  if (movesFile && !existsSync(movesFile)) fail(`No moves file at ${movesFile}.`);
  const moves = movesFile
    ? readFileSync(movesFile, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
    : undefined;
  if (moves?.length === 0) fail(`No moves in ${movesFile}.`);
  return moves;
}
// Absolute, as each play runs in a process of its own.
const worldFile = resolve(option("--world") ?? join(BENCH, "worlds", DEFAULT_WORLD));
const readWorld = () => World.parse(JSON.parse(readFileSync(worldFile, "utf8")));
/** A world by the file name a result records: a shared one in bench/worlds/, or one kept out of git. */
const worldNamed = (name: string) =>
  World.parse(JSON.parse(readFileSync([join(BENCH, "worlds", name), join(BENCH, "worlds-local", name)].find(existsSync) ?? worldFile, "utf8")));
/** The genres a world's plays must be scored for, as its story was written for them. */
const genresOf = (world: z.infer<typeof World>) => (world.genres ?? []).filter((key): key is GenreKey => key in GENRES);
const judgeRules = (world = readWorld()) => {
  const genres = genresOf(world);
  const required = genres.length
    ? `This story was written as ${genres.map((key) => GENRES[key][0]).join(" and ")}, so always rate ${genres.join(" and ")}, however far the story strayed from it: a story that left it behind scores low there.`
    : "";
  return [JUDGE_RULES, required, world.judge].filter(Boolean).join("\n");
};
/** The judge's reply for a world, with its genres' scores required. */
const judgeReplyFor = (world: z.infer<typeof World>) => {
  const genres = genresOf(world);
  return JudgeReply.refine((reply) => genres.every((key) => reply[key]), `every play of this world needs ${genres.join(" and ")}`);
};

/** One play, in a process of its own, as the log is one file per process. Started only by `run`, which reads its play.json. */
async function playOne() {
  const folder = option("--folder")!;
  const played = await play(
    count("--index"),
    Number(option("--seed")),
    count("--rounds"),
    readMoves(option("--moves")),
    option("--settings")!,
    readWorld(),
    folder,
  );
  writeFileSync(join(folder, "play.json"), JSON.stringify(played));
}

/** Starts a play in a child process and gives back what it recorded. */
async function playApart(index: number, seed: number, rounds: number, movesFile: string | undefined, settingsPath: string, folder: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      import.meta.path,
      "play",
      ...["--index", String(index), "--seed", String(seed), "--rounds", String(rounds), "--settings", settingsPath, "--folder", folder],
      ...(movesFile ? ["--moves", movesFile] : []),
      ...["--world", worldFile],
      ...(fake ? ["--fake"] : []),
      ...(draw ? ["--draw"] : []),
      ...(keepSave ? ["--keep-save"] : []),
      ...(fromSaves ? ["--from", fromSaves] : []),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  // Not the whole run, as the other plays are paid for and still going.
  if ((await child.exited) !== 0) {
    console.error(`Play ${index} failed; its log is in ${folder}. The others go on.`);
    return undefined;
  }
  const played = JSON.parse(readFileSync(join(folder, "play.json"), "utf8")) as Awaited<ReturnType<typeof play>>;
  // Gone once read, as every JSON file under runs/ is taken for a run's result.
  rmSync(join(folder, "play.json"));
  return played;
}

async function run() {
  const movesFile = option("--moves");
  const moves = readMoves(movesFile);
  const rounds = moves?.length ?? count("--rounds");
  const runs = count("--runs");
  const judge = option("--judge") ?? "self";
  if (judge !== "self" && judge !== "narrator") fail("--judge is self or narrator.");
  const label = safe(option("--label") ?? (movesFile ? `moves-${basename(movesFile).replace(/\.\w+$/, "")}` : "run"));
  const seed = Number(option("--seed") ?? 1);
  // Its own file, git-ignored like the player's, so changing the player's Settings never changes a run. Only a copy is ever changed.
  const given = option("--settings") ?? "bench/settings.json";
  if (!fake && !existsSync(given)) fail(`No Settings file at ${given}. Copy settings.json there, set up as the bench should play.`);
  if (!existsSync(worldFile)) fail(`No world file at ${worldFile}.`);
  readWorld();

  // A copy outside the repo, as it holds keys. Pictures are on, drawn by a stand-in, with the player's image Settings, which shape
  // the prompts; with none set up, as an OpenRouter model, which takes prose prompts.
  const temp = mkdtempSync(join(tmpdir(), "inkandthread-bench-"));
  const settingsPath = join(temp, "settings.json");
  if (!fake) copyFileSync(given, settingsPath);
  const remove = () => rmSync(temp, { recursive: true, force: true });
  process.on("exit", remove);
  process.on("SIGINT", () => process.exit(130));
  const settings = settingsStore(settingsPath);
  const { modelInstructions = "", imageInstructions = "" } = readWorld();
  settings.update({ imagesEnabled: true, drawScenes: true, modelInstructions, imageInstructions });
  const drawing = settings.read();
  // With --fake, the stand-in still draws, so keeping the pictures can be tried free.
  if (draw && !fake && (drawing.imageProvider !== "local" || !localIsSetUp(drawing)))
    fail("--draw needs local ComfyUI set up as the image provider in the Settings file.");
  if (drawing.imageProvider === "local" ? !localIsSetUp(drawing) : !(drawing.imageModel && drawing.imageApiKey))
    settings.update({ imageProvider: "openrouter", imageModel: "fake-images", imageApiKey: "fake-key" });
  // No LoRAs, so pictures are judged on the model and the prompts alone, as the player's pulled watercolour scenes to photographs.
  settings.update({ comfyLoras: [] });
  const chosen = { narrator: option("--narrator"), reviewer: option("--reviewer") };
  if (flag("--narrator-only") && chosen.reviewer) fail("--narrator-only can't go with --reviewer.");
  if (chosen.narrator) settings.update({ textModel: chosen.narrator });
  if (flag("--narrator-only")) settings.update({ reviewOtherModel: false });
  if (chosen.reviewer) settings.update({ reviewOtherModel: true, reviewModel: chosen.reviewer });
  if (fake) settings.update({ textBaseUrl: "http://127.0.0.1:9/v1", textModel: "fake-narrator" });
  // Last, as the host is kept per server address and a change of address above loads that server's own.
  const host = option("--host");
  if (host) settings.update({ textHost: host, textHostFallback: false });
  // The Scribe on the Narrator's own server and key, but as another server, which keeps no host.
  if (flag("--reviewer-anywhere")) {
    const { textBaseUrl, textApiKey } = settings.read();
    settings.update({ reviewSameProvider: false, reviewBaseUrl: textBaseUrl, reviewApiKey: textApiKey });
  }
  const reviewThinking = option("--review-thinking");
  if (reviewThinking) settings.update({ reviewThinking: reviewThinking as ReturnType<typeof settings.read>["reviewThinking"] });
  const all = settings.read();
  const reviewer = reviewerSettings(settings).read();
  const provider = fake ? "fake" : providerOf(all.textBaseUrl);
  const models = {
    narrator: all.textModel,
    reviewer: reviewer.textModel,
    reviewThinking: all.reviewThinking,
  };
  if (!models.narrator) fail("The Settings file names no Narrator model.");

  const { dollars, how } = fake ? { dollars: 0, how: "the fakes cost nothing" } : await estimate(provider, models.narrator, models.reviewer, rounds, runs);
  const pinned = all.textHost ? ` on ${all.textHost}${all.textHostFallback ? " (falling back)" : ""}` : "";
  console.log(`${runs} play(s) of ${rounds} rounds on ${provider} ${models.narrator}${pinned}, reviewer ${models.reviewer}.`);
  console.log(dollars === null ? `Estimated cost: ${how}.` : `Estimated cost: about $${dollars.toFixed(2)} (${how}).`);
  if (!flag("--yes") && prompt("Start? [y/N]")?.trim().toLowerCase() !== "y") fail("Not started.");

  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const folder = join(RUNS, provider, safe(models.narrator), `${stamp}-${label}`);
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  const dirty = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim() ? "+changes" : "";
  const result: Result = {
    version: BENCH_VERSION,
    setup: all.reviewOtherModel ? "full" : "narrator",
    date: new Date().toISOString(),
    label,
    commit: `${commit}${dirty}`,
    provider,
    models,
    ...(all.textHost && { host: all.textHost, hostFallback: all.textHostFallback }),
    mode: movesFile ? `free text: ${basename(movesFile)}` : "choices",
    world: basename(worldFile),
    drawn: draw && !fake,
    thinking: all.textThinking,
    seed,
    rounds,
    runs,
    estimate: dollars,
    summary: {},
    range: {},
    coverage: {},
    judge: null,
    plays: [],
  };
  const playAt = (index: number) => playApart(index, seed, rounds, movesFile, settingsPath, join(folder, `play-${index}`));
  const indexes = Array.from({ length: runs }, (_, at) => at + 1);
  // All at once on remote models; one at a time on a local one, which would only make each play wait on the other.
  const outcomes: Awaited<ReturnType<typeof playAt>>[] = [];
  if (provider === "local") {
    for (const index of indexes) {
      console.log(`Play ${index} of ${runs}`);
      outcomes.push(await playAt(index));
    }
  } else {
    console.log(`Playing all ${runs} at once`);
    outcomes.push(...(await Promise.all(indexes.map(playAt))));
  }
  // The result holds the plays that finished, and names any that didn't, so a judge reads only those with a transcript.
  const kept = indexes.filter((index) => outcomes[index - 1] !== undefined);
  if (kept.length === 0) fail(`Every play failed; their logs are in ${relative(process.cwd(), folder)}.`);
  result.plays = kept.map((index) => outcomes[index - 1]!);
  if (kept.length < runs) {
    result.failedPlays = indexes.filter((index) => !kept.includes(index));
    result.runs = kept.length;
  }
  summarise(result);
  writeFileSync(join(folder, "result.json"), JSON.stringify(result, null, 2));

  if (judge === "narrator") {
    const calls: Call[] = [];
    const judgeWith = counted(narratorOf(settings), "narrator", calls);
    const plays: JudgeReply[] = [];
    for (const index of kept) {
      const story = readFileSync(join(folder, `play-${index}`, "transcript.md"), "utf8");
      plays.push(
        await askForJson(
          judgeWith,
          [
            { role: "system", content: judgeRules() },
            { role: "user", content: story },
          ],
          judgeReplyFor(readWorld()),
          "The Narrator refused to judge the story.",
          new AbortController().signal,
          { call: "judge" },
        ),
      );
    }
    await Bun.sleep(3000);
    judged(result, models.narrator, plays);
    result.summary["cost.judge"] = calls.reduce((sum, { cost }) => sum + cost, 0);
    writeFileSync(join(folder, "result.json"), JSON.stringify(result, null, 2));
  } else {
    writeFileSync(
      join(folder, "judge.md"),
      `# Judge this run\n\nRead each play's transcript.md, then judge it by these rules:\n\n${judgeRules()}\n\nWrite a JSON array with one reply per play, in order${result.failedPlays ? ` (only plays ${kept.join(", ")}, as ${result.failedPlays.join(", ")} failed)` : ""}, and save it with:\n\n    bun bench judge ${relative(process.cwd(), folder)} --by <your model> --scores <file>\n`,
    );
    console.log(`\nTo judge it yourself, follow ${relative(process.cwd(), join(folder, "judge.md"))}.`);
  }
  report(result);
  console.log(`\nRun saved in ${relative(process.cwd(), folder)}. To keep it as a best result: bun bench keep ${relative(process.cwd(), folder)}`);
}

function readRun(folder: string | undefined) {
  if (!folder || !existsSync(join(folder, "result.json"))) fail("Give a run folder holding result.json.");
  return JSON.parse(readFileSync(join(folder, "result.json"), "utf8")) as Result;
}

function judgeRun() {
  const folder = args[1];
  const result = readRun(folder);
  const by = option("--by");
  const scores = option("--scores");
  if (!by || !scores) fail("Give --by <model> and --scores <file>.");
  const plays = z
    .array(judgeReplyFor(worldNamed(result.world ?? DEFAULT_WORLD)))
    .length(result.runs)
    .parse(JSON.parse(readFileSync(scores, "utf8")));
  plays.forEach(({ mistakes }, at) => {
    const last = result.plays[at]?.messages;
    const past = mistakes.filter(({ where }) => last && Number(where.match(/^M(\d+)/i)?.[1] ?? 0) > last);
    if (past.length) fail(`Play ${at + 1} has mistakes placed past its last Message, M${last}: ${past.map(({ where }) => where).join(", ")}.`);
  });
  judged(result, by, plays);
  writeFileSync(join(folder!, "result.json"), JSON.stringify(result, null, 2));
  report(result);
  // A feature the bench's own checks found wrong, audited ok, says how closely the judge looked.
  const checked = { storyTime: ["timeBack"], npcKnows: ["repeatKnows", "negativeKnows"], looseEnds: ["looseEndReopened"] } as const;
  plays.forEach(({ audit }, at) => {
    for (const [feature, faults] of Object.entries(checked)) {
      const found = faults.reduce((sum, fault) => sum + (result.plays[at]?.[`stateFaults.${fault}`] ?? 0), 0);
      if (found > 0 && audit[feature as keyof typeof checked] === "ok")
        console.log(`Play ${at + 1}: the judge audited ${feature} ok, but the bench's checks found ${found} fault(s) there.`);
    }
  });
}

function keep() {
  const folder = args[1];
  const result = readRun(folder);
  const target = join(RESULTS, result.provider, safe(result.models.narrator), `${basename(folder!)}.json`);
  mkdirSync(dirname(target), { recursive: true });
  // The numbers only: a transcript and log hold the story and stay in the run's folder.
  writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Kept as ${relative(process.cwd(), target)}. Commit it to compare with later.`);
}

function table() {
  const found = allResults();
  if (flag("--csv")) {
    const keys = [...new Set(found.flatMap(({ result }) => Object.keys(result.summary)))].toSorted();
    const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
    console.log(
      ["date", "kept", "label", "provider", "narrator", "reviewer", "consistency", "judge", "drawn", "world", "rounds", "runs", ...keys].map(quote).join(","),
    );
    for (const { path, result } of found) {
      const { date, label, provider, models, judge, drawn, world, rounds, runs, summary } = result;
      const meta = [
        date,
        path.startsWith(RESULTS) ? "yes" : "no",
        label,
        provider,
        models.narrator,
        models.reviewer,
        models.consistency ?? "",
        judge?.by ?? "",
        drawn === undefined ? "" : drawn ? "yes" : "no",
        world ?? DEFAULT_WORLD,
      ];
      console.log([...meta.map(quote), rounds, runs, ...keys.map((key) => summary[key] ?? "")].join(","));
    }
    return;
  }
  const columns = [
    "cost.perRound",
    "timing.firstText.median",
    "timing.reply.median",
    "timing.turn.median",
    "checks.asked",
    "ops.resolve_plot_thread",
    "coverage.fired",
    "judge.overall",
  ];
  console.log(["date".padEnd(17), "kept", "narrator".padEnd(30), "rounds x runs", ...columns].join("  "));
  for (const { path, result } of found) {
    const cells = columns.map((key) => {
      const value = result.summary[key];
      return (value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(3)).padEnd(key.length);
    });
    const row = [
      result.date.slice(0, 16).replace("T", " ").padEnd(17),
      (path.startsWith(RESULTS) ? "yes" : "").padEnd(4),
      result.models.narrator.slice(0, 30).padEnd(30),
    ];
    console.log([...row, `${result.rounds} x ${result.runs}`.padEnd(13), ...cells].join("  "));
  }
}

/** Each shared bench world's file name and genre, which its name gives: bench/worlds/, never the ones kept out of git. */
function sharedWorlds() {
  const names = readdirSync(join(BENCH, "worlds")).filter((name) => name.endsWith(".json"));
  return Object.fromEntries(names.map((name) => [name, name[0]!.toUpperCase() + name.slice(1, -".json".length)]));
}

function chart() {
  const kept = allResults().filter(({ path }) => path.startsWith(RESULTS));
  const rounds = option("--rounds") ? count("--rounds") : CHART_ROUNDS;
  const titles = sharedWorlds();
  // Every score the bench asks, so the chart offers each one before any kept run has it.
  const scores = [...Object.keys(RUBRIC), ...Object.keys(GENRES)];
  // Only the numbers the chart reads, of the shared worlds, as the app ships this file for players to compare models.
  const results = kept
    .map(({ result }) => result)
    .filter((result) => (result.world ?? DEFAULT_WORLD) in titles)
    .map(({ version, setup, rounds, mode, world, drawn, provider, thinking, models, judge, plays, rubric }) => ({
      version,
      setup,
      rounds,
      mode,
      world,
      drawn,
      provider,
      thinking,
      models,
      ...(rubric && { rubric }),
      judge: judge && {
        // From the second rubric on, the scores after caps and the overall after the penalty, as the bench reports them.
        plays: judge.plays.map((play, at) => {
          const flat = rubric ? plays[at]! : undefined;
          const capped = (key: string, score: number) => ({ score: flat?.[`judge.${key}`] ?? score });
          return {
            scores: Object.fromEntries(Object.entries(play.scores).map(([key, { score }]) => [key, capped(key, score)])),
            genres: Object.fromEntries((Object.keys(GENRES) as GenreKey[]).flatMap((key) => (play[key] ? [[key, capped(key, play[key].score)]] : []))),
            ...(flat && { overall: flat["judge.overall"] }),
          };
        }),
      },
      plays: plays.map((flat) => ({
        "cost.total": flat["cost.total"] ?? 0,
        turns: flat.turns ?? 0,
        "timing.turn.median": flat["timing.turn.median"] ?? 0,
        "timing.firstText.median": flat["timing.firstText.median"] ?? 0,
      })),
    }));
  writeFileSync(
    join(BENCH, "..", "src", "web", "bench-results.json"),
    `${JSON.stringify({ rounds, titles, scores, results })}
`,
  );
  const folder = join(BENCH, "charts");
  mkdirSync(folder, { recursive: true });
  const target = join(folder, "bench-chart.html");
  writeFileSync(target, chartPage(results, rounds, { titles, scores }));
  console.log(`Kept runs of ${rounds} rounds, every bench version and story, charted in ${relative(process.cwd(), target)} and src/web/bench-results.json.`);
}

const command = args[0];
if (command === "run") await run();
else if (command === "play") await playOne();
else if (command === "judge") judgeRun();
else if (command === "keep") keep();
else if (command === "table") table();
else if (command === "chart") chart();
else fail("Use: bun bench run | judge | keep | table | chart (see the top of bench/bench.ts).");
