import type { Message, Save, SaveStore } from "../save-store";
import type { State } from "../state-applier";

export type { Message, Save };
export type ListedSave = ReturnType<SaveStore["list"]>[number];
export type Inventory = State["inventory"];
export type Status = State["status"];
export type Settings = { textBaseUrl: string; textModel: string; hasTextApiKey: boolean };
export type Journal = { summary: string; facts: string[]; npcs: string[]; fullLog: Message[] };
export type TurnResult = { messages: Message[] } | { error: string; input: string };

const jsonBody = (body: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const errorMessage = async (response: Response) =>
  ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${response.status})`;

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export const listSaves = () => request<{ saves: ListedSave[] }>("/saves").then(({ saves }) => saves);

export const getSave = (id: string) => request<Save>(`/saves/${id}`);

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

export const getSettings = () => request<Settings>("/settings");

/** What stops the Narrator replying, if anything. */
export function setupProblem({ textBaseUrl, textModel, hasTextApiKey }: Settings) {
  if (!textModel) return "No text model is set.";
  // shortcut: local servers need no key, so only OpenRouter is checked, ask per server if more keyed hosts appear.
  if (!hasTextApiKey && textBaseUrl.includes("openrouter.ai")) return "No API key is set.";
}

export const getMessages = (id: string) =>
  request<{ messages: Message[] }>(`/saves/${id}/messages`).then(({ messages }) => messages);

export const getJournal = (id: string) => request<Journal>(`/saves/${id}/journal`);

export const getInventory = (id: string) => request<Inventory>(`/saves/${id}/inventory`);

export const getStatus = (id: string) => request<Status>(`/saves/${id}/status`);

export const statusWords = ({ health, injuries, conditions }: Status) =>
  [health, ...injuries, ...conditions].join(", ");

const notesOf = ({ notes }: { notes: string[] }) => notes;

export const getNotes = (id: string) => request<{ notes: string[] }>(`/saves/${id}/notes`).then(notesOf);

export const addNote = (id: string, text: string) =>
  request<{ notes: string[] }>(`/saves/${id}/notes`, jsonBody({ text })).then(notesOf);

export const editNote = (id: string, index: number, text: string) =>
  request<{ notes: string[] }>(`/saves/${id}/notes/${index}`, { ...jsonBody({ text }), method: "PATCH" }).then(notesOf);

export const removeNote = (id: string, index: number) =>
  request<{ notes: string[] }>(`/saves/${id}/notes/${index}`, { method: "DELETE" }).then(notesOf);

export const createSave = (save: Save) => request<{ id: string }>("/saves", jsonBody(save));

export const previewRevert = (id: string, messageId: number) =>
  request<{ messages: number; images: number }>(`/saves/${id}/messages/${messageId}/revert`);

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
  try {
    const response = await fetch(`/saves/${id}/${resource}`, {
      ...jsonBody(body),
      signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    });
    if (!response.ok) return { error: await errorMessage(response), input };
    let narration = "";
    for await (const { event, data } of turnEvents(response.body!)) {
      if (event === "narration") show((narration += data.text));
      if (event === "restart") show((narration = ""));
      if (event === "done") return { messages: data.messages };
      if (event === "error") {
        return { error: data.status === 502 ? `${data.error}. ${retryHint}` : data.error, input };
      }
    }
  } catch {
    // Fall through: a failed read is the same dropped connection as a stream that just stops.
  }
  try {
    const messages = (await getMessages(id)).filter((message) => message.id > after);
    if (messages.length > 0) return { messages };
    return { error: `The connection dropped and this wasn't saved. ${retryHint}`, input };
  } catch {
    return { error: "NovelForge can't be reached. Make sure it's still running, then reload this page.", input };
  }
}
