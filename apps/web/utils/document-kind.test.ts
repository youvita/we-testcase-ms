import { describe, expect, it } from "vitest";

import { detectDocKind } from "./document-kind";

const prose = "Some text about the feature that is long enough to be a paragraph of a document.";

describe("detectDocKind", () => {
  it("reads the kind from the file name", () => {
    expect(detectDocKind({ fileName: "WeBill365 2FA — FRD.md", content: prose })).toBe("FRD");
    expect(detectDocKind({ fileName: "Payments_PRD_v2.docx", content: prose })).toBe("PRD");
    expect(detectDocKind({ fileName: "Functional-Specification.pdf", content: prose })).toBe("FRD");
  });

  it("prefers the title and file name over the text", () => {
    expect(
      detectDocKind({ title: "Checkout PRD", content: "# Functional requirements\n" + prose }),
    ).toBe("PRD");
  });

  it("reads the opening when the name says nothing", () => {
    expect(detectDocKind({ fileName: "2fa.md", content: "# Product Requirements Document\n" + prose })).toBe("PRD");
    expect(
      detectDocKind({ fileName: "2fa.md", content: "# Functional Requirements Document\n\n## Functional requirements\n" + prose }),
    ).toBe("FRD");
  });

  it("takes whichever the opening names first", () => {
    expect(
      detectDocKind({ content: "# Product requirements: 2FA\n\n## Functional requirements\n" + prose }),
    ).toBe("PRD");
  });

  it("does not take non-functional requirements for an FRD", () => {
    expect(detectDocKind({ content: "## Non-functional requirements\n" + prose })).toBe("OTHER");
    expect(detectDocKind({ content: "## Nonfunctional requirements\n" + prose })).toBe("OTHER");
  });

  it("does not match words that only contain the letters", () => {
    expect(detectDocKind({ title: "PRDX import", content: prose })).toBe("OTHER");
  });

  it("calls API specs Other", () => {
    expect(detectDocKind({ fileName: "openapi.yaml", content: "# Billing API — API reference\n" })).toBe("OTHER");
    expect(detectDocKind({ fileName: "collection.json", content: prose })).toBe("OTHER");
    expect(detectDocKind({ title: "Billing FRD", content: "# Billing — API reference\n" + prose })).toBe("OTHER");
  });

  it("calls anything else Other", () => {
    expect(detectDocKind({ title: "Release notes", fileName: "notes.txt", content: prose })).toBe("OTHER");
  });
});
