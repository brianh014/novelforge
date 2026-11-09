import { drawingFamily, localIsSetUp, promptStyle, type PromptStyle, usesPortraits } from "./graph-builder";
import { artStyleFor } from "./web/art-styles";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { errorType, log } from "./logger";
import { type ImageTarget, imageType, OPENING_SNAPSHOT, type Pictured, type Save, SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";
import type { PictureAsk } from "./world-creation";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

type Npc = State["npcs"][number];
export type Scene = { changed: boolean; moved: boolean; description: string; location: string; npcs: Npc[]; wearing: string[]; portraits: Npc[] };
/** A `redraw` key marks what the player asked for by hand, which draws whatever the Settings now say. */
type Job = { kind: string; messageId: number; draw: (signal: AbortSignal) => Promise<void>; redraw?: string; scene?: boolean };
/** `world` is what the player can read of it: the World Overview, or the World Brief before there is one. */
type Cover = { title: string; theme: string; world: string; people?: string[] };
export type ImageKind = "cover" | "portrait";
/** An image held for a world with no Save yet. */
export type EarlyImage = { prompt: string; bytes?: Uint8Array<ArrayBuffer> };
/**
 * At most one image draws per Save. Portraits and Redraws go first, so a Scene Image can use them, and all of them wait
 * their turn, as each was asked for once. Of the scenes only the newest waits, so a run of quick Turns pays for two images.
 */
type Work = { running?: Job & { controller: AbortController }; queue: Job[]; waiting?: Job };
/** What one image of a moment is drawn from, with `description` as the prompt before its marks are expanded. */
type Moment = Pick<Scene, "description" | "npcs" | "wearing">;

// Sent as the negative prompt, because a Scene Image must not show the player a Check's numbers or dice either.
const AVOID = "text, captions, letters, numbers, dice";
// Not AVOID, as a cover shows its title.
const COVER_AVOID = "captions, author names, subtitles, taglines, labels, character names, dice";

const castOf = ({ scene }: State) => JSON.stringify(scene.visibleCast.toSorted());

/** Compares the structured scene, never a description of it. */
export const movedScene = (before: State, after: State) =>
  before.scene.location !== after.scene.location || castOf(before) !== castOf(after);

export const visibleNpcs = ({ scene, npcs }: State) =>
  scene.visibleCast.flatMap((name) => npcs.filter((npc) => npc.name === name));

/**
 * Who to ask for a portrait after a Turn. Anyone the PC just came to know, in view or not, and on every move of the
 * Scene everyone in it and everyone known, so someone missed is drawn then, without paying each Turn after a failure.
 */
export function portraitsDue(before: State, after: State) {
  const { scene, pcKnown } = after;
  const due = movedScene(before, after)
    ? [...scene.visibleCast, ...pcKnown.npcs]
    : pcKnown.npcs.filter((name) => !before.pcKnown.npcs.includes(name));
  return [...new Set(due)].flatMap((name) => after.npcs.filter((npc) => npc.name === name));
}

/**
 * `outfit` is the form's own words for what the PC wears and carries, before the Narrator has sorted them. Something is
 * always worn, as image models draw anyone they're not told is dressed without a shirt.
 */
export function pcLooks({ name, physicalTraits = "" }: Save["pc"], wearing: string[], outfit = "") {
  // A PC on the form may have no name yet, and an empty search would match between every letter.
  const unnamed = (text: string) => (name ? text.replaceAll(name, "this person") : text);
  const traits = unnamed(physicalTraits.trim().replace(/\s*\n\s*/g, " ").replace(/\.$/, ""));
  const dressed =
    wearing.length > 0
      ? `wearing ${wearing.join(", ")}`
      : outfit.trim()
        ? `fully clothed in what this says they wear, leaving out what they only carry: ${unnamed(outfit.trim().replace(/\s*\n\s*/g, " "))}`
        : "fully clothed in everyday clothes that suit them";
  return [traits, dressed].filter(Boolean).join(", ");
}

// Longer stored looks would crowd out the scene, as a player can write as much as they like for their PC.
const MOST_LOOKS_WORDS = 60;

const named = (full: string, mark: string) =>
  full.toLowerCase() === mark.toLowerCase() || full.toLowerCase().split(" ").includes(mark.toLowerCase());

/** Narrators shorten names, so part of one counts when it can only mean one person. */
function findPerson(npcs: Npc[], mark: string) {
  const exact = npcs.find(({ name }) => name === mark);
  if (exact) return exact;
  const partly = npcs.filter(({ name }) => named(name, mark));
  return partly.length === 1 ? partly[0] : undefined;
}

/**
 * Turns the Narrator's [Name: phrase] marks into what the model reads, so what a person does stays beside who they are
 * and no name reaches a model that might letter it into the picture. A portrait carries a face better than words, and
 * words that repeat it only cost length, so someone with a reference keeps the Narrator's short phrase and anyone else
 * gets their stored looks, which draw them the same every time.
 */
export function expandMarks(text: string, npcs: Npc[], pc: { name: string; looks: string }, hasReference: (person: string | null) => boolean = () => false) {
  const pictured: Pictured = [];
  const prompt = text.replace(/\[([^[\]:]+)(?::([^[\]]*))?\]/g, (_, mark: string, phrase = "") => {
    const brief = phrase.trim();
    const isPc = named(pc.name, mark.trim());
    const npc = isPc ? undefined : findPerson(npcs, mark.trim());
    if (!isPc && !npc) return brief || "a person";
    const person = isPc ? null : npc!.name;
    if (pictured.includes(person)) return "the same person";
    pictured.push(person);
    const looks = (isPc ? pc.looks : npc!.appearance).trim();
    const tooLong = looks.split(/\s+/).length > MOST_LOOKS_WORDS;
    return brief && (hasReference(person) || tooLong) ? brief : looks || brief || "a person";
  });
  return { prompt, pictured };
}

// What a head and shoulders frame can't show, as an image model squeezes the whole body in to fit a mention of feet.
const BELOW_THE_FRAME = /\b(?:hands?|wrists?|fingers?|arms?|legs?|knees?|feet|foot|barefoot|toes?|boots?|shoes?|sandals?|hose|breeches|trousers|pants|skirt|holding|carrying|clutching|gripping)\b/i;

/** shortcut: drops whole comma clauses, so a clause naming hair and feet together loses the hair, split finer if fallbacks get common. */
export const chestUp = (looks: string) =>
  looks
    .split(",")
    .filter((clause) => !BELOW_THE_FRAME.test(clause))
    .join(",")
    .trim();

const portraitPrompt = (looks: string, style: PromptStyle) =>
  style === "keywords"
    ? `head and shoulders portrait, one person, plain background, ${chestUp(looks)}`
    : `A head and shoulders portrait of one person, ${chestUp(looks)}, facing the viewer against a plain neutral background in soft even light.`;

type Role = ImagePayload["reference_images"][number]["role"];

/**
 * Says what the portraits are for, as an image model otherwise copies a portrait's clothing into the picture.
 */
export function withReferenceRoles(prompt: string, references: { role: Role }[]) {
  const roles = new Set(references.map(({ role }) => role));
  const portraits = roles.has("npc") || roles.has("pc") ? " The portraits show only each person's face and hair: dress and pose everyone as written here." : "";
  if (!portraits) return prompt;
  return `${prompt.trim().replace(/[^.!?]$/, "$&.")}${portraits}`;
}

export const coverPrompt = ({ title, theme, world, people = [] }: Cover) =>
  `The front cover of a novel, one striking image of its world and the people in it, not a moment from the story. Letter its title as part of the artwork, in the upper third of the cover. The title is this JSON string, spelled exactly: ${JSON.stringify(title)}
The title is the only writing anywhere on the cover: no author name, subtitle, tagline, label, name or any other words.
Theme: ${theme}
The world: ${world}${people.length > 0 ? `\nShow these people on the cover, the first in front as its hero, each looking as described: ${people.map((looks) => `(${looks})`).join(" ")}` : ""}`;

/**
 * The PC and the Important Characters as a cover shows them, by looks alone, as a name in an image prompt gets lettered.
 * shortcut: a character with no description is left off, and one is only as drawn as their description says, ask for looks if covers miss them.
 */
export function coverPeople(pc: Save["pc"], wearing: string[], characters: { name: string; description: string }[], outfit = "") {
  const names = [pc.name, ...characters.map(({ name }) => name)].filter(Boolean);
  const unnamed = (text: string) => names.reduce((words, name) => words.replaceAll(name, "someone"), text);
  return [pcLooks(pc, wearing, outfit), ...characters.map(({ description }) => unnamed(description.trim()))].filter(Boolean);
}

/** `portrait` is the PC's, so the hero on the cover looks like them. */
// No style_preset in any payload: each Image Prompt carries its own Art Style, as the text model writes the whole of it.
// shortcut: an image from before that has no Art Style in its prompt, so its Redraw draws without one, Update writes it in.
const coverPayload = (prompt: string, portrait?: { bytes: Uint8Array; mediaType: string } | null): ImagePayload => ({
  prompt,
  negative_prompt: COVER_AVOID,
  aspect_ratio: "2:3",
  reference_images: reference("pc", portrait),
  style_preset: "",
});

/** `face` is the portrait being updated, so the new one keeps that face and takes the clothing from the prompt. */
const portraitPayload = (prompt: string, face: ImagePayload["reference_images"] = []): ImagePayload => ({
  prompt: withReferenceRoles(prompt, face),
  negative_prompt: AVOID,
  aspect_ratio: "1:1",
  reference_images: face,
  style_preset: "",
});

/** The adapters' messages are written to be shown, but a failed connection is Bun's own, which has a `code`. */
export function shownFailure(error: unknown) {
  const { code, message } = error as Error & { code?: string };
  return code ? "The image model can't be reached. Make sure it's running." : message;
}

const reference = (role: Role, image: { bytes: Uint8Array; mediaType: string } | null | undefined) =>
  image ? [{ role, ...image }] : [];

/**
 * Decides when a Scene Image or portrait is drawn, and draws it in the background. Jobs live in memory, so stopping the
 * server loses the one in flight: its Turn stands and that scene just has no image, which is cheaper than redrawing it.
 */
/** Writes a Cover's or portrait's Image Prompt for the image model's family, or gives back `fallback`. */
export type PictureWriter = (ask: PictureAsk, style: PromptStyle, fallback: string, signal: AbortSignal) => Promise<string>;

export function imagePipeline(
  saves: SaveStore,
  adapters: Record<ReturnType<SettingsStore["read"]>["imageProvider"], ImageAdapter>,
  settings: SettingsStore,
  writePicture: PictureWriter = async (_ask, _style, fallback) => fallback,
) {
  /** Waits to be called, so a held image can start drawing as soon as its prompt is written. Its template is the fallback. */
  const writer = (ask: PictureAsk) => (signal: AbortSignal) => {
    const style = promptStyle(settings.read());
    const template = ask.kind === "cover" ? coverPrompt(ask) : portraitPrompt(ask.looks, style);
    const styled = { ...ask, artStyle: artStyleFor(ask.artStyle, drawingFamily(settings.read())) };
    // The Art Style first, as the text model would have put it.
    return writePicture(styled, style, [styled.artStyle.trim(), template].filter(Boolean).join("\n"), signal);
  };

  const work = new Map<string, Work>();
  // shortcut: in memory, so a restart forgets a failed Redraw, which leaves the old image anyway.
  const failures = new Map<string, string>();
  // shortcut: in memory and one per Save, so a restart or a second failure loses it, and that picture was never drawn anyway.
  const requestFailures = new Map<string, { error: string; words: string }>();
  let session = 0;

  // Below, only the error's type and status go to the Server Log, as an image model's message can repeat the Image Prompt.
  const about = (id: string, { kind, messageId }: Pick<Job, "kind" | "messageId">) => ({ save: id, kind, message: messageId });
  const queued = (id: string, job: Job) => {
    log.verbose("images", "Image queued", () => about(id, job));
    return job;
  };
  const dropped = (id: string, job: Job, reason: string) => log.info("images", "Image dropped", { ...about(id, job), reason });

  const adapter: ImageAdapter = (payload, signal) => adapters[settings.read().imageProvider](payload, signal);

  function ready() {
    const current = settings.read();
    // An unfinished setup is silent too, as there is no image to report failing.
    const setUp =
      current.imageProvider === "local" ? localIsSetUp(current) : current.imageModel && current.imageApiKey;
    return current.imagesEnabled && setUp;
  }

  /**
   * The PC comes first, then the NPCs in the prompt's order, so a model that takes few references, such as Klein, drops an
   * NPC rather than the PC. A portrait of someone not in the picture can get pasted into it, so only those pictured go in.
   * No earlier Scene Image goes in, as FLUX.2 copied its people, poses and clothing into the new one whatever the prompt said.
   */
  const references = (id: string, pictured: Pictured) => [
    ...(pictured.includes(null) ? reference("pc", saves.portraitOf(id, null)) : []),
    ...pictured.flatMap((name) => (name === null ? [] : reference("npc", saves.portraitOf(id, name)))),
  ];

  const scenePayload = (id: string, prompt: string, pictured: Pictured): ImagePayload => {
    const reference_images = references(id, pictured);
    return { prompt: withReferenceRoles(prompt, reference_images), negative_prompt: AVOID, aspect_ratio: "16:9", reference_images, style_preset: "" };
  };

  async function drawMoment(id: string, { description, npcs, wearing }: Moment, signal: AbortSignal) {
    const { pc } = saves.read(id);
    const hasReference = (person: string | null) => usesPortraits(settings.read()) && !!saves.portraitOf(id, person);
    const { prompt, pictured } = expandMarks(description, npcs, { name: pc.name, looks: pcLooks(pc, wearing) }, hasReference);
    const bytes = await adapter(scenePayload(id, prompt, pictured), signal);
    // Counted before storing, as the player has paid for it whether or not its Message is still there.
    session++;
    return { prompt, pictured, bytes };
  }

  async function drawScene(id: string, messageId: number, scene: Scene, signal: AbortSignal) {
    const { prompt, pictured, bytes } = await drawMoment(id, scene, signal);
    saves.addSceneImage(id, messageId, scene.location, bytes, prompt, pictured);
    log.info("images", "Image drawn", about(id, { kind: "scene", messageId }));
  }

  async function drawPortrait(id: string, messageId: number, npc: Npc | undefined, signal: AbortSignal, early?: Promise<EarlyImage>) {
    const held = await early;
    if (held?.bytes) {
      saves.addPortrait(id, messageId, null, held.bytes, held.prompt);
      return log.info("images", "Image drawn", about(id, { kind: "portrait", messageId }));
    }
    // shortcut: a person keeps their first portrait when update_npc changes their looks, redraw if that shows in play.
    const name = npc?.name ?? null;
    const { pc, artStyle, theme, worldBrief } = saves.read(id);
    const looks = npc ? npc.appearance : pc.physicalTraits?.trim() && pcLooks(pc, saves.latestState(id).inventory.wearing);
    if (!looks || saves.portraitOf(id, name)) return;
    const prompt = await writer({ kind: "portrait", looks, theme, world: worldBrief, artStyle })(signal);
    const bytes = await adapter(portraitPayload(prompt), signal);
    session++;
    saves.addPortrait(id, messageId, name, bytes, prompt);
    log.info("images", "Image drawn", about(id, { kind: "portrait", messageId }));
  }

  /** The same kind of request that made the image, so only the prompt, the Art Style and the Settings can differ. */
  function redrawPayload(id: string, { kind, ref }: ImageTarget, messageId: number, prompt: string, keepFace = false) {
    if (kind === "scene" || kind === "requested") {
      const state = saves.snapshot(id, messageId);
      // An image from before this kept no record, and was drawn from the cast and the PC.
      const pictured = saves.pictured(id, { kind, ref }) ?? [...visibleNpcs(state).map(({ name }) => name), null];
      return scenePayload(id, prompt, pictured);
    }
    if (kind === "cover") return coverPayload(prompt, saves.portraitOf(id, null));
    if (!keepFace) return portraitPayload(prompt);
    const bytes = saves.portrait(id, ref);
    const mediaType = imageType(bytes);
    const role = saves.portraits(id).find((portrait) => portrait.id === ref)?.npc === null ? "pc" : "npc";
    return portraitPayload(prompt, reference(role, mediaType && { bytes, mediaType }));
  }

  const redrawKey = (id: string, { kind, ref }: ImageTarget) => `${id}/${kind}/${ref}`;
  const requestKey = (id: string) => `${id}/requested`;

  function isRedrawing(id: string, key: string) {
    const jobs = work.get(id);
    return !!jobs && [...jobs.queue, jobs.running].some((job) => job?.redraw === key);
  }

  async function drawIfReady(job: Job, signal: AbortSignal) {
    if (job.redraw || ready()) await job.draw(signal);
  }

  async function drain(id: string, jobs: Work) {
    while (jobs.queue.length > 0 || jobs.waiting) {
      const job = jobs.queue.shift() ?? jobs.waiting!;
      if (job === jobs.waiting) jobs.waiting = undefined;
      const controller = new AbortController();
      jobs.running = { ...job, controller };
      log.verbose("images", "Image started", () => about(id, job));
      await drawIfReady(job, controller.signal).catch((error) => {
        if (error instanceof SaveNotFound) dropped(id, job, "the Save is gone");
        else if (!controller.signal.aborted) log.error("images", "Image failed", { ...about(id, job), ...errorType(error) });
      });
      log.verbose("images", "Image finished", () => about(id, job));
    }
    work.delete(id);
  }

  function enqueue(id: string, add: (jobs: Work) => void) {
    const busy = work.get(id);
    const jobs: Work = busy ?? { queue: [] };
    add(jobs);
    if (busy || (jobs.queue.length === 0 && !jobs.waiting)) return;
    work.set(id, jobs);
    void drain(id, jobs);
  }

  const portraitJob = (id: string, messageId: number, npc?: Npc, early?: Promise<EarlyImage>): Job =>
    queued(id, { kind: "portrait", messageId, draw: (signal) => drawPortrait(id, messageId, npc, signal, early) });

  return {
    ready: () => Boolean(ready()),

    /**
     * A Cover or the PC's portrait, for a world that has no Save yet. Its prompt holds only what the player reads, as
     * nothing here knows the World Bible. Undefined when images are off, and a failure is the caller's to report.
     */
    async drawEarly(kind: ImageKind, prompt: string, signal: AbortSignal, portrait?: Uint8Array) {
      if (!ready()) return undefined;
      const mediaType = portrait && imageType(portrait);
      const payload = kind === "cover" ? coverPayload(prompt, mediaType ? { bytes: portrait!, mediaType } : null) : portraitPayload(prompt);
      const bytes = await adapter(payload, signal);
      session++;
      return bytes;
    },

    writer,

    /** False when that image is already being redrawn. Jobs live in memory, so stopping the server loses this one too, and the old image stands. */
    /**
     * `prompt` is the player's own, or for an Update, a writer that makes a new one when the job's turn comes. An Update of a
     * portrait keeps its face, as the player wants the same person as they are now.
     */
    redraw(id: string, target: ImageTarget, messageId: number, prompt: string | ((signal: AbortSignal) => Promise<string>)) {
      const keepFace = typeof prompt !== "string" && target.kind === "portrait";
      const key = redrawKey(id, target);
      if (isRedrawing(id, key)) return false;
      failures.delete(key);
      const kind = `${target.kind} redraw`;
      const draw = async (signal: AbortSignal) => {
        try {
          const written = typeof prompt === "string" ? prompt : await prompt(signal);
          const bytes = await adapter(redrawPayload(id, target, messageId, written, keepFace), signal);
          session++;
          saves.replaceImage(id, target, written, bytes);
          log.info("images", "Image drawn", about(id, { kind, messageId }));
        } catch (error) {
          if (!signal.aborted && !(error instanceof SaveNotFound)) failures.set(key, shownFailure(error));
          throw error;
        }
      };
      enqueue(id, (jobs) => jobs.queue.push(queued(id, { kind, messageId, draw, redraw: key })));
      return true;
    },

    redrawState(id: string, target: ImageTarget) {
      const key = redrawKey(id, target);
      return { redrawing: isRedrawing(id, key), failure: failures.get(key) ?? "" };
    },

    /**
     * An image the player asked for by hand, which joins `messageId` and waits its turn, as their one press must not be dropped.
     * `write` makes the Image Prompt, so the player needn't wait for it. A failure is held for the player, and only the step that failed
     * reaches the log, as a provider's error can repeat the prompt and the story.
     */
    drawRequested(id: string, messageId: number, words: string, moment: Omit<Moment, "description">, write: (signal: AbortSignal) => Promise<{ text: string; title: string }>) {
      requestFailures.delete(id);
      const draw = async (signal: AbortSignal) => {
        let step = "writing its prompt";
        try {
          const { text: description, title } = await write(signal);
          step = "drawing it";
          const { prompt, pictured, bytes } = await drawMoment(id, { ...moment, description }, signal);
          saves.addRequestedImage(id, messageId, words || title.trim().slice(0, 80) || "The current scene", bytes, prompt, pictured);
          log.info("images", "Image drawn", about(id, { kind: "requested", messageId }));
        } catch (error) {
          if (signal.aborted || error instanceof SaveNotFound) return;
          log.error("images", `A requested image failed ${step}.`, { ...about(id, { kind: "requested", messageId }), ...errorType(error) });
          requestFailures.set(id, { error: `The picture wasn't drawn. ${shownFailure(error).replace(/\.?$/, ".")}`, words });
        }
      };
      enqueue(id, (jobs) => jobs.queue.push(queued(id, { kind: "requested", messageId, draw, redraw: requestKey(id) })));
    },

    /** Reading a failure takes it, so it's told once. */
    takeRequestFailure(id: string) {
      const failure = requestFailures.get(id);
      requestFailures.delete(id);
      return failure;
    },

    /** How many requested images are on the way. */
    drawing(id: string) {
      const jobs = work.get(id);
      return jobs ? [...jobs.queue, jobs.running].filter((job) => job?.redraw === requestKey(id)).length : 0;
    },

    /**
     * The PC's portrait outlives every Revert, so no Message holds it. Nothing here may delay the new Save. An `early`
     * portrait waits in the queue, so a Turn can neither draw a second nor miss it as a reference. If it came to nothing, one is drawn.
     */
    saveCreated(id: string, early?: Promise<EarlyImage>) {
      enqueue(id, (jobs) => jobs.queue.push(portraitJob(id, OPENING_SNAPSHOT, undefined, early)));
    },

    /**
     * The Turn has already committed, so nothing here may throw into it. A job does nothing for someone who has a
     * portrait, so a person missed while images were off, or by a failed generation, is drawn when the Scene next moves.
     */
    sceneChanged(id: string, messageId: number, scene: Scene) {
      enqueue(id, (jobs) => {
        if (scene.moved) jobs.queue.push(portraitJob(id, OPENING_SNAPSHOT));
        jobs.queue.push(...scene.portraits.map((npc) => portraitJob(id, messageId, npc)));
        if (scene.changed && scene.description) {
          if (jobs.waiting) dropped(id, jobs.waiting, "a newer scene");
          jobs.waiting = queued(id, { kind: "scene", messageId, scene: true, draw: (signal) => drawScene(id, messageId, scene, signal) });
        }
      });
    },

    /** Whether `messageId`'s Scene Image is still on the way. */
    sceneDrawing(id: string, messageId: number) {
      const jobs = work.get(id);
      return [jobs?.waiting, jobs?.running].some((job) => job?.scene && job.messageId === messageId);
    },

    /**
     * Drops every job for a Message after `messageId`, for when those Messages or the whole Save go. Cancelling is not
     * billed, and a job that finishes regardless finds its Message gone, as Message ids are never reused.
     */
    forget(id: string, messageId: number, reason: string) {
      const jobs = work.get(id);
      if (!jobs) return;
      const gone = [...jobs.queue, jobs.waiting, jobs.running].filter((job) => job && job.messageId > messageId);
      for (const job of gone) dropped(id, job!, reason);
      jobs.queue = jobs.queue.filter((job) => job.messageId <= messageId);
      if (jobs.waiting && jobs.waiting.messageId > messageId) jobs.waiting = undefined;
      if (jobs.running && jobs.running.messageId > messageId) jobs.running.controller.abort();
    },

    status: (id: string) => ({ pending: work.has(id), session }),
  };
}
