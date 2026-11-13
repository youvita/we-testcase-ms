import { describe, expect, it } from "vitest";

import { readImproved } from "./ai-writing.service";

describe("readImproved", () => {
  it("takes the text inside the tags, ignoring anything around them", () => {
    expect(readImproved("Sure!\n<text>\nPlease check F1-02.\n</text>\nDone")).toBe("Please check F1-02.");
  });
  it("keeps line breaks and lists inside", () => {
    expect(readImproved("<text>Two things:\n- one\n- two</text>")).toBe("Two things:\n- one\n- two");
  });
  it("falls back to the whole reply when the tags are missing", () => {
    expect(readImproved("  Fixed text.  ")).toBe("Fixed text.");
  });
});
