import { describe, expect, it } from "vitest";

import { diffLines } from "./line-diff";

describe("diffLines", () => {
  it("marks every line the same when nothing changed", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("shows a changed line as removed then added, in place", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  it("handles lines added at the end and Windows line endings", () => {
    expect(diffLines("a\r\nb", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });
});
