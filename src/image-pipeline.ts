import { localIsSetUp } from "./graph-builder";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { type ImageTarget, OPENING_SNAPSHOT, type Save, SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

type Npc = State["npcs"][number];
export type Scene = { changed: boolean; moved: boolean; description: string; location: string; visible: Npc[]; portraits: Npc[] };
/** A `redraw` key marks what the player asked for by hand, which draws whatever the Settings now say. */
type Job = { messageId: number; draw: (signal: AbortSignal) => Promise<void>; redraw?: string };
type Cover = { title: string; theme: string; overview: string };
/**
 * At most one image draws per Save. Portraits and Redraws go first, so a Scene Image can use them, and all of them wait
 * their turn, as each was asked for once. Of the scenes only the newest waits, so a run of quick Turns pays for two images.
 */
type Work = { running?: Job & { controller: AbortController }; queue: Job[]; waiting?: Job };

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

const pcDescription = ({ physicalTraits, background, personality, skills, other }: Save["pc"]) =>
  [physicalTraits, background, personality, skills, other].filter(Boolean).join("\n");

type Role = ImagePayload["reference_images"][number]["role"];

export const coverPrompt = ({ title, theme, overview }: Cover) =>
  `The front cover of a novel, one striking image of its world's mood and subject, not a moment from the story. Letter its title as part of the artwork, in the upper third of the cover. The title is this JSON string, spelled exactly, and it must be the only lettering on the cover: ${JSON.stringify(title)}\nTheme: ${theme}\nThe world: ${overview}`;

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
  let session = 0;

  const adapter: ImageAdapter = (payload, signal) => adapters[settings.read().imageProvider](payload, signal);

  function ready() {
    const current = settings.read();
    // An unfinished setup is silent too, as there is no image to report failing.
    const setUp =
      current.imageProvider === "local" ? localIsSetUp(current) : current.imageModel && current.imageApiKey;
    return current.imagesEnabled && setUp;
  }

  /** Identity comes first when a model takes few references. A Scene Image is what the PC sees, so the PC is rarely in it. */
  const references = (id: string, messageId: number, location: string, visible: Npc[]) => [
    ...visible.flatMap(({ name }) => reference("npc", saves.portraitOf(id, name))),
    ...reference("previous_scene", saves.previousSceneImage(id, messageId, location)),
    ...reference("pc", saves.portraitOf(id, null)),
  ];

  const scenePayload = (id: string, messageId: number, prompt: string, location: string, visible: Npc[]): ImagePayload => ({
    prompt,
    negative_prompt: AVOID,
    aspect_ratio: "16:9",
    reference_images: references(id, messageId, location, visible),
    style_preset: saves.read(id).artStyle,
  });

  async function drawScene(id: string, messageId: number, { description, location, visible }: Scene, signal: AbortSignal) {
    const looks = visible.map(({ appearance }) => appearance).filter(Boolean);
    // Looks without names, as a model may letter a name into the picture.
    const prompt = looks.length > 0 ? `${description}\nPeople in view: ${looks.join("; ")}` : description;
    const bytes = await adapter(scenePayload(id, messageId, prompt, location, visible), signal);
    // Counted before storing, as the player has paid for it whether or not its Message is still there.
    session++;
    saves.addSceneImage(id, messageId, location, bytes, prompt);
  }

  async function drawPortrait(id: string, messageId: number, npc: Npc | undefined, signal: AbortSignal) {
    // shortcut: a person keeps their first portrait when update_npc changes their looks, redraw if that shows in play.
    const name = npc?.name ?? null;
    const { pc, artStyle } = saves.read(id);
    const description = npc ? npc.appearance : pcDescription(pc);
    if (!description || saves.portraitOf(id, name)) return;
    const prompt = `A head and shoulders portrait of one person against a plain background.\n${description}`;
    const bytes = await adapter(portraitPayload(prompt, artStyle), signal);
    session++;
    saves.addPortrait(id, messageId, name, bytes, prompt);
  }

  /** The same kind of request that made the image, so only the prompt, the Art Style and the Settings can differ. */
  function redrawPayload(id: string, { kind, ref }: ImageTarget, prompt: string) {
    if (kind === "scene") {
      const state = saves.snapshot(id, ref);
      return scenePayload(id, ref, prompt, state.scene.location, visibleNpcs(state));
    }
    return (kind === "cover" ? coverPayload : portraitPayload)(prompt, saves.read(id).artStyle);
  }

  const redrawKey = (id: string, { kind, ref }: ImageTarget) => `${id}/${kind}/${ref}`;

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

  const portraitJob = (id: string, messageId: number, npc?: Npc): Job => ({
    messageId,
    draw: (signal) => drawPortrait(id, messageId, npc, signal),
  });

  return {
    ready: () => Boolean(ready()),

    /**
     * A story's cover, for a world that has no Save yet. Its prompt holds only what the player reads, as nothing here
     * knows the World Bible. Undefined when images are off, and a failure is the caller's to report.
     */
    async drawCover(prompt: string, artStyle: string, signal: AbortSignal) {
      if (!ready()) return undefined;
      const bytes = await adapter(coverPayload(prompt, artStyle), signal);
      session++;
      return bytes;
    },

    /** False when that image is already being redrawn. Jobs live in memory, so stopping the server loses this one too, and the old image stands. */
    redraw(id: string, target: ImageTarget, messageId: number, prompt: string) {
      const key = redrawKey(id, target);
      if (isRedrawing(id, key)) return false;
      failures.delete(key);
      const draw = async (signal: AbortSignal) => {
        try {
          const bytes = await adapter(redrawPayload(id, target, prompt), signal);
          session++;
          saves.replaceImage(id, target, prompt, bytes);
        } catch (error) {
          if (!signal.aborted && !(error instanceof SaveNotFound)) failures.set(key, shownFailure(error));
          throw error;
        }
      };
      enqueue(id, (jobs) => jobs.queue.push({ messageId, draw, redraw: key }));
      return true;
    },

    redrawState(id: string, target: ImageTarget) {
      const key = redrawKey(id, target);
      return { redrawing: isRedrawing(id, key), failure: failures.get(key) ?? "" };
    },

    /** The PC's portrait outlives every Revert, so no Message holds it. Nothing here may delay the new Save. */
    saveCreated(id: string) {
      enqueue(id, (jobs) => jobs.queue.push(portraitJob(id, OPENING_SNAPSHOT)));
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
          jobs.waiting = { messageId, draw: (signal) => drawScene(id, messageId, scene, signal) };
        }
      });
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
