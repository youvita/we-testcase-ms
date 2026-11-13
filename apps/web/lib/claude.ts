/**
 * The one place the app talks to Claude.
 *
 * Speaks the Anthropic Messages API, sent to the Claude bridge
 * (scripts/claude-bridge.mjs) at `CLAUDE_BRIDGE_URL`. The bridge runs each
 * call with `claude --print` on the subscription token the request carries, so
 * every call is billed to the person who asked for it.
 *
 * Because this is plain Messages API, moving to an API key later is a config
 * change: point `CLAUDE_BRIDGE_URL` at https://api.anthropic.com and send a key
 * instead of a token. Nothing that calls `askClaude` needs to know.
 */

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/** The bridge alias for the model ("sonnet", "opus", "haiku") or a full id. */
export function defaultModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || "sonnet";
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.CLAUDE_BRIDGE_URL?.trim());
}

/**
 * Generous on purpose: a large chunk of a PRD can take minutes. The bridge has
 * its own 15-minute ceiling.
 */
const REQUEST_TIMEOUT_MS = 14 * 60_000;

export type ClaudeImage = { mediaType: string; data: string };

/**
 * Waits before trying the bridge again when it could not be connected to —
 * about 15 seconds in all. A deploy recreates the containers, and a call made
 * in that moment should wait for the bridge rather than fail.
 */
export const BRIDGE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

/**
 * The bridge was not there to take the request: nothing was sent, so trying
 * again cannot run the turn twice. A connection dropped mid-request is not
 * this — the bridge may already be running the turn on someone's plan.
 */
function notConnected(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"].includes(code ?? "");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function askClaude(options: {
  token: string;
  system: string;
  prompt: string;
  /** Base64 images shown before the prompt — screenshots, here. */
  images?: ClaudeImage[];
  model?: string;
  maxTokens?: number;
  /** Aborts the request — the job it is for was cancelled. */
  signal?: AbortSignal;
}): Promise<string> {
  const base = process.env.CLAUDE_BRIDGE_URL?.trim().replace(/\/$/, "");
  if (!base) {
    throw new AiError(
      "AI is not set up on this server: CLAUDE_BRIDGE_URL is missing.",
    );
  }

  const request = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": options.token,
    },
    body: JSON.stringify({
      model: options.model ?? defaultModel(),
      max_tokens: options.maxTokens ?? 16_000,
      system: options.system,
      messages: [
        {
          role: "user",
          content: options.images?.length
            ? [
                ...options.images.map((image) => ({
                  type: "image",
                  source: { type: "base64", media_type: image.mediaType, data: image.data },
                })),
                { type: "text", text: options.prompt },
              ]
            : options.prompt,
        },
      ],
    }),
  };

  let response: Response | undefined;
  for (let attempt = 0; !response; attempt += 1) {
    try {
      response = await fetch(`${base}/v1/messages`, {
        ...request,
        signal: options.signal
          ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), options.signal])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Cancelled: nothing to retry, and no message for anyone.
      if (options.signal?.aborted) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiError("The AI took too long to answer.");
      }
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt];
      if (notConnected(error) && delay !== undefined) {
        await wait(delay);
        continue;
      }
      throw new AiError(
        "Could not reach the Claude bridge. Check that the claude-bridge container is running.",
      );
    }
  }

  const body = (await response.json().catch(() => null)) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new AiError(
      body?.error?.message ?? `The AI request failed with status ${response.status}`,
    );
  }

  const text = (body?.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) throw new AiError("The AI returned an empty answer.");
  return text;
}

/** Waiting for a chat answer: shorter than a job's, a person is watching. */
const STREAM_TIMEOUT_MS = 5 * 60_000;

export type StreamMessage = {
  role: "user" | "assistant";
  /** Text, or text with images before it. */
  content: string | { text: string; images: ClaudeImage[] };
};

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number };

function toApiContent(content: StreamMessage["content"]) {
  if (typeof content === "string") return content;
  if (!content.images.length) return content.text;
  return [
    ...content.images.map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    })),
    { type: "text", text: content.text },
  ];
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * A conversation turn, streamed: yields the answer's text as it arrives, and
 * its token counts at the end.
 *
 * For the chat panel, where a person waits on the reply. Errors before the
 * first text throw as with `askClaude`; one after it throws mid-iteration,
 * and what was yielded so far stays the caller's to show.
 */
export async function* streamClaude(options: {
  token: string;
  system: string;
  messages: StreamMessage[];
  model?: string;
  /** How hard the model works on it; the bridge passes it to the CLI. */
  effort?: "low" | "medium" | "high";
  /** Let it think before answering. Off unless asked, as with the API. */
  thinking?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const base = process.env.CLAUDE_BRIDGE_URL?.trim().replace(/\/$/, "");
  if (!base) {
    throw new AiError("AI is not set up on this server: CLAUDE_BRIDGE_URL is missing.");
  }
  const signal = options.signal
    ? AbortSignal.any([AbortSignal.timeout(STREAM_TIMEOUT_MS), options.signal])
    : AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const maxTokens = options.maxTokens ?? 16_000;

  let response: Response | undefined;
  for (let attempt = 0; !response; attempt += 1) {
    try {
      response = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": options.token,
        },
        body: JSON.stringify({
          model: options.model ?? defaultModel(),
          max_tokens: maxTokens,
          system: options.system,
          messages: options.messages.map((message) => ({
            role: message.role,
            content: toApiContent(message.content),
          })),
          stream: true,
          ...(options.thinking ? { thinking: { type: "enabled", budget_tokens: 10_000 } } : {}),
          ...(options.effort ? { output_config: { effort: options.effort } } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiError("The AI took too long to answer.");
      }
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt];
      if (notConnected(error) && delay !== undefined) {
        await wait(delay);
        continue;
      }
      throw new AiError(
        "Could not reach the Claude bridge. Check that the claude-bridge container is running.",
      );
    }
  }

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AiError(body?.error?.message ?? `The AI request failed with status ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Server-sent events: blank-line separated, the JSON on a `data:` line.
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) continue;
        let parsed: {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
          message?: { usage?: Record<string, unknown> };
          usage?: Record<string, unknown>;
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        switch (parsed.type) {
          case "content_block_delta":
            if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
              yield { type: "text", text: parsed.delta.text };
            }
            break;
          case "message_start": {
            const usage = parsed.message?.usage ?? {};
            inputTokens =
              count(usage.input_tokens) +
              count(usage.cache_creation_input_tokens) +
              count(usage.cache_read_input_tokens);
            break;
          }
          case "message_delta":
            outputTokens = count(parsed.usage?.output_tokens) || outputTokens;
            break;
          case "message_stop":
            yield { type: "usage", inputTokens, outputTokens };
            break;
          case "error":
            throw new AiError(parsed.error?.message ?? "The AI stopped with an error.");
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiError("The AI took too long to answer.");
    }
    throw error;
  } finally {
    // Stopped early (the person closed the panel): drop the bridge's stream too.
    await reader.cancel().catch(() => {});
  }
}

/**
 * Pull the JSON out of a model reply.
 *
 * Prompts ask for JSON only, but a reply may still wrap it in a ```json fence
 * or a sentence of preamble, so this takes the fenced block if there is one,
 * else the outermost {...}.
 */
export function parseJsonReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AiError("The AI's answer did not contain the expected JSON.");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError("The AI's answer was not valid JSON.");
  }
}

/**
 * The code from a reply: the first fenced ts/typescript/js block, or a bare
 * fenced block. Code is asked for in a fence rather than inside JSON because
 * a model escapes quotes and newlines in a JSON string far less reliably.
 *
 * Fences are read in pairs, opening and closing together, so the closing
 * fence of an earlier ```json block is never taken for the opening of code.
 */
export function parseCodeReply(text: string): string | null {
  for (const match of text.matchAll(/```([\w-]*)[^\S\n]*\n([\s\S]*?)```/g)) {
    const language = (match[1] ?? "").toLowerCase();
    if (!["", "ts", "typescript", "js", "javascript"].includes(language)) continue;
    const code = match[2]?.trim();
    if (code) return code;
  }
  return null;
}

/** The fenced ```json block of a reply, when it has one alongside code. */
export function parseJsonBlock(text: string): unknown {
  const fence = /```json\s*([\s\S]*?)```/i.exec(text);
  if (!fence?.[1]) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return null;
  }
}
