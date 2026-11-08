import type { comfyModels } from "../comfyui";
import type { textHosts } from "../text-provider";
import type { ImageKind } from "../image-pipeline";
import type { FailedTurn, LiveTurn } from "../live-turns";
import type { LogLevel } from "../logger";
import type { ImageTarget, Message, Save, SaveStore } from "../save-store";
import type { SettingsChange } from "../settings-store";
import type { State, VisibleEdit } from "../state-applier";
import type { Character, EnhanceField, PcDraft, WorldChoices, WorldField, WorldPc } from "../world-creation";

export type { Character, EnhanceField, ImageKind, Message, PcDraft, Save, WorldChoices, WorldField };
export type ListedSave = ReturnType<SaveStore["list"]>[number];
export type OpenSave = ReturnType<SaveStore["read"]>;
export type Status = State["status"];
export type Settings = Omit<Required<SettingsChange>, "textApiKey" | "imageApiKey"> & {
  defaultLogLevel: LogLevel;
  hasTextApiKey: boolean;
  hasImageApiKey: boolean;
  imagesReady: boolean;
  workflowProblem: string;
};
export type TextHost = Awaited<ReturnType<typeof textHosts>>[number];
export type Journal = { status: Status; storyTime: { date: string; timeOfDay: string } | null; summary: string; facts: string[]; looseEnds: string[]; sceneMemories: State["sceneMemories"]; npcs: string[]; npcSummaries: Record<string, string>; recentNpcs: string[]; portraits: Portrait[]; fullLog: Message[]; chapters: Chapter[] };
/** The open Chapter is last, with a null `lastMessage`. */
export type Chapter = { title: string; lastMessage: number | null };
/** A null `npc` is the PC. */
export type Portrait = ReturnType<SaveStore["portraits"]>[number];
export type SceneImageInfo = ReturnType<SaveStore["sceneImages"]>[number];
export type SceneImages = { images: SceneImageInfo[]; pending: boolean; session: number };
export type RequestedImage = ReturnType<SaveStore["requestedImages"]>[number];
/** `drawing` counts those still on the way. */
export type RequestedImages = { images: RequestedImage[]; drawing: number };
export type GalleryImage = ImageTarget & { label: string; prompt: string | null; redraws: number; redrawing: boolean; failure: string };
export type Gallery = { images: GalleryImage[]; pending: boolean; canRedraw: boolean };
export type HeldImage = { prompt: string; hasImage: boolean; failure: string; canRedraw: boolean };
export type TurnResult = { messages: Message[] } | { error: string; input: string };
export type TurnStatus = { running?: LiveTurn; failed?: FailedTurn };

const jsonBody = (body: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function errorMessage(response: Response) {
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  // The page updates on a refresh but the server doesn't, so an older server won't have a newer route.
  if (error === "Not found") return "The running app is older than this page. Restart NovelForge, then try again.";
  return error ?? `Request failed (${response.status})`;
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

/** Tells the Server Log what only the page can see. Numbers and a Save's id only, as the route takes nothing else, and a failed report is nobody's problem. */
export function reportEvent(event: string, fields: Record<string, number | string> = {}) {
  void fetch("/log", { ...jsonBody({ event, ...fields }), keepalive: true }).catch(() => {});
}

export const listSaves = () => request<{ saves: ListedSave[] }>("/saves").then(({ saves }) => saves);

export const getSave = (id: string) => request<OpenSave>(`/saves/${id}`);

export const saveArtStyle = (id: string, artStyle: string) =>
  request<{ artStyle: string }>(`/saves/${id}`, { ...jsonBody({ artStyle }), method: "PATCH" });

export async function deleteSave(id: string) {
  const response = await fetch(`/saves/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export const importSave = (file: File) =>
  request<{ id: string }>("/saves/import", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export const getSettings = () => request<Settings>("/settings");

export const saveSettings = (change: SettingsChange) =>
  request<Settings>("/settings", { ...jsonBody(change), method: "PATCH" });

export type ComfyModels = Awaited<ReturnType<typeof comfyModels>>;
export const getComfyModels = () => request<ComfyModels>("/settings/comfy-models");

export type TextTest = { reply: string; seconds: number; firstSeconds: number; tokens: number; model: string };
export const askTextTest = (prompt: string, signal: AbortSignal) =>
  request<TextTest>("/settings/text-test", { ...jsonBody({ prompt }), signal });

/** `model`, `steps` and `seed` are left out for an Advanced workflow, which decides those itself. */
export type ComfyTestStats = { seconds: number; model?: string; steps?: number; seed?: number };

/** Resolves to an object URL of the drawn image, its file size and how it was drawn. */
export async function drawComfyTest(prompt: string, signal: AbortSignal) {
  const response = await fetch("/settings/comfy-test", { ...jsonBody({ prompt }), signal });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  const stats = JSON.parse(decodeURIComponent(response.headers.get("X-Draw-Stats") ?? "")) as ComfyTestStats;
  return { url: URL.createObjectURL(blob), fileSize: blob.size, ...stats };
}

export const getTextModels = () => request<{ models: string[] }>("/settings/text-models").then(({ models }) => models);
export const getTextHosts = (model: string) =>
  request<{ hosts: TextHost[] }>(`/settings/text-hosts?model=${encodeURIComponent(model)}`).then(({ hosts }) => hosts);

/** What stops the Narrator replying, if anything. */
export function setupProblem({
  textBaseUrl,
  textModel,
  hasTextApiKey,
}: Pick<Settings, "textBaseUrl" | "textModel" | "hasTextApiKey">) {
  if (!textModel) return "No text model is set.";
  // shortcut: local servers need no key, so only OpenRouter is checked, ask per server if more keyed hosts appear.
  if (!hasTextApiKey && textBaseUrl.includes("openrouter.ai")) return "No API key is set.";
}

export const getMessages = (id: string) =>
  request<{ messages: Message[] }>(`/saves/${id}/messages`).then(({ messages }) => messages);

export const getJournal = (id: string) => request<Journal>(`/saves/${id}/journal`);

export const getImages = (id: string) => request<SceneImages>(`/saves/${id}/images`);

export const imageUrl = (id: string, { messageId, redraws }: Pick<SceneImageInfo, "messageId" | "redraws">) =>
  `/saves/${id}/messages/${messageId}/image?v=${redraws}`;

export const requestedImageUrl = (id: string, { ref, redraws }: Pick<RequestedImage, "ref" | "redraws">) =>
  `/saves/${id}/requested-images/${ref}/image?v=${redraws}`;

/** What a story is called. A Save from before titles has only its PC to tell it apart. */
export const storyName = ({ title, pc }: { title: string; pc: { name: string } }) => title || pc.name;

export const coverUrl = (id: string, redraws: number) => `/saves/${id}/cover?v=${redraws}`;

/** Answers only once the image is done. The version makes a redrawn image a new address. */
export const heldImageUrl = (id: string, kind: ImageKind, version: number) => `/worlds/${id}/${kind}?v=${version}`;

export const getRequestedImages = (id: string) => request<RequestedImages>(`/saves/${id}/requested-images`);

/** Answers at once, as the picture is written and drawn in the background. */
export const requestImage = (id: string, words: string) => request<object>(`/saves/${id}/requested-images`, jsonBody({ words }));

/** Why the last requested image wasn't drawn, if it wasn't. Reading a failure takes it. */
export const takeImageFailure = (id: string) =>
  request<{ failure?: { error: string; words: string } }>(`/saves/${id}/requested-images/failure`).then(({ failure }) => failure);

export const getGallery = (id: string) => request<Gallery>(`/saves/${id}/gallery`);

export const galleryUrl = (id: string, { kind, ref, redraws }: GalleryImage) => {
  if (kind === "cover") return coverUrl(id, redraws);
  if (kind === "requested") return requestedImageUrl(id, { ref, redraws });
  return kind === "portrait" ? portraitUrl(id, { id: ref, redraws }) : imageUrl(id, { messageId: ref, redraws });
};

export const redrawImage = (id: string, { kind, ref }: GalleryImage, prompt: string) =>
  request<object>(`/saves/${id}/gallery/redraw`, jsonBody({ kind, ref, prompt }));

/** A Cover or portrait drawn again from a new Image Prompt, written from the story as it is now. */
export const redoImage = (id: string, { kind, ref }: GalleryImage) => request<object>(`/saves/${id}/gallery/redo`, jsonBody({ kind, ref }));

export const deleteImage = (id: string, { kind, ref }: GalleryImage) => request<object>(`/saves/${id}/gallery/delete`, jsonBody({ kind, ref }));

/** Answers only once the image is done. */
export const getHeldImage = (id: string, kind: ImageKind) => request<HeldImage>(`/worlds/${id}/${kind}/details`);

export const redrawHeldImage = (id: string, kind: ImageKind, prompt: string) => request<object>(`/worlds/${id}/${kind}`, jsonBody({ prompt }));

/** Starts drawing on the form and answers at once. `id` is the one this form's images are held under, if it has one yet. */
export const drawOnForm = (
  ask: { id?: string; artStyle: string } & ({ kind: "cover"; title: string; theme: string; worldBrief: string; pc: { name: string; physicalTraits: string }; characters: Character[]; inventory: string } | { kind: "portrait"; name: string; physicalTraits: string; inventory: string; theme: string; worldBrief: string }),
) => request<{ id: string }>("/worlds/draw", jsonBody(ask));

export const decideForMe = (id: string, draft: string, signal?: AbortSignal) =>
  request<{ text: string }>(`/saves/${id}/decide`, { ...jsonBody({ draft }), signal }).then(({ text }) => text);

/** The Narrator's answer to a Question, which nothing keeps. */
export const askNarrator = (id: string, question: string, signal?: AbortSignal) =>
  request<{ text: string }>(`/saves/${id}/questions`, { ...jsonBody({ question }), signal }).then(({ text }) => text);

export const portraitUrl = (id: string, { id: portraitId, redraws }: Pick<Portrait, "id" | "redraws">) =>
  `/saves/${id}/portraits/${portraitId}?v=${redraws}`;

export const getStatus = (id: string) => request<Status>(`/saves/${id}/status`);

export const statusWords = ({ health, injuries, conditions }: Status) =>
  [health, ...injuries, ...conditions].join(", ");

/** `id` is the one this form's images are held under, if it has one yet. */
export const generateWorld = (world: WorldChoices & WorldPc & { id?: string }, signal?: AbortSignal) =>
  request<{ id: string; overview: string }>("/worlds", { ...jsonBody(world), signal });

/** Makes the Save from the world held under `id`, with its images. */
export const beginStory = (id: string, artStyle: string, signal?: AbortSignal) =>
  request<{ id: string }>(`/worlds/${id}/begin`, { ...jsonBody({ artStyle }), signal });

export const regenerateWorld = (id: string, choices: WorldChoices, signal?: AbortSignal) =>
  request<{ overview: string }>(`/worlds/${id}/regenerate`, { ...jsonBody(choices), signal });

/** Writes the empty boxes of the form. Leave out a box that shouldn't be written. */
export const pickForMe = (theme: string, form: Partial<Record<WorldField, string>> & { pc: PcDraft }, signal?: AbortSignal) =>
  request<Partial<Record<WorldField, string> & PcDraft>>("/worlds/pick", { ...jsonBody({ theme, ...form }), signal });

export const enhance = (
  field: EnhanceField,
  text: string,
  choices: Omit<WorldChoices, "artStyle"> & { pc?: PcDraft; character?: Character },
  signal?: AbortSignal,
) => request<{ text: string }>("/enhance", { ...jsonBody({ ...choices, field, text }), signal }).then(({ text }) => text);

export const editJournal = (id: string, edit: VisibleEdit) => request<object>(`/saves/${id}/edits`, jsonBody(edit));

export const getChapters = (id: string) => request<{ chapters: Chapter[]; offer: boolean }>(`/saves/${id}/chapters`);

export const closeChapter = (id: string) => request<object>(`/saves/${id}/chapters`, { method: "POST" });

/** Answers only that it was done, as what changed is hidden from the player. */
export const tellNarrator = (id: string, change: string) => request<object>(`/saves/${id}/world-change`, jsonBody({ change }));

export const previewRevert = (id: string, messageId: number) =>
  request<{ messages: number; images: number; portraits: number }>(`/saves/${id}/messages/${messageId}/revert`);

export const revert = (id: string, messageId: number) =>
  request<object>(`/saves/${id}/messages/${messageId}/revert`, jsonBody({}));

export const duplicateSave = (id: string) => request<{ id: string }>(`/saves/${id}/duplicate`, jsonBody({}));

export const duplicateFrom = (id: string, fromMessage: number) =>
  request<{ id: string }>(`/saves/${id}/duplicate`, jsonBody({ fromMessage }));

/** Each event of a Turn's stream, which the server always writes as one `event` line and one JSON `data` line. */
async function* turnEvents(body: ReadableStream) {
  // Reading by hand because Safari can't iterate a ReadableStream, and the decoder stream joins split characters.
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    const blocks = (pending + part.value).split("\n\n");
    pending = blocks.pop()!;
    for (const block of blocks) {
      const [event, data] = block.split("\n");
      yield { event: event!.slice("event: ".length), data: JSON.parse(data!.slice("data: ".length)) };
    }
  }
}

/**
 * Plays one Turn, passing all the narration so far to `show` each time it changes. `after` is the latest Message
 * before this Turn, because a dropped stream may still have committed.
 */
export const playTurn = (
  id: string,
  input: string,
  after: number,
  show: (narration: string) => void,
  signal: AbortSignal,
) => streamTurn(id, "turns", { input }, input, after, "Send it again to retry.", show, signal);

/** The story's first Message. A failure hands back no input, as the player wrote nothing. */
export const playOpening = (id: string, show: (narration: string) => void, signal: AbortSignal) =>
  streamTurn(id, "opening", {}, "", 0, "Try again.", show, signal);

/** Rewrite, with feedback, or Regenerate. A replacement commits under a new id, so `messageId` works as `after` does. */
export const replaceResponse = (
  id: string,
  messageId: number,
  feedback: string,
  show: (narration: string) => void,
  signal: AbortSignal,
) =>
  streamTurn(
    id,
    `messages/${messageId}/${feedback ? "rewrite" : "regenerate"}`,
    feedback ? { feedback } : {},
    feedback,
    messageId,
    "Try again.",
    show,
    signal,
  );

/** An Edit: the player's own words for the latest response, which keeps its id. Nothing streams, as the words are the player's. */
export const editResponse = (id: string, messageId: number, text: string, signal: AbortSignal) =>
  streamTurn(id, `messages/${messageId}/edit`, { text }, text, messageId, "Try again.", () => {}, signal);

/** Ends the running Turn. Its page hears it end with the player's words given back, and no error. */
export const stopTurn = (id: string) => fetch(`/saves/${id}/turn`, { method: "DELETE" }).then(() => {});

/** The state of a Turn on the server, which goes on without this page. Reading a failure takes it. */
export const getTurn = (id: string) => request<TurnStatus>(`/saves/${id}/turn`);

// About as long as a phone takes to find its network again after being woken. An object so that tests can shorten it.
export const turnPolling = { everyMs: 1000, tries: 30 };

const withHint = (error: string, status: number, retryHint: string) => (status === 502 ? `${error}. ${retryHint}` : error);

const retryHintFor = ({ input, replaces }: { input: string; replaces?: number }) =>
  input && replaces === undefined ? "Send it again to retry." : "Try again.";

/** What to tell the player about a Turn that failed while they were away. */
export const failureMessage = ({ error, status, input, replaces }: FailedTurn) =>
  withHint(error, status, retryHintFor({ input, replaces }));

/** Follows a Turn from the server until it ends, for a page that lost its stream or never had one. */
async function awaitTurn(
  id: string,
  input: string,
  after: number,
  retryHint: string,
  show: (narration: string) => void,
): Promise<TurnResult> {
  reportEvent("polling-fallback", { save: id, after });
  for (let misses = 0; misses < turnPolling.tries; ) {
    try {
      const { running, failed } = await getTurn(id);
      if (failed) return { error: withHint(failed.error, failed.status, retryHint), input: failed.input };
      if (!running) {
        const messages = (await getMessages(id)).filter((message) => message.id > after);
        if (messages.length > 0) return { messages };
        return { error: `The connection dropped and this wasn't saved. ${retryHint}`, input };
      }
      misses = 0;
      show(running.narration);
    } catch {
      misses++;
    }
    await new Promise((resolve) => setTimeout(resolve, turnPolling.everyMs));
  }
  reportEvent("polling-gave-up", { save: id, after, misses: turnPolling.tries });
  return { error: "NovelForge can't be reached. Make sure it's still running, then reload this page.", input };
}

/** Picks up a Turn this page didn't start or no longer holds, such as after a reload. */
export function resumeTurn(id: string, turn: LiveTurn, show: (narration: string) => void) {
  reportEvent("turn-resumed", { save: id, after: turn.after });
  return awaitTurn(id, turn.input, turn.after, retryHintFor(turn), show);
}

async function streamTurn(
  id: string,
  resource: string,
  body: object,
  input: string,
  after: number,
  retryHint: string,
  show: (narration: string) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  // A phone can kill a stream while it sleeps without ever failing it, so a page coming back asks the server instead.
  const stale = new AbortController();
  const onReturn = () => {
    if (document.visibilityState === "visible") stale.abort();
  };
  globalThis.document?.addEventListener("visibilitychange", onReturn);
  try {
    const response = await fetch(`/saves/${id}/${resource}`, {
      ...jsonBody(body),
      signal: AbortSignal.any([signal, stale.signal]),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    });
    if (!response.ok) return { error: await errorMessage(response), input };
    let narration = "";
    for await (const { event, data } of turnEvents(response.body!)) {
      if (event === "narration") show((narration += data.text));
      if (event === "restart") {
        show((narration = ""));
        reportEvent("narration-restarted", { save: id, after });
      }
      if (event === "done") return { messages: data.messages };
      if (event === "error") {
        // Heard here, so the server needn't keep it for the player's return.
        getTurn(id).catch(() => {});
        return { error: withHint(data.error, data.status, retryHint), input };
      }
    }
  } catch {
    // Fall through: a failed read is the same dropped connection as a stream that just stops.
  } finally {
    globalThis.document?.removeEventListener("visibilitychange", onReturn);
  }
  // `returned` tells a page that came back to the window from a stream that really broke.
  reportEvent("stream-lost", { save: id, after, returned: stale.signal.aborted ? 1 : 0 });
  return awaitTurn(id, input, after, retryHint, show);
}
