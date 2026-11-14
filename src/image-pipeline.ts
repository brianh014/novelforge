import { drawingFamily, localIsSetUp, promptStyle, type PromptStyle, usableReferences, usesPortraits } from "./graph-builder";
import { artStyleFor } from "./web/art-styles";
import type { ImageAdapter, ImagePayload } from "./image-adapter";
import { errorType, log } from "./logger";
import { type ImageTarget, imageType, OPENING_SNAPSHOT, type Pictured, type Save, SaveNotFound, type SaveStore } from "./save-store";
import type { SettingsStore } from "./settings-store";
import type { State } from "./state-applier";
import type { PictureAsk } from "./world-creation";

export type ImagePipeline = ReturnType<typeof imagePipeline>;

type Npc = State["npcs"][number];
/** `restyled` is everyone whose looks the Turn changed, with null for the PC, whose portrait may be updated to match. */
export type Scene = {
  changed: boolean;
  moved: boolean;
  description: string;
  location: string;
  npcs: Npc[];
  wearing: string[];
  portraits: Npc[];
  restyled?: (Npc | null)[];
};
/**
 * A `redraw` key marks what the player asked for by hand, which draws whatever the Settings now say. `npc` is whose
 * portrait it is, null for the PC, and `place` names a scene's, both for telling the player what is drawing.
 */
type Job = {
  kind: string;
  messageId: number;
  draw: (signal: AbortSignal) => Promise<void>;
  redraw?: string;
  scene?: boolean;
  npc?: string | null;
  place?: string;
};
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
export const movedScene = (before: State, after: State) => before.scene.location !== after.scene.location || castOf(before) !== castOf(after);

export const visibleNpcs = ({ scene, npcs }: State) => scene.visibleCast.flatMap((name) => npcs.filter((npc) => npc.name === name));

/**
 * Who to ask for a portrait after a Turn. Anyone the PC just came to know, in view or not, and on every move of the
 * Scene everyone in it and everyone known, so someone missed is drawn then, without paying each Turn after a failure.
 */
export function portraitsDue(before: State, after: State) {
  const { scene, pcKnown } = after;
  const due = movedScene(before, after) ? [...scene.visibleCast, ...pcKnown.npcs] : pcKnown.npcs.filter((name) => !before.pcKnown.npcs.includes(name));
  return [...new Set(due)].flatMap((name) => after.npcs.filter((npc) => npc.name === name));
}

/** Everyone whose looks a Turn changed: an NPC given new looks, and the PC, as null, when what they wear or how they look changed. */
export function restyledBy(before: State, after: State): (Npc | null)[] {
  const npcs = after.npcs.filter(({ name, appearance }) => before.npcs.some((npc) => npc.name === name && npc.appearance !== appearance));
  const pc = JSON.stringify(before.inventory.wearing) !== JSON.stringify(after.inventory.wearing) || before.pcAppearance !== after.pcAppearance;
  return [...(pc ? [null] : []), ...npcs];
}

/** The PC as they look now: the story's appearance for them once it has one, or else their own physicalTraits. */
export const pcNow = <Pc extends Save["pc"]>(pc: Pc, { pcAppearance }: Pick<State, "pcAppearance">): Pc =>
  pcAppearance.trim() ? { ...pc, physicalTraits: pcAppearance } : pc;

/**
 * `outfit` is the form's own words for what the PC wears and carries, before the Narrator has sorted them. Something is
 * always worn, as image models draw anyone they're not told is dressed without a shirt.
 */
export function pcLooks({ name, physicalTraits = "" }: Save["pc"], wearing: string[], outfit = "") {
  // A PC on the form may have no name yet, and an empty search would match between every letter.
  const unnamed = (text: string) => (name ? text.replaceAll(name, "this person") : text);
  const traits = unnamed(
    physicalTraits
      .trim()
      .replace(/\s*\n\s*/g, " ")
      .replace(/\.$/, ""),
  );
  const dressed =
    wearing.length > 0
      ? `wearing ${wearing.join(", ")}`
      : outfit.trim()
        ? `fully clothed in what this says they wear, leaving out what they only carry: ${unnamed(outfit.trim().replace(/\s*\n\s*/g, " "))}`
        : "fully clothed in everyday clothes that suit them";
  return [traits, dressed].filter(Boolean).join(", ");
}

const named = (full: string, mark: string) => full.toLowerCase() === mark.toLowerCase() || full.toLowerCase().split(" ").includes(mark.toLowerCase());

/** Narrators shorten names, so part of one counts when it can only mean one person. */
function findPerson(npcs: Npc[], mark: string) {
  const exact = npcs.find(({ name }) => name === mark);
  if (exact) return exact;
  const partly = npcs.filter(({ name }) => named(name, mark));
  return partly.length === 1 ? partly[0] : undefined;
}

/**
 * Turns the Narrator's [Name: phrase] marks into its phrases, so no name reaches a model that might letter it into the
 * picture, and says who is pictured. The phrase is all the model reads of them: no stored looks are added, as the
 * Narrator writes the whole prompt to its length and order, and added looks made prompts nearly twice that length.
 * `referenced` are those whose portrait reaches the model, in its order: each is pointed at their image by number, and the
 * Narrator's {likeness sentence} is kept only when there is one, so a picture with no portraits is prompted as before.
 */
export function expandMarks(text: string, npcs: Npc[], pcName: string, referenced: Pictured = []) {
  const pictured: Pictured = [];
  const prompt = text
    .replace(/\s*\{([^{}]*)\}/g, (_, likeness: string) => (referenced.length > 0 ? ` ${likeness.trim()}` : ""))
    .replace(/\[([^[\]:]+)(?::([^[\]]*))?\]/g, (_, mark: string, phrase: string | undefined, at: number, whole: string) => {
      const brief = (phrase ?? "").trim();
      const isPc = named(pcName, mark.trim());
      const npc = isPc ? undefined : findPerson(npcs, mark.trim());
      if (!isPc && !npc) return brief || "a person";
      const person = isPc ? null : npc!.name;
      if (pictured.includes(person)) return "the same person";
      pictured.push(person);
      const image = referenced.indexOf(person) + 1;
      if (!image) return brief || "a person";
      // A comma closes the phrase only when the sentence reads on, as in "the person from image 1, a tall woman, kneels".
      const readsOn = /^\s*[a-z]/i.test(whole.slice(at + _.length));
      return brief ? `the person from image ${image}, ${brief}${readsOn ? "," : ""}` : `the person from image ${image}`;
    });
  return { prompt, pictured };
}

// What a head and shoulders frame can't show, as an image model squeezes the whole body in to fit a mention of feet.
const BELOW_THE_FRAME =
  /\b(?:hands?|wrists?|fingers?|arms?|legs?|knees?|feet|foot|barefoot|toes?|boots?|shoes?|sandals?|hose|breeches|trousers|pants|skirt|holding|carrying|clutching|gripping)\b/i;

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

// The opening of the world and of each person only, as a whole World Overview and the player's long descriptions made a prompt of nearly a thousand words, and the image model lost the cover in it.
const COVER_WORLD_WORDS = 80;
const COVER_PERSON_WORDS = 40;
const opening = (text: string, words: number) => text.split(/\s+/).filter(Boolean).slice(0, words).join(" ");

export const coverPrompt = ({ title, theme, world, people = [] }: Cover) =>
  `The front cover of a novel: dramatic, eye-catching cover art of a charged moment that captures the story's premise, its people in dynamic poses in a vivid place from its world, with bold composition, dramatic lighting and rich detail. Letter its title as part of the artwork, in the upper third of the cover. The title is this JSON string, spelled exactly: ${JSON.stringify(title)}
The title is the only writing anywhere on the cover: no author name, subtitle, tagline, label, name or any other words.
Theme: ${theme}
The world: ${opening(world, COVER_WORLD_WORDS)}${people.length > 0 ? `\nShow these people on the cover, the first in front as its hero, each looking as described: ${people.map((looks) => `(${opening(looks, COVER_PERSON_WORDS)})`).join(" ")}` : ""}`;

/** `text` with each of `names` taken out, as a name in an image prompt gets lettered into the picture. */
export const unnamed = (names: string[], text: string) => names.filter(Boolean).reduce((words, name) => words.replaceAll(name, "someone"), text.trim());

/**
 * The PC, unless `withPc` is false, and the Important Characters the player put on it, as a cover shows them, by looks alone. `ref` is whose portrait each is drawn from: null for the PC.
 * shortcut: a character with no description is left off, and one is only as drawn as their description says, ask for looks if covers miss them.
 */
export function coverPeople(
  pc: Save["pc"],
  wearing: string[],
  characters: { name: string; description: string; ref?: string; onCover?: boolean }[],
  outfit = "",
  withPc = true,
) {
  const names = [pc.name, ...characters.map(({ name }) => name)];
  const hero = withPc ? [{ looks: pcLooks(pc, wearing, outfit), ref: null as string | null | undefined }] : [];
  const others = characters.filter(({ onCover = true }) => onCover);
  const people = [...hero, ...others.map(({ description, ref }) => ({ looks: unnamed(names, description), ref }))];
  return people.filter(({ looks }) => looks);
}

/** `people` are the portraits of those it shows, the PC's first, so each looks like themselves. */
// No style_preset in any payload: each Image Prompt carries its own Art Style, as the text model writes the whole of it.
// shortcut: an image from before that has no Art Style in its prompt, so its Redraw draws without one, Update writes it in.
// Every prompt is the text model's own, which says what any portraits are for: nothing is added to it here.
const coverPayload = (prompt: string, people: ImagePayload["reference_images"]): ImagePayload => ({
  prompt,
  negative_prompt: COVER_AVOID,
  aspect_ratio: "2:3",
  reference_images: people,
  style_preset: "",
});

/** `face` is the portrait being updated, so the new one keeps that face, as its prompt says. */
const portraitPayload = (prompt: string, face: ImagePayload["reference_images"] = []): ImagePayload => ({
  prompt,
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

type Role = ImagePayload["reference_images"][number]["role"];
const reference = (role: Role, image: { bytes: Uint8Array; mediaType: string } | null | undefined) => (image ? [{ role, ...image }] : []);

/**
 * Decides when a Scene Image or portrait is drawn, and draws it in the background. Jobs live in memory, so stopping the
 * server loses the one in flight: its Turn stands and that scene just has no image, which is cheaper than redrawing it.
 */
/** Writes a Cover's or portrait's Image Prompt for the image model's family. `template` is a plain one, which tests draw from in place of a text model. */
export type PictureWriter = (ask: PictureAsk, style: PromptStyle, template: string, signal: AbortSignal) => Promise<string>;

export function imagePipeline(
  saves: SaveStore,
  adapters: Record<ReturnType<SettingsStore["read"]>["imageProvider"], ImageAdapter>,
  settings: SettingsStore,
  writePicture: PictureWriter = async (_ask, _style, template) => template,
) {
  /** Waits to be called, so a held image can start drawing as soon as its prompt is written. */
  const writer = (ask: PictureAsk) => (signal: AbortSignal) => {
    const style = promptStyle(settings.read());
    const template = ask.kind === "cover" ? coverPrompt(ask) : portraitPrompt(ask.looks, style);
    const styled = { ...ask, artStyle: artStyleFor(ask.artStyle, drawingFamily(settings.read())) };
    // The Art Style first, as the text model would have put it.
    return writePicture(styled, style, [styled.artStyle.trim(), template, ask.nudge?.trim()].filter(Boolean).join("\n"), signal);
  };

  const work = new Map<string, Work>();
  // shortcut: in memory, so a restart forgets a failed Redraw, which leaves the old image anyway.
  const failures = new Map<string, string>();
  // shortcut: kept in memory like the jobs, so a restart forgets which portraits are out of date, keep it in the Save if that bites.
  const outOfDate = new Set<string>();
  // shortcut: in memory and one per Save, so a restart or a second failure loses it, and that picture was never drawn anyway.
  const requestFailures = new Map<string, { error: string; words: string }>();
  let session = 0;
  // Pictures for the New Story form, which no Save's work holds, so the app doesn't quit while one is paid for.
  let drawingEarly = 0;

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
    const setUp = current.imageProvider === "local" ? localIsSetUp(current) : current.imageModel && current.imageApiKey;
    return current.imagesEnabled && setUp;
  }

  /**
   * The PC comes first, then the NPCs in the prompt's order, so a model that takes few references, such as Klein, drops an
   * NPC rather than the PC. A portrait of someone not in the picture can get pasted into it, so only those pictured go in.
   * No earlier Scene Image goes in, as FLUX.2 copied its people, poses and clothing into the new one whatever the prompt said.
   */
  const references = (id: string, pictured: Pictured) =>
    [...(pictured.includes(null) ? [null] : []), ...pictured.filter((name) => name !== null)].flatMap((person) =>
      reference(person === null ? "pc" : "npc", saves.portraitOf(id, person)).map((image) => ({ person, image })),
    );

  /**
   * Who of `pictured` has a portrait that reaches the image model, in its order. Simple Local keeps a family's first few or none.
   * shortcut: OpenRouter's model limit and an advanced workflow's slots aren't known here, so all count, number by slot if one drops some.
   */
  const referenced = (id: string, pictured: Pictured) => {
    const people = references(id, pictured);
    const current = settings.read();
    const reaching =
      current.imageProvider === "local" && current.comfyMode === "simple"
        ? usableReferences(
            current,
            people.map(({ image }) => image),
          ).length
        : people.length;
    return people.slice(0, reaching).map(({ person }) => person);
  };

  const scenePayload = (id: string, prompt: string, pictured: Pictured): ImagePayload => {
    const reference_images = references(id, pictured).map(({ image }) => image);
    return { prompt, negative_prompt: AVOID, aspect_ratio: "16:9", reference_images, style_preset: "" };
  };

  async function drawMoment(id: string, { description, npcs }: Moment, signal: AbortSignal) {
    const pcName = saves.read(id).pc.name;
    // Twice, as who is pictured decides which portraits go in, and those decide how each mark is written.
    const { pictured } = expandMarks(description, npcs, pcName);
    const { prompt } = expandMarks(description, npcs, pcName, referenced(id, pictured));
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
    const name = npc?.name ?? null;
    const { pc: started, artStyle, theme, worldBrief } = saves.read(id);
    const state = saves.latestState(id);
    const pc = pcNow(started, state);
    const looks = npc ? npc.appearance : pc.physicalTraits?.trim() && pcLooks(pc, state.inventory.wearing);
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
    if (kind === "cover") return coverPayload(prompt, reference("pc", saves.portraitOf(id, null)));
    if (!keepFace) return portraitPayload(prompt);
    // From the original, so the face doesn't drift through copies of copies.
    const bytes = saves.original(id, ref) ?? saves.portrait(id, ref);
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

  /**
   * Draws someone's portrait again as they look now, keeping their face, as the Gallery's Update does. Someone with no
   * portrait yet is left to their first. One the player uploaded is replaced too, as they turned this on.
   */
  function updatePortrait(id: string, npc: Npc | null, wearing: string[]) {
    const portrait = saves.portraits(id).find((candidate) => candidate.npc === (npc?.name ?? null));
    if (!portrait) return;
    const { pc: started, theme, worldBrief, artStyle } = saves.read(id);
    const pc = pcNow(started, saves.latestState(id));
    const looks = npc ? npc.appearance.trim() : pc.physicalTraits?.trim() && pcLooks(pc, wearing);
    if (!looks) return;
    if (pipeline.redraw(id, { kind: "portrait", ref: portrait.id }, portrait.messageId, { kind: "portrait", looks, theme, world: worldBrief, artStyle })) {
      log.info("images", "Portrait updated to new looks", about(id, { kind: "portrait", messageId: portrait.messageId }));
    }
  }

  const portraitJob = (id: string, messageId: number, npc?: Npc, early?: Promise<EarlyImage>): Job =>
    queued(id, { kind: "portrait", messageId, npc: npc?.name ?? null, draw: (signal) => drawPortrait(id, messageId, npc, signal, early) });

  const pipeline = {
    ready: () => Boolean(ready()),
    /** Whether any Save, or the New Story form, has a picture drawing or waiting. */
    busy: () => work.size > 0 || drawingEarly > 0,

    /**
     * A Cover or a portrait, for a world that has no Save yet. Its prompt holds only what the player reads, as
     * nothing here knows the World Bible. Undefined when images are off, and a failure is the caller's to report.
     */
    async drawEarly(kind: ImageKind, prompt: string, signal: AbortSignal, people: { role: "pc" | "npc"; bytes: Uint8Array }[] = []) {
      if (!ready()) return undefined;
      const references = people.flatMap(({ role, bytes }) => reference(role, imageType(bytes) && { bytes, mediaType: imageType(bytes)! }));
      const payload = kind === "cover" ? coverPayload(prompt, references) : portraitPayload(prompt);
      drawingEarly++;
      try {
        const bytes = await adapter(payload, signal);
        session++;
        return bytes;
      } finally {
        drawingEarly--;
      }
    },

    writer,

    /** False when that image is already being redrawn. Jobs live in memory, so stopping the server loses this one too, and the old image stands. */
    /**
     * `prompt` is the player's own, or for an Update, what to write a new one from when the job's turn comes. An Update of a
     * portrait keeps its face, as the player wants the same person as they are now, and is written as an edit of the image
     * its face comes from when that image surely reaches the model.
     */
    redraw(id: string, target: ImageTarget, messageId: number, prompt: string | PictureAsk) {
      const keepFace = typeof prompt !== "string" && (target.kind === "portrait" || target.kind === "original");
      // OpenRouter's and Wiro's image models take the reference too; a ComfyUI workflow or an SD checkpoint may not.
      const takesFace = settings.read().imageProvider !== "local" || usesPortraits(settings.read());
      const was = keepFace && takesFace ? saves.originalPrompt(id, target.ref) : undefined;
      // The player's own prompt for a portrait that has been replaced draws from the original's face too, as nothing else holds it.
      const fromOriginal = typeof prompt === "string" && target.kind === "portrait" && takesFace && !!saves.original(id, target.ref);
      // Without the old prompt to edit, a portrait drawn from its face is told the face is all it takes from it.
      const asked = typeof prompt !== "string" && prompt.kind === "portrait" && keepFace ? { ...prompt, ...(was ? { was } : { face: true }) } : prompt;
      const write = typeof asked === "string" ? undefined : writer(asked);
      const key = redrawKey(id, target);
      if (isRedrawing(id, key)) return false;
      failures.delete(key);
      const kind = `${target.kind} redraw`;
      const shown = saves.gallery(id).find((image) => image.kind === target.kind && image.ref === target.ref);
      const what = target.kind === "portrait" || target.kind === "original" ? { npc: shown?.npc ?? null } : { place: shown?.caption || undefined };
      const draw = async (signal: AbortSignal) => {
        try {
          const written = write ? await write(signal) : (prompt as string);
          const bytes = await adapter(redrawPayload(id, target, messageId, written, keepFace || fromOriginal), signal);
          session++;
          saves.replaceImage(id, target, written, bytes);
          outOfDate.delete(key);
          log.info("images", "Image drawn", about(id, { kind, messageId }));
        } catch (error) {
          if (!signal.aborted && !(error instanceof SaveNotFound)) {
            failures.set(key, shownFailure(error));
            if (keepFace && target.kind === "portrait") outOfDate.add(key);
          }
          throw error;
        }
      };
      enqueue(id, (jobs) => jobs.queue.push(queued(id, { kind, messageId, draw, redraw: key, ...what })));
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
    drawRequested(
      id: string,
      messageId: number,
      words: string,
      moment: Omit<Moment, "description">,
      write: (signal: AbortSignal) => Promise<{ text: string; title: string }>,
    ) {
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
      const { drawScenes, updatePortraits } = settings.read();
      enqueue(id, (jobs) => {
        if (scene.moved) jobs.queue.push(portraitJob(id, OPENING_SNAPSHOT));
        jobs.queue.push(...scene.portraits.map((npc) => portraitJob(id, messageId, npc)));
        if (drawScenes && scene.changed && scene.description) {
          if (jobs.waiting) dropped(id, jobs.waiting, "a newer scene");
          jobs.waiting = queued(id, {
            kind: "scene",
            messageId,
            scene: true,
            place: scene.location || undefined,
            draw: (signal) => drawScene(id, messageId, scene, signal),
          });
        }
      });
      if (!updatePortraits) return;
      // A portrait whose update failed is tried again when the Scene moves, as missing portraits are.
      const stale = scene.moved
        ? saves
            .portraits(id)
            .filter(({ id: ref }) => outOfDate.has(redrawKey(id, { kind: "portrait", ref })))
            .flatMap(({ npc }) => (npc === null ? [null] : scene.npcs.filter(({ name }) => name === npc)))
        : [];
      pipeline.restyled(id, [...new Set([...(scene.restyled ?? []), ...stale])], scene.wearing);
    },

    /** Updates the portraits of those whose looks changed, when the player has Update portraits on. */
    restyled(id: string, people: (Npc | null)[], wearing: string[]) {
      // Only when images are on, as a Redraw draws whatever the Settings say, and nobody asked for this one.
      if (settings.read().updatePortraits && ready()) for (const person of people) updatePortrait(id, person, wearing);
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

    /**
     * While anything is on the way, `drawing` is the kind of job drawing now, or next, `name` what it is of, and `more`
     * how many wait after it. A portrait is named only once the PC knows them, so it can't give away someone yet to come.
     * shortcut: `more` counts a portrait job for someone who already has one, which finishes at once, check first if the count misleads.
     */
    status: (id: string) => {
      const jobs = work.get(id);
      if (!jobs) return { pending: false, session };
      const all = [jobs.running, ...jobs.queue, jobs.waiting].filter((job) => job !== undefined);
      const next = all[0];
      const name =
        next?.place ??
        (next?.npc === null ? saves.read(id).pc.name : next?.npc && saves.latestState(id).pcKnown.npcs.includes(next.npc) ? next.npc : undefined);
      return { pending: true, session, drawing: next?.kind ?? "", name, more: Math.max(all.length - 1, 0) };
    },
  };
  return pipeline;
}
