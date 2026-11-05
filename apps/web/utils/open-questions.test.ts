import { describe, expect, it } from "vitest";

import { splitOpenQuestions } from "./open-questions";

describe("splitOpenQuestions", () => {
  it("moves the sentence naming a gap, and keeps the checks", () => {
    const result = splitOpenQuestions({
      expectedResult:
        "Focus moves into the dialog and both choices can be reached by keyboard. Activating cancel closes the dialog. Focus order and the default focused choice are not specified (confirm with PO)",
      openQuestions: null,
    });
    expect(result.expectedResult).toBe(
      "Focus moves into the dialog and both choices can be reached by keyboard. Activating cancel closes the dialog.",
    );
    expect(result.openQuestions).toBe("- Focus order and the default focused choice are not specified.");
  });

  it("keeps a marked check and asks the PO to confirm it", () => {
    const result = splitOpenQuestions({
      expectedResult:
        "The customer is created without a duplicate error. The new record appears in the list (confirm with PO).",
    });
    expect(result.expectedResult).toBe("The customer is created without a duplicate error. The new record appears in the list.");
    expect(result.openQuestions).toBe("- Confirm with the PO: The new record appears in the list.");
  });

  it("handles steps, other markers, and questions already there", () => {
    const result = splitOpenQuestions({
      steps: "1. Open Customers.\n2. Send DELETE to the delete endpoint (confirm endpoint with dev).",
      preconditions: "A customer exists. The admin role name is unclear (assumption — confirm with PO)",
      openQuestions: "- Which roles may delete?",
    });
    expect(result.steps).toBe("1. Open Customers.\n2. Send DELETE to the delete endpoint.");
    expect(result.preconditions).toBe("A customer exists.");
    expect(result.openQuestions).toBe(
      "- Which roles may delete?\n- The admin role name is unclear.\n- Confirm with the developers: Send DELETE to the delete endpoint.",
    );
  });

  it("reads a marker after the full stop as meaning the sentence before it", () => {
    const result = splitOpenQuestions({
      expectedResult:
        "The total count drops by one. If the last item on a page was deleted, the user lands on a valid page. (confirm with PO)",
    });
    expect(result.expectedResult).toBe("The total count drops by one. If the last item on a page was deleted, the user lands on a valid page.");
    expect(result.openQuestions).toBe(
      "- Confirm with the PO: If the last item on a page was deleted, the user lands on a valid page.",
    );
  });

  it("moves a sentence that is itself the question, and leaves steps that only say confirm", () => {
    const result = splitOpenQuestions({
      steps: "1. Press Delete.\n2. Confirm with Enter.",
      expectedResult: "The home page opens. Home page content is to be confirmed with PO.",
    });
    expect(result.steps).toBe("1. Press Delete.\n2. Confirm with Enter.");
    expect(result.expectedResult).toBe("The home page opens.");
    expect(result.openQuestions).toBe("- Home page content is to be confirmed with PO.");
  });

  it("leaves text without a marker exactly as it was", () => {
    const testCase = { expectedResult: "An error says the amount is undefined.", openQuestions: null };
    expect(splitOpenQuestions(testCase)).toEqual(testCase);
  });
});
