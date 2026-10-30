import { describe, expect, it } from "vitest";

import { errorHeadline, findErrorLine } from "./error-line";

const code = [
  'await page.goto("/login");',
  'await page.fill("#email", vars.USER_EMAIL);',
  'await expect(page).toHaveURL("/home");',
].join("\n");

describe("findErrorLine", () => {
  it("finds the failing line by its text, whatever number Playwright gave", () => {
    const error = 'Error: expected URL\n> 63 | await expect(page).toHaveURL("/home");';
    expect(findErrorLine(code, error)).toBe(3);
  });

  it("falls back to the number when the text is not in the script", () => {
    expect(findErrorLine(code, "> 2 | something else")).toBe(2);
    expect(findErrorLine(code, "> 2 | something else", { textOnly: true })).toBeNull();
  });

  it("returns null when there is no marked line or it is out of range", () => {
    expect(findErrorLine(code, "Timeout 30000ms exceeded")).toBeNull();
    expect(findErrorLine(code, "> 99 | nope")).toBeNull();
    expect(findErrorLine(code, null)).toBeNull();
  });
});

describe("errorHeadline", () => {
  it("is the first non-blank line", () => {
    expect(errorHeadline("\n  Error: boom  \nstack")).toBe("Error: boom");
    expect(errorHeadline(undefined)).toBe("");
  });
});
