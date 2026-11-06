import { z } from "zod";
import { log } from "./logger";
import type { SettingsStore } from "./settings-store";
import { ContentRefused, type TextProvider, TextProviderFailed } from "./turn-engine";

// The player sees these with a retry hint after them, so none ends in a full stop.
const UNREACHABLE = "The Text Provider can't be reached, so make sure it's running and that its address in Settings is right";
const STOPPED = "The Text Provider stopped responding, so make sure it isn't stuck or still loading a model";
const REJECTED = "The Text Provider returned an error, so look over its address, the text model and any API key in Settings";

const LIMITS = {
  // Generous, as a local server can spend minutes loading a model before its first byte.
  silenceMs: 10 * 60 * 1000,
  // The list is only a nicety, so a server too busy to answer holds up a Turn or Settings this long at most.
  listMs: 15 * 1000,
};

// shortcut: a shorter echo, such as a few words of player input, passes this, drop provider text altogether if one is seen.
const ECHO_CHARS = 16;

type ProviderError = { metadata?: { error_type?: string; reasons?: string[] } };

type Chunk = {
  id?: string;
  provider?: string;
  usage?: object;
  error?: ProviderError;
  choices?: {
    delta?: { content?: string | null; refusal?: string | null };
    message?: { content?: string | null };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }[];
};

// `reasons` marks a moderation error.
const isRefusal = (error?: ProviderError) =>
  ["refusal", "content_policy_violation"].includes(error?.metadata?.error_type ?? "") || !!error?.metadata?.reasons;

async function* eventData(body: ReadableStream, onRead: () => void) {
  let pending = "";
  for await (const part of body.pipeThrough(new TextDecoderStream())) {
    onRead();
    const lines = (pending + part).split("\n");
    pending = lines.pop()!;
    // Anything else is a blank line or a comment, such as OpenRouter's keep-alive.
    for (const line of lines) if (line.startsWith("data:")) yield line.slice("data:".length).trim();
  }
  if (pending.startsWith("data:")) yield pending.slice("data:".length).trim();
}

const keyHeader = (key: string): Record<string, string> => (key ? { Authorization: `Bearer ${key}` } : {});

// `supported_parameters` is OpenRouter's, and a local server may put anything there or nothing.
const ModelList = z.object({
  data: z.array(z.object({ id: z.string(), supported_parameters: z.array(z.string()).catch([]) })),
});

/** The server's models, or undefined without a usable answer. */
async function listModels(url: string, headers: Record<string, string>, signal: AbortSignal, listMs: number) {
  try {
    const limited = AbortSignal.any([signal, AbortSignal.timeout(listMs)]);
    const response = await fetch(`${url}/models`, { headers, signal: limited });
    return response.ok ? ModelList.parse(await response.json()).data : undefined;
  } catch {
    return undefined;
  }
}

/** The ids of the models on the saved server, empty if it doesn't list any. */
export async function textModels(settings: SettingsStore, signal: AbortSignal) {
  const { textBaseUrl, textApiKey } = settings.read();
  const models = await listModels(textBaseUrl.replace(/\/$/, ""), keyHeader(textApiKey), signal, LIMITS.listMs);
  return models?.map(({ id }) => id) ?? [];
}

/** The one Text Provider: any OpenAI-compatible server, using the Settings at the time of each call. */
export function textProvider(settings: SettingsStore, { silenceMs, listMs } = LIMITS): TextProvider {
  const schemaSupport = new Map<string, boolean>();

  async function supportsSchema(url: string, model: string, headers: Record<string, string>, signal: AbortSignal) {
    const known = schemaSupport.get(`${url} ${model}`);
    if (known !== undefined) return known;
    const models = await listModels(url, headers, signal, listMs);
    // Without an answer, JSON validation and retries still work, so ask again on the next call.
    if (!models) return false;
    const supported = !!models.find(({ id }) => id === model)?.supported_parameters.includes("structured_outputs");
    schemaSupport.set(`${url} ${model}`, supported);
    return supported;
  }

  return async (prompt, { schema, onText, onGeneration, signal }) => {
    const { textBaseUrl, textApiKey, textModel } = settings.read();
    if (!textModel) throw new TextProviderFailed("No text model is set, so choose one in Settings");
    const url = textBaseUrl.replace(/\/$/, "");
    const headers = keyHeader(textApiKey);
    const sent = prompt.map(({ content }) => content).join("\n");
    // A provider may echo what it was sent, and this text goes to the Server Log at Verbose, so no key and nothing of the prompt.
    const redacted = (detail: string) => {
      const short = (textApiKey ? detail.replaceAll(textApiKey, "[key]") : detail).slice(0, 300);
      for (let at = 0; at + ECHO_CHARS <= short.length; at++) if (sent.includes(short.slice(at, at + ECHO_CHARS))) return "[it repeats the prompt]";
      return short;
    };
    const failure = (error: ProviderError | undefined, status: number) => {
      if (isRefusal(error)) return new ContentRefused();
      log.verbose("text", "Text Provider error", () => ({ detail: redacted(JSON.stringify({ status, error })) }));
      return new TextProviderFailed(REJECTED);
    };

    // For the Server Log, so it holds how the reply went and none of its text.
    const started = Date.now();
    const seen: Record<string, unknown> = { model: textModel };
    let reply = "";

    const silence = new AbortController();
    let timer: Timer | undefined;
    const heardFrom = () => {
      clearTimeout(timer);
      timer = setTimeout(() => silence.abort(), silenceMs);
    };

    const send = async (useSchema: boolean) => {
      heardFrom();
      log.verbose("text", "Prompt sent", () => ({ model: textModel, messages: prompt.length, chars: sent.length, schema: useSchema }));
      const response = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, silence.signal]),
        // Bun's own limit would otherwise end a slow first response before ours.
        timeout: false,
        body: JSON.stringify({
          model: textModel,
          messages: prompt,
          stream: true,
          ...(useSchema && {
            response_format: { type: "json_schema", json_schema: { name: "narrator_response", strict: true, schema } },
            provider: { require_parameters: true },
          }),
        }),
      });
      heardFrom();
      return response;
    };

    try {
      const useSchema = schema !== undefined && (await supportsSchema(url, textModel, headers, signal));
      seen.schema = useSchema;
      let response = await send(useSchema);
      // A listing can claim schema support that the routed provider then rejects, and that must not fail every Turn.
      if (useSchema && (response.status === 400 || response.status === 404)) {
        log.warning("text", "Schema mode rejected", { model: textModel, status: response.status });
        const detail = await response.text();
        log.verbose("text", "Schema mode rejection", () => ({ detail: redacted(detail) }));
        schemaSupport.set(`${url} ${textModel}`, false);
        seen.schema = false;
        response = await send(false);
      }
      seen.status = response.status;
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as Chunk;
        throw failure(error, response.status);
      }

      // Some servers ignore `stream` and send the whole reply as one JSON body.
      const whole = response.headers.get("content-type")?.includes("application/json");
      for await (const data of whole ? [await response.text()] : eventData(response.body, heardFrom)) {
        if (data === "[DONE]") break;
        seen.lines = ((seen.lines as number) ?? 0) + 1;
        // Enough to tell cut-off JSON from an HTML page, and it can't hold a word of the story.
        seen.last = { chars: data.length, first: data[0], final: data.at(-1) };
        const { id, provider, usage, error, choices } = JSON.parse(data) as Chunk;
        delete seen.last;
        if (id && id !== seen.generation) onGeneration?.(id);
        if (error) throw failure(error, response.status);
        const { delta, message, finish_reason, native_finish_reason } = choices?.[0] ?? {};
        Object.assign(seen, {
          generation: id ?? seen.generation,
          provider: provider ?? seen.provider,
          usage: usage ?? seen.usage,
          finish: finish_reason ?? seen.finish,
          nativeFinish: native_finish_reason ?? seen.nativeFinish,
        });
        if (delta?.refusal || finish_reason === "content_filter") throw new ContentRefused();
        const text = delta?.content ?? message?.content;
        if (text) {
          reply += text;
          onText(text);
        }
      }
      return reply;
    } catch (cause) {
      seen.failed = signal.aborted ? "the client left" : (cause as Error).name;
      const known = cause instanceof ContentRefused || cause instanceof TextProviderFailed;
      if (known || signal.aborted || cause instanceof SyntaxError) throw cause;
      throw new TextProviderFailed(silence.signal.aborted ? STOPPED : UNREACHABLE, { cause });
    } finally {
      clearTimeout(timer);
      const logAs = seen.failed && !signal.aborted ? log.warning : log.info;
      logAs("text", "Text reply", () => ({ ...seen, chars: reply.length, ms: Date.now() - started }));
    }
  };
}
