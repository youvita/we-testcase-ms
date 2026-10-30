import { describe, expect, it } from "vitest";

import {
  findMatch,
  normalizeText,
  sameRequirementText,
  textSimilarity,
} from "./requirement-match";

describe("normalizeText", () => {
  it("ignores case, punctuation, bullets and spacing", () => {
    expect(normalizeText("- The user  MUST log in.")).toBe("the user must log in");
    expect(normalizeText(null)).toBe("");
  });
});

describe("textSimilarity", () => {
  it("is 1 for the same text and 0 for nothing shared", () => {
    expect(textSimilarity("Login works", "login works!")).toBe(1);
    expect(textSimilarity("abc", "xyz")).toBe(0);
    expect(textSimilarity("", "")).toBe(0);
  });

  it("works on scripts written without spaces", () => {
    // Khmer: the same sentence with one word changed still scores high.
    const before = "អ្នកប្រើត្រូវចូលប្រព័ន្ធ";
    const after = "អ្នកប្រើត្រូវចូលកម្មវិធី";
    expect(textSimilarity(before, after)).toBeGreaterThan(0.5);
  });
});

describe("sameRequirementText", () => {
  it("treats formatting-only edits as unchanged", () => {
    expect(
      sameRequirementText(
        { title: "Login", description: "- User signs in." },
        { title: "login", description: "User signs in" },
      ),
    ).toBe(true);
  });

  it("notices a changed acceptance criterion", () => {
    expect(
      sameRequirementText(
        { title: "Login", acceptanceCriteria: "Lock after 3 tries" },
        { title: "Login", acceptanceCriteria: "Lock after 5 tries" },
      ),
    ).toBe(false);
  });
});

describe("findMatch", () => {
  const candidates = [
    { id: "a", title: "User can reset password by email" },
    { id: "b", title: "Admin can export the user list" },
  ];

  it("takes a near-identical requirement as the same one", () => {
    const verdict = findMatch({ title: "User can reset their password by email" }, candidates);
    expect(verdict.kind).toBe("same");
    if (verdict.kind === "same") expect(verdict.candidate.id).toBe("a");
  });

  it("calls an unrelated requirement new", () => {
    expect(findMatch({ title: "Dark mode follows the system" }, candidates)).toEqual({
      kind: "new",
    });
  });

  it("asks QA when two candidates are equally close", () => {
    const twins = [
      { id: "x", title: "Export report as PDF" },
      { id: "y", title: "Export report as CSV" },
    ];
    expect(findMatch({ title: "Export report as PNG" }, twins).kind).toBe("ask");
  });

  it("calls everything new when there are no candidates", () => {
    expect(findMatch({ title: "Anything" }, [])).toEqual({ kind: "new" });
  });
});
