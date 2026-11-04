import { localIsSetUp } from "./graph-builder";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { OPENING_SNAPSHOT, type Save, SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

type Npc = State["npcs"][number];
export type Scene = { changed: boolean; moved: boolean; description: string; location: string; visible: Npc[] };
type Job = { messageId: number; draw: (signal: AbortSignal) => Promise<void> };
type Cover = { theme: string; overview: string; artStyle?: string };
/**
 * At most one image draws per Save. Portraits go first, so a Scene Image can use them, and all of them wait their turn,
 * as a person is only drawn once. Of the scenes only the newest waits, so a run of quick Turns pays for two images.
 */
type Work = { running?: Job & { controller: AbortController }; portraits: Job[]; waiting?: Job };

// Sent as the negative prompt, because a Scene Image must not show the player a Check's numbers or dice either.
const AVOID = "text, captions, letters, numbers, dice";

const castOf = ({ scene }: State) => JSON.stringify(scene.visibleCast.toSorted());

/** Compares the structured scene, never a description of it. */
export const movedScene = (before: State, after: State) =>
  before.scene.location !== after.scene.location || castOf(before) !== castOf(after);

export const visibleNpcs = ({ scene, npcs }: State) =>
  scene.visibleCast.flatMap((name) => npcs.filter((npc) => npc.name === name));

const pcDescription = ({ physicalTraits, background, personality, skills, other }: Save["pc"]) =>
  [physicalTraits, background, personality, skills, other].filter(Boolean).join("\n");

type Role = ImagePayload["reference_images"][number]["role"];

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
  const references = (id: string, messageId: number, visible: Npc[]) => [
    ...visible.flatMap(({ name }) => reference("npc", saves.portraitOf(id, name))),
    ...reference("previous_scene", saves.previousSceneImage(id, messageId)),
    ...reference("pc", saves.portraitOf(id, null)),
  ];

  async function drawScene(id: string, messageId: number, { description, location, visible }: Scene, signal: AbortSignal) {
    const looks = visible.map(({ appearance }) => appearance).filter(Boolean);
    const bytes = await adapter(
      {
        // Looks without names, as a model may letter a name into the picture.
        prompt: looks.length > 0 ? `${description}\nPeople in view: ${looks.join("; ")}` : description,
        negative_prompt: AVOID,
        aspect_ratio: "16:9",
        reference_images: references(id, messageId, visible),
        style_preset: saves.read(id).artStyle,
      },
      signal,
    );
    // Counted before storing, as the player has paid for it whether or not its Message is still there.
    session++;
    saves.addSceneImage(id, messageId, location, bytes);
  }

  async function drawPortrait(id: string, messageId: number, npc: Npc | undefined, signal: AbortSignal) {
    // shortcut: a person keeps their first portrait when update_npc changes their looks, redraw if that shows in play.
    const name = npc?.name ?? null;
    const { pc, artStyle } = saves.read(id);
    const description = npc ? npc.appearance : pcDescription(pc);
    if (!description || saves.portraitOf(id, name)) return;
    const bytes = await adapter(
      {
        prompt: `A head and shoulders portrait of one person against a plain background.\n${description}`,
        negative_prompt: AVOID,
        aspect_ratio: "1:1",
        reference_images: [],
        style_preset: artStyle,
      },
      signal,
    );
    session++;
    saves.addPortrait(id, messageId, name, bytes);
  }

  async function drawIfReady(job: Job, signal: AbortSignal) {
    if (ready()) await job.draw(signal);
  }

  async function drain(id: string, jobs: Work) {
    while (jobs.portraits.length > 0 || jobs.waiting) {
      const job = jobs.portraits.shift() ?? jobs.waiting!;
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
    const jobs: Work = busy ?? { portraits: [] };
    add(jobs);
    if (busy || (jobs.portraits.length === 0 && !jobs.waiting)) return;
    work.set(id, jobs);
    void drain(id, jobs);
  }

  const portraitJob = (id: string, messageId: number, npc?: Npc): Job => ({
    messageId,
    draw: (signal) => drawPortrait(id, messageId, npc, signal),
  });

  return {
    /**
     * A story's cover, for a world that has no Save yet. Its prompt holds only what the player reads, as nothing here
     * knows the World Bible. A failure leaves the story without a cover, which nothing depends on.
     */
    async drawCover({ theme, overview, artStyle = "" }: Cover, signal: AbortSignal) {
      if (!ready()) return undefined;
      try {
        const bytes = await adapter(
          {
            prompt: `Cover art for a novel, one striking image of its world's mood and subject, not a moment from the story.\nTheme: ${theme}\nThe world: ${overview}`,
            negative_prompt: AVOID,
            aspect_ratio: "2:3",
            reference_images: [],
            style_preset: artStyle,
          },
          signal,
        );
        session++;
        return bytes;
      } catch (error) {
        if (!signal.aborted) console.error(error);
        return undefined;
      }
    },

    /** The PC's portrait outlives every Revert, so no Message holds it. Nothing here may delay the new Save. */
    saveCreated(id: string) {
      enqueue(id, (jobs) => jobs.portraits.push(portraitJob(id, OPENING_SNAPSHOT)));
    },

    /**
     * The Turn has already committed, so nothing here may throw into it. Every move of the Scene asks for everyone in it,
     * and a job does nothing for someone who has a portrait. So a person missed while images were off, or by a failed
     * generation, is drawn when the Scene next moves, without paying each Turn or waiting for them to leave and return.
     */
    sceneChanged(id: string, messageId: number, scene: Scene) {
      enqueue(id, (jobs) => {
        if (scene.moved) jobs.portraits.push(portraitJob(id, OPENING_SNAPSHOT), ...scene.visible.map((npc) => portraitJob(id, messageId, npc)));
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
      jobs.portraits = jobs.portraits.filter((job) => job.messageId <= messageId);
      if (jobs.waiting && jobs.waiting.messageId > messageId) jobs.waiting = undefined;
      if (jobs.running && jobs.running.messageId > messageId) jobs.running.controller.abort();
    },

    status: (id: string) => ({ pending: work.has(id), session }),
  };
}
