import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiError, BRIDGE_RETRY_DELAYS_MS, askClaude } from "./claude";

/** What Node's fetch throws when nothing listens at the address. */
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const reply = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
const ask = () => askClaude({ token: "sk-ant-oat-x", system: "s", prompt: "p" });

describe("askClaude reaching the bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CLAUDE_BRIDGE_URL", "http://claude-bridge:8788");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("waits for a bridge that is restarting, as during a deploy", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce(reply("Hello"));
    vi.stubGlobal("fetch", fetch);

    const answer = ask();
    await vi.runAllTimersAsync();
    await expect(answer).resolves.toBe("Hello");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up once the waits run out", async () => {
    const fetch = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetch);

    const answer = ask();
    const failed = expect(answer).rejects.toThrow("Could not reach the Claude bridge");
    await vi.runAllTimersAsync();
    await failed;
    expect(fetch).toHaveBeenCalledTimes(BRIDGE_RETRY_DELAYS_MS.length + 1);
  });

  it("does not send again when the connection dropped mid-request", async () => {
    // The bridge may already be running the turn: a second one would run it twice.
    const dropped = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
    const fetch = vi.fn().mockRejectedValue(dropped);
    vi.stubGlobal("fetch", fetch);

    await expect(ask()).rejects.toBeInstanceOf(AiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not wait out a timeout either", async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    vi.stubGlobal("fetch", fetch);

    await expect(ask()).rejects.toThrow("took too long");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
