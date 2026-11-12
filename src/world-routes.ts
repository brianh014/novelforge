import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  ArtStyleRequest,
  IMAGES_OFF,
  imageResponse,
  longText,
  Nudge,
  parseBody,
  PromptRequest,
  routes,
  type ServerContext,
  someWords,
  uploaded,
  WorldNotFound,
} from "./http";
import { coverPeople, type EarlyImage, type ImageKind, pcLooks, shownFailure, unnamed } from "./image-pipeline";
import { LONG_TEXT } from "./limits";
import { errorType, log } from "./logger";
import { OPENING_SNAPSHOT, PcDetails } from "./save-store";
import type { State, World } from "./state-applier";
import { ENHANCE_FIELDS, enhance, generateWorld, PC_FIELDS, pcSheet, pickForMe, type PictureAsk, type WorldChoices, type WorldPc } from "./world-creation";

/** What a form's pictures may be held under, as it names their folder. */
const HELD_ID = /^[\w-]{1,64}$/;

export const NamedPc = PcDetails.extend({ name: z.string().trim().min(1) });

/** What the form holds an Important Character's portrait under. */
const Ref = z.string().regex(/^[\w-]{1,40}$/);

const WorldRequest = z.object({
  title: z.string().trim().min(1).max(80),
  theme: z.string().trim().min(1),
  worldBrief: longText.min(1),
  startingHook: longText,
  characters: z
    .array(z.object({ name: z.string().trim().min(1).max(80), description: longText, ref: Ref.optional(), onCover: z.boolean().optional() }))
    .max(10)
    .default([]),
  artStyle: z.string().max(LONG_TEXT).optional(),
  pcOnCover: z.boolean().default(true),
});

/** `id` holds the images already drawn on the form, if any. One the server has lost simply starts again. */
const NewWorldRequest = WorldRequest.extend({
  id: z.string().regex(HELD_ID).optional(),
  pc: NamedPc.extend({ background: z.string().max(LONG_TEXT).optional(), physicalTraits: z.string().max(LONG_TEXT).optional() }),
  inventory: longText.default(""),
});

// `id` as in `NewWorldRequest`. The form offers these only once their boxes are filled, and this holds it to that.
const DrawRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cover"),
    id: z.string().regex(HELD_ID).optional(),
    title: someWords.max(80),
    theme: someWords,
    worldBrief: someWords,
    // Whoever the form holds so far, to be on the cover.
    pc: z.object({ name: z.string().trim().max(80), physicalTraits: longText }).default({ name: "", physicalTraits: "" }),
    pcOnCover: z.boolean().default(true),
    characters: z
      .array(z.object({ name: z.string().trim().max(80), description: longText, ref: Ref.optional(), onCover: z.boolean().optional() }))
      .max(10)
      .default([]),
    // The form's wearing and carrying box, so the PC is drawn dressed before the Narrator has sorted it.
    inventory: longText.default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
  z.object({
    kind: z.literal("portrait"),
    id: z.string().regex(HELD_ID).optional(),
    name: z.string().trim(),
    physicalTraits: someWords.max(LONG_TEXT),
    inventory: longText.default(""),
    // The world the PC belongs to, so they're drawn in its era. Either may be empty while the form is.
    theme: z.string().trim().max(4000).default(""),
    worldBrief: z.string().trim().max(4000).default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
  // An Important Character's portrait, drawn from what the player wrote of them. `pcName` is kept out of it, like their own.
  z.object({
    kind: z.literal("npc"),
    id: z.string().regex(HELD_ID).optional(),
    ref: Ref,
    name: z.string().trim().max(80),
    pcName: z.string().trim().max(80).default(""),
    description: someWords.max(LONG_TEXT),
    theme: z.string().trim().max(4000).default(""),
    worldBrief: z.string().trim().max(4000).default(""),
    artStyle: z.string().max(LONG_TEXT).default(""),
    nudge: Nudge,
  }),
]);

const PcBoxes = z.record(z.enum(PC_FIELDS), longText);

const PickRequest = z.object({
  theme: z.string().trim().min(1),
  title: z.string().trim().max(80),
  worldBrief: longText,
  startingHook: longText.optional(),
  pc: PcBoxes.optional(),
});

const CharacterBoxes = z.object({ name: z.string().trim().max(80), description: longText });

// Any box may be empty, and an empty `text` asks for that box to be written from scratch. `character` is the row an Important Character's box is in.
const EnhanceRequest = z.object({
  field: z.enum(ENHANCE_FIELDS),
  text: longText,
  theme: z.string().trim(),
  title: z.string().trim(),
  worldBrief: longText,
  startingHook: longText,
  // Half-written rows, as the form holds them while the player works on them.
  characters: z.array(CharacterBoxes).max(10).default([]),
  character: CharacterBoxes.optional(),
  pc: PcBoxes.optional(),
});

/** Removes the pictures of forms untouched for `age` milliseconds. A failure only leaves them for next time. */
function pruneHeld(dir: string, age: number) {
  try {
    for (const entry of readdirSync(dir)) {
      const folder = join(dir, entry);
      if (Date.now() - statSync(folder).mtimeMs > age) rmSync(folder, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") log.warning("images", "Old pictures from the form weren't cleared", errorType(error));
  }
}

/** A failure falls back on the image before it, whose prompt stands too. A Cover's `pictured` are the held portraits it was drawn from. */
type DrawnImage = EarlyImage & { failure?: string; pictured?: string[] };

/** The New Story form: worlds generated and held until Begin, and the pictures drawn for them before a Save exists. */
export function worldRoutes({ options, saves, images }: ServerContext) {
  // Held here until Begin because a Save holds it all at once, and so that the client never holds the secrets.
  // shortcut: an abandoned world and its images stay until the app restarts, evict them if that ever adds up.
  const worlds = new Map<string, World & Pick<State, "storyTime"> & WorldChoices & WorldPc & { sheet: Awaited<ReturnType<typeof pcSheet>> }>();
  // By the id a form or its world goes by, then the image: "cover", "portrait" for the PC's, or "npcs/<ref>" for an Important Character's.
  // These can be drawn before either a world or a Save exists.
  const held = new Map<string, { drawn: Promise<DrawnImage>; stop: AbortController }>();
  const heldAt = (id: string, image: string) => `${id}/${image}`;

  // Each finished picture is kept on disk too, as the player paid for it, and a crash or restart would otherwise lose it.
  const heldDir = join(dirname(options.savesDir), "held-images");
  // shortcut: a form abandoned for a month loses its pictures at the next start, keep them longer if players come back later.
  pruneHeld(heldDir, 30 * 24 * 60 * 60 * 1000);
  // An id or ref reaches a file name only once it's this plain, so no request can name a path of its own.
  const heldFile = (id: string, image: string) =>
    HELD_ID.test(id) && /^(cover|portrait|npcs\/[\w-]{1,40})$/.test(image) ? join(heldDir, id, image.replace("/", "-")) : undefined;

  function keepHeld(id: string, image: string, { prompt, bytes, pictured }: DrawnImage) {
    const file = heldFile(id, image);
    if (!file || !bytes) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.image`, bytes);
      writeFileSync(`${file}.json`, JSON.stringify({ prompt, pictured }));
    } catch (error) {
      log.warning("images", "A picture on the form wasn't kept on disk", { kind: kindOf(image), ...errorType(error) });
    }
  }

  /** What the server holds of this picture, from memory or else from disk. A picture kept on disk comes back as it was finished. */
  function heldOf(id: string, image: string) {
    const current = held.get(heldAt(id, image));
    const file = heldFile(id, image);
    if (current || !file || !existsSync(`${file}.json`)) return current;
    try {
      const { prompt, pictured } = JSON.parse(readFileSync(`${file}.json`, "utf8")) as { prompt: string; pictured?: string[] };
      const kept = {
        drawn: Promise.resolve<DrawnImage>({ prompt, pictured, bytes: new Uint8Array(readFileSync(`${file}.image`)) }),
        stop: new AbortController(),
      };
      held.set(heldAt(id, image), kept);
      return kept;
    } catch (error) {
      log.warning("images", "A picture on the form couldn't be read back", { kind: kindOf(image), ...errorType(error) });
      return undefined;
    }
  }
  const kindOf = (image: string): ImageKind => (image === "cover" ? "cover" : "portrait");
  /** The held portrait each of a Cover's people is drawn from. */
  const castOf = (people: ReturnType<typeof coverPeople>) => people.map(({ ref }) => (ref === null ? "portrait" : `npcs/${ref}`));
  const characterLooks = (pcName: string, { name, description }: { name: string; description: string }) => unnamed([pcName, name], description);

  /**
   * Replaces any unfinished image, and never rejects: a failure falls back on `before`, so a failed Redraw leaves the old
   * image, and with no `before` keeps its prompt for a retry. `prompt` is a player's own, or written by the text model first.
   * `cast` is a Cover's people by held portrait. A Cover drawn from a player's own prompt shows whoever it showed before.
   */
  function drawHeld(
    id: string,
    image: string,
    prompt: string | ((signal: AbortSignal) => Promise<string>),
    before?: DrawnImage | Promise<DrawnImage>,
    cast?: string[],
  ) {
    const key = heldAt(id, image);
    const kind = kindOf(image);
    held.get(key)?.stop.abort();
    const stop = new AbortController();
    log.verbose("images", "Image started", { kind });
    const drawn = (async (): Promise<DrawnImage> => {
      let written = typeof prompt === "string" ? prompt : "";
      let pictured: string[] | undefined;
      try {
        if (typeof prompt !== "string") written = await prompt(stop.signal);
        if (kind === "cover") pictured = cast ?? (await before)?.pictured ?? ["portrait"];
        // A Cover waits for the portraits of those it shows, drawn or drawing, to draw them from.
        const portraits = await Promise.all(
          (pictured ?? []).map(async (who) => ({
            role: who === "portrait" ? ("pc" as const) : ("npc" as const),
            bytes: (await heldOf(id, who)?.drawn)?.bytes,
          })),
        );
        const bytes = await images.drawEarly(
          kind,
          written,
          stop.signal,
          portraits.flatMap(({ role, bytes }) => (bytes ? [{ role, bytes }] : [])),
        );
        if (bytes) log.info("images", "Image drawn", { kind });
        const finished = { prompt: written, bytes: bytes as Uint8Array<ArrayBuffer> | undefined, pictured };
        // Unless the form has moved on to another, as this one is no longer the player's.
        if (held.get(key)?.stop === stop) keepHeld(id, image, finished);
        return finished;
      } catch (error) {
        const old = (await before) ?? { prompt: written, pictured };
        if (stop.signal.aborted) {
          log.info("images", "Image dropped", { kind, reason: "replaced on the form" });
          return old;
        }
        log.error("images", "Image failed", { kind, ...errorType(error) });
        return { ...old, failure: shownFailure(error) };
      }
    })();
    held.set(key, { drawn, stop });
    return drawn;
  }

  /** In the background, so a slow image never holds up the world. An image drawn or drawing stays, and one that came to nothing gets another try. */
  function drawIfMissing(id: string, image: string, ask: PictureAsk, cast?: string[]) {
    const current = heldOf(id, image);
    if (!current) return void drawHeld(id, image, images.writer(ask), undefined, cast);
    void current.drawn.then(({ bytes }) => {
      if (!bytes && heldOf(id, image) === current) drawHeld(id, image, images.writer(ask), undefined, cast);
    });
  }

  function drawWorldImages(id: string, overview: string, { title, theme, worldBrief, artStyle = "", characters = [], pcOnCover = true }: WorldChoices) {
    const { pc, sheet } = worlds.get(id)!;
    const { wearing } = sheet.inventory;
    const setting = { theme, world: worldBrief, artStyle };
    // The portraits first, as the Cover draws its people from them. Someone with no looks gets no portrait.
    if (pc.physicalTraits?.trim()) drawIfMissing(id, "portrait", { kind: "portrait", looks: pcLooks(pc, wearing), ...setting });
    for (const character of characters) {
      if (character.ref && character.description.trim())
        drawIfMissing(id, `npcs/${character.ref}`, { kind: "portrait", looks: characterLooks(pc.name, character), ...setting });
    }
    const people = coverPeople(pc, wearing, characters, "", pcOnCover);
    drawIfMissing(id, "cover", { kind: "cover", title, ...setting, world: overview, people: people.map(({ looks }) => looks) }, castOf(people));
  }

  // Answers once the image is done, so an img tag can simply wait for it.
  const heldImage = async (id: string, image: string) => {
    const bytes = (await heldOf(id, image)?.drawn)?.bytes;
    return bytes ? imageResponse(bytes) : Response.json({ error: `This world has no ${kindOf(image)}` }, { status: 404 });
  };

  // Answers when the Redraw is done, and the Begin that may come first takes whichever image wins.
  const redrawHeld = async (id: string, image: string, req: Request) => {
    const { prompt } = await parseBody(req, PromptRequest);
    const current = heldOf(id, image);
    if (!current) throw new WorldNotFound();
    if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
    // As written, as the prompt holds its own Art Style.
    const { failure } = await drawHeld(id, image, prompt, current.drawn);
    return Response.json(failure ? { error: failure } : {}, { status: failure ? 502 : 200 });
  };

  // The player's own picture in place of any drawn or drawing. It has no prompt, so a Redraw starts from what they write.
  const uploadHeld = async (id: string, image: string, req: Request) => {
    if (!HELD_ID.test(id)) throw new WorldNotFound();
    const bytes = await uploaded(req);
    heldOf(id, image)?.stop.abort();
    held.set(heldAt(id, image), { drawn: Promise.resolve({ prompt: "", bytes }), stop: new AbortController() });
    keepHeld(id, image, { prompt: "", bytes });
    log.info("images", "Image uploaded", { kind: kindOf(image) });
    return Response.json({});
  };

  // Answers once the image is done, like the image.
  const heldDetails = async (id: string, image: string) => {
    const drawn = await heldOf(id, image)?.drawn;
    if (!drawn) throw new WorldNotFound();
    const { prompt, bytes, failure = "" } = drawn;
    return Response.json({ prompt, hasImage: bytes !== undefined, failure, canRedraw: images.ready() });
  };

  return routes({
    "/worlds": {
      POST: async (req) => {
        const { id = crypto.randomUUID(), pc, inventory, ...choices } = await parseBody(req, NewWorldRequest);
        // First, as it's the small call, and a failure here then costs no world.
        const sheet = await pcSheet(options, pc, inventory, req.signal);
        const { overview, world } = await generateWorld(options, choices, { pc, inventory }, req.signal);
        worlds.set(id, { ...world, ...choices, pc, inventory, sheet });
        drawWorldImages(id, overview, choices);
        return Response.json({ id, overview }, { status: 201 });
      },
    },
    "/worlds/draw": {
      // Answers at once, as the form goes on while an image draws. The prompt holds only the player's own words.
      POST: async (req) => {
        const ask = await parseBody(req, DrawRequest);
        if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
        const { id = crypto.randomUUID(), artStyle } = ask;
        const setting = { theme: ask.theme, world: ask.worldBrief, artStyle, ...(ask.nudge && { nudge: ask.nudge }) };
        // A Redo from the form that fails keeps the image it would have replaced.
        const redo = (image: string, picture: PictureAsk, cast?: string[]) => drawHeld(id, image, images.writer(picture), heldOf(id, image)?.drawn, cast);
        if (ask.kind === "cover") {
          const people = coverPeople(ask.pc, [], ask.characters, ask.inventory, ask.pcOnCover);
          redo("cover", { kind: "cover", title: ask.title, ...setting, people: people.map(({ looks }) => looks) }, castOf(people));
        } else if (ask.kind === "npc") {
          redo(`npcs/${ask.ref}`, { kind: "portrait", ...setting, looks: characterLooks(ask.pcName, ask) });
        } else {
          redo("portrait", { kind: "portrait", ...setting, looks: pcLooks({ name: ask.name, physicalTraits: ask.physicalTraits }, [], ask.inventory) });
        }
        return Response.json({ id }, { status: 201 });
      },
    },
    "/worlds/:id/begin": {
      POST: async (req) => {
        const { artStyle } = await parseBody(req, ArtStyleRequest);
        const world = worlds.get(req.params.id);
        if (!world) throw new WorldNotFound();
        const { title, theme, worldBrief, startingHook, pc, worldBible, worldRules, plotThreads, storyTime, sheet, characters = [] } = world;
        const opening = { worldBible, worldRules, plotThreads, storyTime, ...sheet };
        const id = saves.create({ title, theme, worldBrief, startingHook, pc, artStyle, opening });
        worlds.delete(req.params.id);
        const taken = (image: string) => heldOf(req.params.id, image)?.drawn;
        images.saveCreated(id, taken("portrait"));
        // Often still drawing. The Save may be gone by the time each lands, and a story without one loses nothing.
        const keep = (image: string, store: (drawn: DrawnImage & { bytes: Uint8Array }) => void) =>
          taken(image)
            ?.then((drawn) => drawn.bytes && store(drawn as DrawnImage & { bytes: Uint8Array }))
            .catch((error) => log.warning("images", "A picture from the form wasn't stored", { save: id, kind: kindOf(image), ...errorType(error) }));
        keep("cover", ({ bytes, prompt }) => saves.setCover(id, bytes, prompt));
        // By name, as the Narrator's NPCs go. One a Turn has drawn already keeps that portrait.
        // shortcut: an NPC the Narrator names differently from the form gets a portrait of their own, match looser if that shows.
        for (const { name, ref } of characters) {
          if (ref) keep(`npcs/${ref}`, ({ bytes, prompt }) => !saves.portraitOf(id, name) && saves.addPortrait(id, OPENING_SNAPSHOT, name, bytes, prompt));
        }
        for (const key of held.keys()) if (key.startsWith(`${req.params.id}/`)) held.delete(key);
        // After each picture above has been read, as heldOf reads from disk what isn't in memory.
        if (HELD_ID.test(req.params.id)) rmSync(join(heldDir, req.params.id), { recursive: true, force: true });
        return Response.json({ id }, { status: 201 });
      },
    },
    "/worlds/:id/cover": {
      GET: (req) => heldImage(req.params.id, "cover"),
      POST: (req) => redrawHeld(req.params.id, "cover", req),
      PUT: (req) => uploadHeld(req.params.id, "cover", req),
    },
    "/worlds/:id/cover/details": {
      GET: (req) => heldDetails(req.params.id, "cover"),
    },
    "/worlds/:id/portrait": {
      GET: (req) => heldImage(req.params.id, "portrait"),
      POST: (req) => redrawHeld(req.params.id, "portrait", req),
      PUT: (req) => uploadHeld(req.params.id, "portrait", req),
    },
    "/worlds/:id/portrait/details": {
      GET: (req) => heldDetails(req.params.id, "portrait"),
    },
    "/worlds/:id/npcs/:ref": {
      GET: (req) => heldImage(req.params.id, `npcs/${req.params.ref}`),
      POST: (req) => redrawHeld(req.params.id, `npcs/${req.params.ref}`, req),
      PUT: (req) => uploadHeld(req.params.id, `npcs/${req.params.ref}`, req),
    },
    "/worlds/:id/npcs/:ref/details": {
      GET: (req) => heldDetails(req.params.id, `npcs/${req.params.ref}`),
    },
    "/worlds/pick": {
      POST: async (req) => Response.json(await pickForMe(options, await parseBody(req, PickRequest), req.signal)),
    },
    "/enhance": {
      POST: async (req) => Response.json({ text: await enhance(options, await parseBody(req, EnhanceRequest), req.signal) }),
    },
    "/worlds/:id/regenerate": {
      POST: async (req) => {
        const { id } = req.params;
        const choices = await parseBody(req, WorldRequest);
        const before = worlds.get(id);
        if (!before) throw new WorldNotFound();
        const { overview, world } = await generateWorld(options, choices, before, req.signal);
        worlds.set(id, { ...before, ...world, ...choices });
        drawWorldImages(id, overview, choices);
        return Response.json({ overview });
      },
    },
  });
}
