import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamClaude, type StreamEvent } from "./claude";

/** A body that arrives in the given chunks, split wherever the test says. */
function sse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const delta = (text: string) => event("content_block_delta", { index: 0, delta: { type: "text_delta", text } });

async function collect(options: Partial<Parameters<typeof streamClaude>[0]> = {}) {
  const events: StreamEvent[] = [];
  for await (const item of streamClaude({
    token: "sk-ant-oat-x",
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    ...options,
  })) {
    events.push(item);
  }
  return events;
}

const textOf = (events: StreamEvent[]) =>
  events.map((item) => (item.type === "text" ? item.text : "")).join("");

describe("streamClaude", () => {
  beforeEach(() => vi.stubEnv("CLAUDE_BRIDGE_URL", "http://claude-bridge:8788"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("yields the text deltas, even when an event is split across chunks, then the usage", async () => {
    const whole =
      event("message_start", { message: { usage: { input_tokens: 10, cache_read_input_tokens: 5 } } }) +
      delta("Hello") +
      delta(", [F1-01]") +
      event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }) +
      event("message_stop", {});
    const cut = whole.indexOf("[F1");
    const fetch = vi.fn().mockResolvedValue(sse([whole.slice(0, cut), whole.slice(cut)]));
    vi.stubGlobal("fetch", fetch);

    const events = await collect();
    expect(textOf(events)).toBe("Hello, [F1-01]");
    expect(events.at(-1)).toEqual({ type: "usage", inputTokens: 15, outputTokens: 7 });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it("passes effort, thinking and images the way the bridge reads them", async () => {
    const fetch = vi.fn().mockResolvedValue(sse([delta("ok"), event("message_stop", {})]));
    vi.stubGlobal("fetch", fetch);

    await collect({
      effort: "high",
      thinking: true,
      messages: [{ role: "user", content: { text: "what is this?", images: [{ mediaType: "image/png", data: "AAA" }] } }],
    });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.thinking.type).toBe("enabled");
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "text", text: "what is this?" },
    ]);
  });

  it("throws the bridge's error event after the text so far", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse([delta("Part"), event("error", { error: { message: "limit reached" } })])),
    );
    const seen: StreamEvent[] = [];
    await expect(
      (async () => {
        for await (const item of streamClaude({ token: "t", system: "s", messages: [{ role: "user", content: "q" }] })) {
          seen.push(item);
        }
      })(),
    ).rejects.toThrow("limit reached");
    expect(textOf(seen)).toBe("Part");
  });

  it("reports a refused request with the bridge's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Connect your Claude subscription" } }), { status: 400 }),
      ),
    );
    await expect(collect()).rejects.toThrow("Connect your Claude subscription");
  });
});
