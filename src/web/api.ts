import type { Message, Save } from "../save-store";
import type { State } from "../state-applier";

export type { Message, Save };
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

export const getSave = (id: string) => request<Save>(`/saves/${id}`);

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

export const createSave = (save: Save) => request<{ id: string }>("/saves", jsonBody(save));

export const previewRevert = (id: string, messageId: number) =>
  request<{ messages: number; images: number }>(`/saves/${id}/messages/${messageId}/revert`);

export const revert = (id: string, messageId: number) =>
  request<object>(`/saves/${id}/messages/${messageId}/revert`, jsonBody({}));

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
export async function playTurn(
  id: string,
  input: string,
  after: number,
  show: (narration: string) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  try {
    const response = await fetch(`/saves/${id}/turns`, {
      ...jsonBody({ input }),
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
        return { error: data.status === 502 ? `${data.error}. Send it again to retry.` : data.error, input };
      }
    }
  } catch {
    // Fall through: a failed read is the same dropped connection as a stream that just stops.
  }
  try {
    const messages = (await getMessages(id)).filter((message) => message.id > after);
    if (messages.length > 0) return { messages };
    return { error: "The connection dropped and this Turn wasn't saved. Send it again.", input };
  } catch {
    return { error: "NovelForge can't be reached. Make sure it's still running, then reload this page.", input };
  }
}
