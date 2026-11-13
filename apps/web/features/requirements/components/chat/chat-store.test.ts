import { describe, expect, it } from "vitest";

import { toHistory, type ChatTurn } from "./chat-store";

describe("toHistory", () => {
  it("leaves out failed replies and lets a retried question replace the unanswered one", () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "first" },
      { role: "assistant", text: "Bridge down", error: true },
      { role: "user", text: "first, again" },
      { role: "assistant", text: "answer" },
    ];
    expect(toHistory(turns)).toEqual([
      { role: "user", content: "first, again" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("drops a trailing unanswered question, since the new one follows", () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "q1" },
      { role: "assistant", text: "a1" },
      { role: "user", text: "q2 that failed" },
      { role: "assistant", text: "oops", error: true },
    ];
    expect(toHistory(turns)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("notes files on past questions and cuts long turns", () => {
    const turns: ChatTurn[] = [
      { role: "user", text: "see this", files: ["shot.png"] },
      { role: "assistant", text: "x".repeat(10_000) },
    ];
    const history = toHistory(turns);
    expect(history[0]!.content).toBe("see this\n(attached then: shot.png)");
    expect(history[1]!.content.length).toBeLessThanOrEqual(6_000);
    expect(history[1]!.content.endsWith("…(cut)")).toBe(true);
  });

  it("keeps at most 38 turns and starts with a question", () => {
    const turns: ChatTurn[] = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `t${i}`,
    }));
    const history = toHistory(turns);
    expect(history.length).toBeLessThanOrEqual(38);
    expect(history[0]!.role).toBe("user");
    expect(history.at(-1)!.role).toBe("assistant");
  });
});
