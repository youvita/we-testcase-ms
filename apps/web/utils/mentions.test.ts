import { describe, expect, it } from "vitest";

import { mentionAt, mentionedUsernames, splitMentions } from "./mentions";

describe("mentionedUsernames", () => {
  it("finds each @username once, in lower case", () => {
    expect(mentionedUsernames("@Monika please check, cc @dev and @monika.")).toEqual(["monika", "dev"]);
  });

  it("ignores email addresses", () => {
    expect(mentionedUsernames("Use pending@test.com / WrongPassword!888")).toEqual([]);
  });

  it("reads names with dots and underscores", () => {
    expect(mentionedUsernames("(@chan.youvita) @qa_lead")).toEqual(["chan.youvita", "qa_lead"]);
  });
});

describe("splitMentions", () => {
  it("cuts the text around each mention", () => {
    expect(splitMentions("Hi @quinn, done")).toEqual([
      { text: "Hi " },
      { mention: "quinn", text: "@quinn" },
      { text: ", done" },
    ]);
  });
});

describe("mentionAt", () => {
  it("finds the mention being typed", () => {
    expect(mentionAt("Hello @mon", 10)).toEqual({ start: 6, query: "mon" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("is not fooled by an email or a finished word", () => {
    expect(mentionAt("me@test", 7)).toBeNull();
    expect(mentionAt("@quinn done", 11)).toBeNull();
  });
});
