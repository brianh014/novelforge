import type { ImageAdapter } from "./image-adapter";
import { SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

export type Scene = { changed: boolean; description: string; location: string };
type Job = Scene & { messageId: number };
/** At most one image draws per Save, and only the newest waiting scene is kept, so a run of quick Turns pays for two images. */
type Work = { running?: Job & { controller: AbortController }; waiting?: Job };

// Sent as the negative prompt, because a Scene Image must not show the player a Check's numbers or dice either.
const AVOID = "text, captions, letters, numbers, dice";

const castOf = ({ scene }: State) => JSON.stringify(scene.visibleCast.toSorted());

/** Compares the structured scene, never a description of it. */
export const movedScene = (before: State, after: State) =>
  before.scene.location !== after.scene.location || castOf(before) !== castOf(after);

/**
 * Decides when a Scene Image is drawn, and draws it in the background. Jobs live in memory, so stopping the server
 * loses the one in flight: its Turn stands and that scene just has no image, which is cheaper than redrawing it.
 */
export function imagePipeline(saves: SaveStore, adapter: ImageAdapter, settings: SettingsStore) {
  const work = new Map<string, Work>();
  let session = 0;

  async function draw(id: string, { messageId, description, location }: Job, signal: AbortSignal) {
    const { imagesEnabled, imageProvider, imageModel, imageApiKey } = settings.read();
    // shortcut: Local draws nothing, add its adapter in ticket 20.
    // An unfinished setup is silent too, as there is no image to report failing.
    if (!imagesEnabled || imageProvider !== "openrouter" || !imageModel || !imageApiKey) return;
    const previous = saves.previousSceneImage(id, messageId);
    const bytes = await adapter(
      {
        prompt: description,
        negative_prompt: AVOID,
        aspect_ratio: "16:9",
        reference_images: previous ? [{ role: "previous_scene", ...previous }] : [],
        style_preset: saves.read(id).artStyle,
      },
      signal,
    );
    // Counted before storing, as the player has paid for it whether or not its Message is still there.
    session++;
    saves.addSceneImage(id, messageId, location, bytes);
  }

  async function drain(id: string, jobs: Work) {
    while (jobs.waiting) {
      const job = jobs.waiting;
      const controller = new AbortController();
      jobs.waiting = undefined;
      jobs.running = { ...job, controller };
      // Image API errors stay in this log, as they may repeat the prompt, and the Turn already stands.
      await draw(id, job, controller.signal).catch((error) => {
        if (!(error instanceof SaveNotFound) && !controller.signal.aborted) console.error(error);
      });
    }
    work.delete(id);
  }

  return {
    /** The Turn has already committed, so nothing here may throw into it. */
    sceneChanged(id: string, messageId: number, scene: Scene) {
      if (!scene.changed || !scene.description) return;
      const job = { ...scene, messageId };
      const jobs = work.get(id);
      if (jobs) {
        jobs.waiting = job;
        return;
      }
      const started = { waiting: job };
      work.set(id, started);
      void drain(id, started);
    },

    /**
     * Drops every job for a Message after `messageId`, for when those Messages or the whole Save go. Cancelling is not
     * billed, and a job that finishes regardless finds its Message gone, as Message ids are never reused.
     */
    forget(id: string, messageId: number) {
      const jobs = work.get(id);
      if (!jobs) return;
      if (jobs.waiting && jobs.waiting.messageId > messageId) jobs.waiting = undefined;
      if (jobs.running && jobs.running.messageId > messageId) jobs.running.controller.abort();
    },

    status: (id: string) => ({ pending: work.has(id), session }),
  };
}
