import type { SettingsStore } from "./settings-store";
import { ContentRefused, type TextProvider } from "./turn-engine";

type ProviderError = { metadata?: { error_type?: string; reasons?: string[] } };

type Chunk = {
  error?: ProviderError;
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
};

// `reasons` marks a moderation error.
const isRefusal = (error?: ProviderError) =>
  ["refusal", "content_policy_violation"].includes(error?.metadata?.error_type ?? "") || !!error?.metadata?.reasons;

async function* eventData(body: ReadableStream) {
  let pending = "";
  for await (const part of body.pipeThrough(new TextDecoderStream())) {
    const lines = (pending + part).split("\n");
    pending = lines.pop()!;
    // Anything else is a blank line or a comment, such as OpenRouter's keep-alive.
    for (const line of lines) if (line.startsWith("data:")) yield line.slice("data:".length).trim();
  }
}

/** The one Text Provider: any OpenAI-compatible server, using the Settings at the time of each call. */
export function textProvider(settings: SettingsStore): TextProvider {
  const schemaSupport = new Map<string, boolean>();

  async function supportsSchema(url: string, model: string, headers: Record<string, string>, signal: AbortSignal) {
    const known = schemaSupport.get(`${url} ${model}`);
    if (known !== undefined) return known;
    const response = await fetch(`${url}/models`, { headers, signal }).catch(() => undefined);
    const { data } = ((await response?.json().catch(() => ({}))) ?? {}) as {
      data?: { id: string; supported_parameters?: string[] }[];
    };
    // Without an answer, JSON validation and retries still work, so ask again on the next call.
    if (!response?.ok || !data) return false;
    const supported = !!data.find(({ id }) => id === model)?.supported_parameters?.includes("structured_outputs");
    schemaSupport.set(`${url} ${model}`, supported);
    return supported;
  }

  return async (prompt, { schema, onText, signal }) => {
    const { textBaseUrl, textApiKey, textModel } = settings.read();
    if (!textModel) throw new Error("No text model is set");
    const url = textBaseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = textApiKey ? { Authorization: `Bearer ${textApiKey}` } : {};
    // A provider may echo what it was sent, and this text goes to the server log.
    const redacted = (detail: string) => (textApiKey ? detail.replaceAll(textApiKey, "[key]") : detail);
    const failure = (error: ProviderError | undefined, status: number) =>
      isRefusal(error)
        ? new ContentRefused()
        : new Error(redacted(`Text Provider error: ${JSON.stringify({ status, error })}`));

    const send = (useSchema: boolean) =>
      fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        signal,
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

    const useSchema = await supportsSchema(url, textModel, headers, signal);
    let response = await send(useSchema);
    // A listing can claim schema support that the routed provider then rejects, and that must not fail every Turn.
    if (useSchema && (response.status === 400 || response.status === 404)) {
      console.error(`Schema mode rejected for ${textModel}:`, redacted(await response.text()));
      schemaSupport.set(`${url} ${textModel}`, false);
      response = await send(false);
    }
    if (!response.ok || !response.body) {
      const { error } = (await response.json().catch(() => ({}))) as Chunk;
      throw failure(error, response.status);
    }

    let reply = "";
    for await (const data of eventData(response.body)) {
      if (data === "[DONE]") break;
      const { error, choices } = JSON.parse(data) as Chunk;
      if (error) throw failure(error, response.status);
      const { delta, finish_reason } = choices?.[0] ?? {};
      if (delta?.refusal || finish_reason === "content_filter") throw new ContentRefused();
      if (delta?.content) {
        reply += delta.content;
        onText(delta.content);
      }
    }
    return reply;
  };
}
