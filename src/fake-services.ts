import { deflateSync } from "node:zlib";
import type { ImageAdapter } from "./image-adapter";
import type { TextProvider } from "./turn-engine";

// Stand-ins for the Text Provider and the image model, for trying the app with no key, no network and no cost.
// They answer with the shape each request asks for, not with a story, so they suit clicking through screens, not judging writing.

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maxLength?: number;
  $ref?: string;
  $defs?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
};

const NAMES = ["Mira Vale", "Old Tamsin", "Corwin Ash", "Sister Hale"];
const LINES = [
  "Rain needles the harbour as the lamps come on, one by one, along the sea wall.",
  "A door bangs somewhere above, and the smell of tar and wet rope drifts down the stair.",
  "The crowd parts for a moment, and a stranger in a grey coat watches you from across the square.",
  "Wind worries at the shutters. Far off, a bell tolls the hour no one is keeping.",
];

// Three, so a reply's three Choices are always different.
const CHOICES = ["I ask the stranger what they want.", "I slip away down the stair.", "I wait by the sea wall and watch."];

let count = 0;
const next = <T>(list: T[]) => list[count++ % list.length]!;

// Someone a Turn meets gets a name not used before, so the people list grows as a story goes on.
const FIRST = ["Wren", "Bram", "Isolde", "Tobin", "Maren", "Ezra", "Liesl", "Pell"];
const LAST = ["Garrow", "Thorne", "Quill", "Marsh", "Hollis", "Vane"];
let met = 0;
const newcomer = () => `${FIRST[met % FIRST.length]} ${LAST[Math.floor(met++ / FIRST.length) % LAST.length]}`;

/** Plain words for a field, picked by its name. No digits, as Status refuses numbers. */
function words(key: string) {
  if (/name|into/.test(key)) return next(NAMES);
  if (/title/.test(key)) return "The Salt Road";
  if (key === "choices") return next(CHOICES);
  if (/appearance|looks/.test(key)) return "Tall and weathered, in a salt-stained grey coat";
  if (/narration|opening|answer|text|memory|summary|brief|description|overview/.test(key)) return `${next(LINES)} ${next(LINES)}`;
  return next(["A quiet harbour town", "Salt and tar", "The old sea wall", "A lamp in the rain"]);
}

/**
 * A reply that `schema` accepts, with three of every list, as some lists must hold more than one and that rule
 * isn't in the schema a model is sent. Rules the schema can't carry, such as word limits, can still fail, and then the
 * app retries and falls back as it would with a real model.
 */
export function sample(schema: Schema, key = "", root: Schema = schema): unknown {
  if (schema.$ref) return sample(root.$defs?.[schema.$ref.split("/").pop()!] ?? root.definitions?.[schema.$ref.split("/").pop()!] ?? {}, key, root);
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) {
    // Never a Check: one would stop every Turn for a roll. Otherwise the first choice that isn't null.
    if (key === "check") return null;
    return sample(schema.anyOf.find((choice) => choice.type !== "null") ?? schema.anyOf[0]!, key, root);
  }
  const type = Array.isArray(schema.type) ? (schema.type.find((t) => t !== "null") ?? "null") : schema.type;
  switch (type) {
    case "object":
      // In the schema's own order, as a Turn's narration only streams once "check" has come first.
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([name, value]) => [
          name,
          name === "check" ? null : key === "people" && name === "name" ? newcomer() : sample(value, name, root),
        ]),
      );
    case "array":
      return schema.items ? [0, 1, 2].map(() => sample(schema.items!, key, root)) : [];
    case "string":
      return words(key).slice(0, schema.maxLength);
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return words(key);
  }
}

const FACTS = [
  "The harbourmaster takes bribes",
  "The lighthouse has been dark for a week",
  "Smugglers use the old sea wall",
  "The bell tolls at the wrong hours",
  "No ship has left port since the storm",
  "The chapel keeps a locked crypt",
];
const LOOSE_ENDS = [
  "Who was the stranger in the grey coat?",
  "What is hidden under the sea wall?",
  "Why did the lighthouse go dark?",
  "Where did the missing fishermen go?",
  "Who rings the bell at night?",
  "What does the harbourmaster owe?",
];
const WHO = [
  "A dockhand who owes the harbourmaster money",
  "A widow who keeps the lamp shop by the quay",
  "A sailor stranded since the storm",
  "A clerk at the customs house",
  "A priest who rarely leaves the chapel",
  "A smuggler posing as a net mender",
];
const CONDITIONS = ["Soaked to the skin", "Tired from the long walk", "Uneasy", "Hungry"];
const INJURIES = ["A grazed hand", "A bruised shoulder", "A twisted ankle"];
const HEALTH = ["unhurt", "lightly hurt", "hurt"];
const TIMES = ["dawn", "morning", "midday", "afternoon", "dusk", "night"];
let turn = 0;

/**
 * A Turn's changes to the story, one of each kind the player can see, so every Journal and story panel has something
 * in it. Each Turn takes the next of each list, so the lists grow. Only adds and sets, as a remove or update of
 * something the state lacks would be refused and fail the Turn.
 */
function storyChanges(people: string[]) {
  const at = turn++;
  const pick = (list: string[]) => list[at % list.length]!;
  return [
    // Everyone a reply meets is in the scene, as a real Narrator's set_scene would say, so they show under Recent Characters.
    { op: "set_scene", location: "The old sea wall", visible_cast: people },
    ...people.map((name, index) => ({ op: "set_known_npc_summary", name, summary: WHO[(at * people.length + index) % WHO.length] })),
    { op: "add_known_fact", fact: pick(FACTS) },
    { op: "add_loose_end", loose_end: pick(LOOSE_ENDS) },
    { op: "set_health", health: pick(HEALTH) },
    { op: "add_status", kind: "conditions", text: pick(CONDITIONS) },
    { op: "add_status", kind: "injuries", text: pick(INJURIES) },
    { op: "set_story_time", days_passed: at % TIMES.length === TIMES.length - 1 ? 1 : 0, date: "The first of Thaw", time_of_day: pick(TIMES) },
  ];
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** The title a request's JSON names, if any: a Cover's picture prompt must quote it. */
function titleIn(prompt: Parameters<TextProvider>[0]) {
  try {
    const { title } = JSON.parse(prompt.at(-1)?.content ?? "") as { title?: unknown };
    return typeof title === "string" && title.trim() ? title : undefined;
  } catch {
    return undefined;
  }
}

// shortcut: the Important Characters of the last world built, in any story, so a fake Turn can meet them. A real Narrator
// knows them from the world it wrote. Upgrade to a per-world list if two stories at once ever need their own.
let important: string[] = [];
const parsed = (content: string) => {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** Remembers a world request's Important Characters, and gives a Turn's first person the name of one the PC hasn't met. */
function meetImportant(prompt: Parameters<TextProvider>[0], people: { name: string }[]) {
  const asked = prompt.map(({ content }) => parsed(content)?.important_characters).find(Array.isArray) as { name: string }[] | undefined;
  if (asked) important = asked.map(({ name }) => name);
  const state = prompt.map(({ content }) => content.split("\n").find((line) => line.startsWith("Current state: "))).find(Boolean);
  const known = (state && (parsed(state.slice("Current state: ".length))?.pcKnown as { npcs?: string[] } | undefined)?.npcs) ?? undefined;
  const stranger = known && important.find((name) => !known.includes(name));
  if (stranger && people[0]) people[0].name = stranger;
}

/** Answers every request at once with `sample` of its schema, streamed in a few pieces like a real model. */
export const fakeTextProvider: TextProvider = async (prompt, { schema, onText, signal }) => {
  const sampled = schema && (sample(schema as Schema) as Record<string, unknown>);
  const title = titleIn(prompt);
  if (sampled && title && typeof sampled.text === "string")
    sampled.text = `A book cover with large bold title text reading "${title}" across the top. Rain on a harbour at dusk.`;
  if (sampled) meetImportant(prompt, Array.isArray(sampled.people) ? sampled.people : []);
  if (sampled && Array.isArray(sampled.people) && Array.isArray(sampled.state_operations)) {
    sampled.state_operations = storyChanges(sampled.people.map(({ name }: { name: string }) => name));
  }
  const reply = sampled ? JSON.stringify(sampled) : "The fake Narrator is answering. Start without --fake to test a real model.";
  for (let at = 0; at < reply.length; at += 40) {
    // Slow like a real model when played; tests and the e2e run set FAKE_STREAM_MS to go faster.
    await pause(Number(process.env.FAKE_STREAM_MS ?? 30), signal);
    onText(reply.slice(at, at + 40));
  }
  return reply;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  const out = new DataView(new ArrayBuffer(12 + data.length));
  out.setUint32(0, data.length);
  new Uint8Array(out.buffer).set(body, 4);
  out.setUint32(8 + data.length, crc32(body));
  return new Uint8Array(out.buffer);
}

/** A solid PNG in one of the book's colours. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]) {
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, width);
  header.setUint32(4, height);
  header.setUint8(8, 8); // bit depth
  header.setUint8(9, 2); // colour type: RGB
  // Each row starts with filter type 0, then its pixels.
  const row = [0, ...Array.from({ length: width }, () => [r, g, b]).flat()];
  const pixels = deflateSync(Uint8Array.from(Array.from({ length: height }, () => row).flat()));
  return Uint8Array.from([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", new Uint8Array(header.buffer)),
    ...chunk("IDAT", new Uint8Array(pixels)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

const PLATES: [number, number, number][] = [
  [0x23, 0x50, 0x3e],
  [0x6b, 0x3f, 0x22],
  [0xb4, 0xa5, 0x81],
  [0x5a, 0x53, 0x40],
];

/** Each picture a plain plate in the next colour, shaped as asked, after a short wait like a real model's. */
export const fakeImages: ImageAdapter = async ({ aspect_ratio }, signal) => {
  // Set it higher to see the app while pictures take as long as a real model's.
  await pause(Number(process.env.FAKE_IMAGE_MS ?? 400), signal);
  const [w = 1, h = 1] = aspect_ratio.split(":").map(Number);
  return solidPng(Math.round((64 * w) / Math.max(w, h)), Math.round((64 * h) / Math.max(w, h)), next(PLATES));
};
