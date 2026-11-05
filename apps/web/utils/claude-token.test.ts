import { describe, expect, it } from "vitest";

import { normalizeToken } from "./claude-token";

const TOKEN = "sk-ant-oat01-AbC_dEf-123456789xyz";

describe("normalizeToken", () => {
  it("keeps a clean token as it is", () => {
    expect(normalizeToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it("joins a token copied wrapped from a Windows console", () => {
    // conhost pads each wrapped line with spaces to the window's width.
    expect(normalizeToken("sk-ant-oat01-AbC_dEf-12      \r\n3456789xyz      \r\n")).toBe(TOKEN);
  });

  it("finds the token in text copied with it", () => {
    expect(normalizeToken(`Your OAuth token (valid for 1 year):\n\n${TOKEN}\n\nStore this token securely.`)).toBe(TOKEN);
  });

  it("still recognises an API key, so it can be refused by name", () => {
    expect(normalizeToken("key: sk-ant-api03-abc_DEF")).toBe("sk-ant-api03-abc_DEF");
  });

  it("returns what it was given when there is no token in it", () => {
    expect(normalizeToken("not a token")).toBe("notatoken");
  });
});
