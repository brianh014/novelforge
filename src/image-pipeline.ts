import { localIsSetUp, promptStyle, type PromptStyle, usesPortraits } from "./graph-builder";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { type ImageTarget, OPENING_SNAPSHOT, type Pictured, type Save, SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

type Npc = State["npcs"][number];
export type Scene = { changed: boolean; moved: boolean; description: string; location: string; npcs: Npc[]; wearing: string[]; portraits: Npc[] };
/** A `redraw` key marks what the player asked for by hand, which draws whatever the Settings now say. */
type Job = { messageId: number; draw: (signal: AbortSignal) => Promise<void>; redraw?: string; scene?: boolean };
/** `world` is what the player can read of it: the World Overview, or the World Brief before there is one. */
type Cover = { title: string; theme: string; world: string };
export type ImageKind = "cover" | "portrait";
/** An image held for a world with no Save yet. */
export type EarlyImage = { prompt: string; bytes?: Uint8Array<ArrayBuffer> };
/**
 * At most one image draws per Save. Portraits and Redraws go first, so a Scene Image can use them, and all of them wait
 * their turn, as each was asked for once. Of the scenes only the newest waits, so a run of quick Turns pays for two images.
 */
type Work = { running?: Job & { controller: AbortController }; queue: Job[]; waiting?: Job };
/** What one image of a moment is drawn from, with `description` as the prompt before its marks are expanded. */
type Moment = Pick<Scene, "description" | "location" | "npcs" | "wearing">;

// Sent as the negative prompt, because a Scene Image must not show the player a Check's numbers or dice either.
const AVOID = "text, captions, letters, numbers, dice";
// Not AVOID, as a cover shows its title.
const COVER_AVOID = "captions, author names, taglines, dice";

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

export function pcLooks({ name, physicalTraits = "" }: Save["pc"], wearing: string[]) {
  const traits = physicalTraits.trim().replace(/\s*\n\s*/g, " ").replace(/\.$/, "");
  // A PC on the form may have no name yet, and an empty search would match between every letter.
  return [name ? traits.replaceAll(name, "this person") : traits, wearing.length > 0 && `wearing ${wearing.join(", ")}`].filter(Boolean).join(", ");
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

const portraitPrompt = (looks: string, style: PromptStyle) =>
  style === "keywords"
    ? `head and shoulders portrait, one person, plain background, ${looks}`
    : `A head and shoulders portrait of one person, ${looks}, facing the viewer against a plain neutral background in soft even light.`;

type Role = ImagePayload["reference_images"][number]["role"];

// A requested image follows its Message's own Scene Image, which may be the background to carry on from.
const afterItsScene = (messageId: number) => messageId + 1;

export const coverPrompt = ({ title, theme, world }: Cover) =>
  `The front cover of a novel, one striking image of its world's mood and subject, not a moment from the story. Letter its title as part of the artwork, in the upper third of the cover. The title is this JSON string, spelled exactly, and it must be the only lettering on the cover: ${JSON.stringify(title)}\nTheme: ${theme}\nThe world: ${world}`;

const coverPayload = (prompt: string, style_preset: string): ImagePayload => ({
  prompt,
  negative_prompt: COVER_AVOID,
  aspect_ratio: "2:3",
  reference_images: [],
  style_preset,
});

const portraitPayload = (prompt: string, style_preset: string): ImagePayload => ({
  prompt,
  negative_prompt: AVOID,
  aspect_ratio: "1:1",
  reference_images: [],
  style_preset,
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
export function imagePipeline(
  saves: SaveStore,
  adapters: Record<ReturnType<SettingsStore["read"]>["imageProvider"], ImageAdapter>,
  settings: SettingsStore,
) {
  const work = new Map<string, Work>();
  // shortcut: in memory, so a restart forgets a failed Redraw, which leaves the old image anyway.
  const failures = new Map<string, string>();
  // shortcut: in memory and one per Save, so a restart or a second failure loses it, and that picture was never drawn anyway.
  const requestFailures = new Map<string, { error: string; words: string }>();
  let session = 0;

  const adapter: ImageAdapter = (payload, signal) => adapters[settings.read().imageProvider](payload, signal);

  function ready() {
    const current = settings.read();
    // An unfinished setup is silent too, as there is no image to report failing.
    const setUp =
      current.imageProvider === "local" ? localIsSetUp(current) : current.imageModel && current.imageApiKey;
    return current.imagesEnabled && setUp;
  }

  /** Identity comes first when a model takes few references. A portrait of someone not in the picture can get pasted into it. */
  const references = (id: string, messageId: number, location: string, pictured: Pictured) => [
    ...pictured.flatMap((name) => (name === null ? [] : reference("npc", saves.portraitOf(id, name)))),
    ...reference("previous_scene", saves.previousSceneImage(id, messageId, location)),
    ...(pictured.includes(null) ? reference("pc", saves.portraitOf(id, null)) : []),
  ];

  const scenePayload = (id: string, messageId: number, prompt: string, location: string, pictured: Pictured): ImagePayload => ({
    prompt,
    negative_prompt: AVOID,
    aspect_ratio: "16:9",
    reference_images: references(id, messageId, location, pictured),
    style_preset: saves.read(id).artStyle,
  });

  /** `before` is the Message whose earlier Scene Image, if any, can carry its background into this one. */
  async function drawMoment(id: string, before: number, { description, location, npcs, wearing }: Moment, signal: AbortSignal) {
    const { pc } = saves.read(id);
    const hasReference = (person: string | null) => usesPortraits(settings.read()) && !!saves.portraitOf(id, person);
    const { prompt, pictured } = expandMarks(description, npcs, { name: pc.name, looks: pcLooks(pc, wearing) }, hasReference);
    const bytes = await adapter(scenePayload(id, before, prompt, location, pictured), signal);
    // Counted before storing, as the player has paid for it whether or not its Message is still there.
    session++;
    return { prompt, pictured, bytes };
  }

  async function drawScene(id: string, messageId: number, scene: Scene, signal: AbortSignal) {
    const { prompt, pictured, bytes } = await drawMoment(id, messageId, scene, signal);
    saves.addSceneImage(id, messageId, scene.location, bytes, prompt, pictured);
  }

  async function drawPortrait(id: string, messageId: number, npc: Npc | undefined, signal: AbortSignal, early?: Promise<EarlyImage>) {
    const held = await early;
    if (held?.bytes) return saves.addPortrait(id, messageId, null, held.bytes, held.prompt);
    // shortcut: a person keeps their first portrait when update_npc changes their looks, redraw if that shows in play.
    const name = npc?.name ?? null;
    const { pc, artStyle } = saves.read(id);
    const looks = npc ? npc.appearance : pc.physicalTraits?.trim() && pcLooks(pc, saves.latestState(id).inventory.wearing);
    if (!looks || saves.portraitOf(id, name)) return;
    const prompt = portraitPrompt(looks, promptStyle(settings.read()));
    const bytes = await adapter(portraitPayload(prompt, artStyle), signal);
    session++;
    saves.addPortrait(id, messageId, name, bytes, prompt);
  }

  /** The same kind of request that made the image, so only the prompt, the Art Style and the Settings can differ. */
  function redrawPayload(id: string, { kind, ref }: ImageTarget, messageId: number, prompt: string) {
    if (kind === "scene" || kind === "requested") {
      const state = saves.snapshot(id, messageId);
      // An image from before this kept no record, and was drawn from the cast and the PC.
      const pictured = saves.pictured(id, { kind, ref }) ?? [...visibleNpcs(state).map(({ name }) => name), null];
      return scenePayload(id, kind === "scene" ? messageId : afterItsScene(messageId), prompt, state.scene.location, pictured);
    }
    return (kind === "cover" ? coverPayload : portraitPayload)(prompt, saves.read(id).artStyle);
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
      // Image API errors stay in this log, as they may repeat the prompt, and the Turn already stands.
      await drawIfReady(job, controller.signal).catch((error) => {
        if (!(error instanceof SaveNotFound) && !controller.signal.aborted) console.error(error);
      });
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

  const portraitJob = (id: string, messageId: number, npc?: Npc, early?: Promise<EarlyImage>): Job => ({
    messageId,
    draw: (signal) => drawPortrait(id, messageId, npc, signal, early),
  });

  return {
    ready: () => Boolean(ready()),

    /**
     * A Cover or the PC's portrait, for a world that has no Save yet. Its prompt holds only what the player reads, as
     * nothing here knows the World Bible. Undefined when images are off, and a failure is the caller's to report.
     */
    async drawEarly(kind: ImageKind, prompt: string, artStyle: string, signal: AbortSignal) {
      if (!ready()) return undefined;
      const bytes = await adapter((kind === "cover" ? coverPayload : portraitPayload)(prompt, artStyle), signal);
      session++;
      return bytes;
    },

    /** Empty for a PC with no physical traits, who gets no portrait. */
    pcPortraitPrompt: (pc: Save["pc"], wearing: string[]) => (pc.physicalTraits?.trim() ? portraitPrompt(pcLooks(pc, wearing), promptStyle(settings.read())) : ""),

    /** False when that image is already being redrawn. Jobs live in memory, so stopping the server loses this one too, and the old image stands. */
    redraw(id: string, target: ImageTarget, messageId: number, prompt: string) {
      const key = redrawKey(id, target);
      if (isRedrawing(id, key)) return false;
      failures.delete(key);
      const draw = async (signal: AbortSignal) => {
        try {
          const bytes = await adapter(redrawPayload(id, target, messageId, prompt), signal);
          session++;
          saves.replaceImage(id, target, prompt, bytes);
        } catch (error) {
          if (!signal.aborted && !(error instanceof SaveNotFound)) failures.set(key, shownFailure(error));
          // Kept from the log below, as the error can repeat the prompt, and the player is told.
          if (target.kind !== "requested") throw error;
        }
      };
      enqueue(id, (jobs) => jobs.queue.push({ messageId, draw, redraw: key }));
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
    drawRequested(id: string, messageId: number, words: string, moment: Omit<Moment, "description">, write: (signal: AbortSignal) => Promise<string>) {
      requestFailures.delete(id);
      const draw = async (signal: AbortSignal) => {
        let step = "writing its prompt";
        try {
          const description = await write(signal);
          step = "drawing it";
          const { prompt, pictured, bytes } = await drawMoment(id, afterItsScene(messageId), { ...moment, description }, signal);
          saves.addRequestedImage(id, messageId, words, bytes, prompt, pictured);
        } catch (error) {
          if (signal.aborted || error instanceof SaveNotFound) return;
          console.error(`A requested image failed ${step}.`);
          requestFailures.set(id, { error: `The picture wasn't drawn. ${shownFailure(error).replace(/\.?$/, ".")}`, words });
        }
      };
      enqueue(id, (jobs) => jobs.queue.push({ messageId, draw, redraw: requestKey(id) }));
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
          jobs.waiting = { messageId, scene: true, draw: (signal) => drawScene(id, messageId, scene, signal) };
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
    forget(id: string, messageId: number) {
      const jobs = work.get(id);
      if (!jobs) return;
      jobs.queue = jobs.queue.filter((job) => job.messageId <= messageId);
      if (jobs.waiting && jobs.waiting.messageId > messageId) jobs.waiting = undefined;
      if (jobs.running && jobs.running.messageId > messageId) jobs.running.controller.abort();
    },

    status: (id: string) => ({ pending: work.has(id), session }),
  };
}
