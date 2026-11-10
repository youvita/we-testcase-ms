import { describe, expect, it } from "vitest";

import { describeLocator, summariseFailure } from "./playwright-failure";

/** A script: sign-in lines, then numbered steps — as the AI writes them. */
function script(signIn: string[], steps: string[][]) {
  return [
    ...signIn,
    "",
    ...steps.flatMap((step, i) => [`// Step ${i + 1}: ${step[0]}`, ...step.slice(1), ""]),
  ].join("\n");
}

/** Playwright's error, pointing at `line` of the script. */
const at = (message: string, line: number, code: string) =>
  `${message}\n\n> ${line} | ${code}\n    |   ^\n  at script:${line}:5`;

describe("describeLocator", () => {
  it("names elements the way a tester would", () => {
    expect(describeLocator(`getByRole("button", { name: "Log in" })`)).toBe("the “Log in” button");
    expect(describeLocator(`getByRole('textbox', { name: 'Email' })`)).toBe("the “Email” field");
    expect(describeLocator(`getByRole("dialog")`)).toBe("the dialog");
    expect(describeLocator(`getByLabel("Amount")`)).toBe("the “Amount” field");
    expect(describeLocator(`getByText('Customer saved')`)).toBe("the text “Customer saved”");
    expect(describeLocator(`locator('#total')`)).toBe("the element “#total”");
    expect(describeLocator("await page.goto('/x')")).toBeNull();
  });
});

describe("summariseFailure", () => {
  const signIn = [
    'await page.goto("/kh/en/login");',
    'await page.getByRole("textbox", { name: "Email" }).fill(vars.LOGIN_EMAIL);',
    'await page.getByRole("textbox", { name: "Password" }).fill(vars.LOGIN_PASSWORD);',
    'await page.getByRole("button", { name: "Log in" }).click();',
    "await expect(page).not.toHaveURL(/\\/login/);",
  ];
  const code = script(signIn, [
    ["open the Customers page", 'await page.goto("/kh/customers");'],
    ["Save the customer", 'await page.getByRole("button", { name: "Save" }).click();', "await expect(page.getByText('Customer saved')).toBeVisible();"],
  ]);

  it("says a failed sign-in plainly, and that the case never got to its steps", () => {
    // Run #5's error, as Playwright gave it.
    const error = [
      "Error: expect(page).not.toHaveURL(expected) failed",
      "",
      "Expected pattern: not /\\/login/",
      'Received string: "https://test-ba.webill365.com/kh/en/login"',
      "Timeout: 5000ms",
      "",
      "Call log:",
      '  - Expect "not toHaveURL" with timeout 5000ms',
      '    14 × locator resolved to <html lang="en">…</html>',
      '      - unexpected value "https://test-ba.webill365.com/kh/en/login"',
      "",
      "",
      '  4 | await page.getByRole("button", { name: "Log in" }).click();',
      "> 5 | await expect(page).not.toHaveURL(/\\/login/);",
      "    |                          ^",
      "  6 |",
      "  7 | // Step 1: open the Customers page",
      "    at script:5:24",
    ].join("\n");

    expect(summariseFailure(error, code)).toEqual({
      actualResult:
        "Could not sign in: after clicking the “Log in” button, the page stayed on https://test-ba.webill365.com/kh/en/login.",
      beforeSteps: true,
    });
  });

  it("names the step a real failure happened in", () => {
    const line = code.split("\n").findIndex((l) => l.includes("toBeVisible")) + 1;
    const error = at(
      [
        "Error: expect(locator).toBeVisible() failed",
        "",
        "Locator: getByText('Customer saved')",
        "Expected: visible",
        "Timeout: 5000ms",
        "Error: element(s) not found",
      ].join("\n"),
      line,
      "await expect(page.getByText('Customer saved')).toBeVisible();",
    );
    expect(summariseFailure(error, code)).toEqual({
      actualResult: "At step 2 (Save the customer): the text “Customer saved” did not appear within 5 s.",
      beforeSteps: false,
    });
  });

  it("treats the sign-in case run first as before the steps", () => {
    const ran = `// ---- Sign in first: TC-LOGIN-01 ----\n${signIn.join("\n")}\n\n// ---- TC-CUS-02 ----\n${script([], [["Open customers", "await page.goto('/c');"]])}`;
    const error = at(
      "TimeoutError: locator.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('textbox', { name: 'Email' })",
      3,
      'await page.getByRole("textbox", { name: "Email" }).fill(vars.LOGIN_EMAIL);',
    );
    expect(summariseFailure(error, ran)).toEqual({
      actualResult: "The sign-in case TC-LOGIN-01 failed: could not fill in the “Email” field: it was not found within 30 s.",
      beforeSteps: true,
    });
  });

  it("reads text, API and other common failures", () => {
    const one = (message: string, codeLine: string) =>
      summariseFailure(at(message, 2, codeLine), `// Step 1: Check\n${codeLine}`).actualResult;

    expect(
      one(
        'Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByRole(\'heading\')\nExpected string: "Invoices"\nReceived string: "Customers"\nTimeout: 5000ms',
        "await expect(page.getByRole('heading')).toHaveText('Invoices');",
      ),
    ).toBe("At step 1 (Check): the heading showed “Customers”, expected “Invoices”.");

    expect(
      one(
        "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 200\nReceived: 401",
        "expect(response.status()).toBe(200);",
      ),
    ).toBe("At step 1 (Check): the API answered 401 instead of 200.");

    expect(
      one(
        "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:",
        "await page.getByRole('button', { name: 'Save' }).click();",
      ),
    ).toBe("At step 1 (Check): more than one “Save” button is on the page, so the script could not tell which to use.");
  });

  it("finds the failing line by its text when the line numbers are off", () => {
    // Older runners counted lines from elsewhere: "92" in a much shorter script.
    const error = [
      "Error: expect(page).not.toHaveURL(expected) failed",
      "",
      "Expected pattern: not /\\/login/",
      'Received string: "https://uat.example.com/login"',
      "",
      '  91 | await page.getByRole("button", { name: "Log in" }).click();',
      "> 92 | await expect(page).not.toHaveURL(/\\/login/);",
      "  93 |",
      "  94 | // Step 1: open the Customers page",
    ].join("\n");
    expect(summariseFailure(error, code)).toMatchObject({
      actualResult: "Could not sign in: after clicking the “Log in” button, the page stayed on https://uat.example.com/login.",
      beforeSteps: true,
    });
  });

  it("names a precondition that failed after signing in", () => {
    const ran = [
      ...signIn,
      "",
      "// Precondition: read the customer total from the header",
      'await page.goto("/kh/customers");',
      "await expect(page.getByText(/^\\s*\\d+\\s+Customers\\s*$/)).toBeVisible();",
      "",
      "// Step 1: Add a customer",
      "await page.getByRole('button', { name: 'New' }).click();",
    ].join("\n");
    const error = at(
      "Error: expect(locator).toBeVisible() failed\n\nLocator: getByText(/^\\s*\\d+\\s+Customers\\s*$/)\nExpected: visible\nTimeout: 5000ms",
      9,
      "await expect(page.getByText(/^\\s*\\d+\\s+Customers\\s*$/)).toBeVisible();",
    );
    expect(summariseFailure(error, ran)).toEqual({
      actualResult: "Before step 1 (read the customer total from the header): the text “N Customers” did not appear within 5 s.",
      beforeSteps: true,
    });
  });

  it("reads a text pattern the way a tester would", () => {
    expect(describeLocator("getByText(/^\\s*\\d+\\s+Customers\\s*$/)")).toBe("the text “N Customers”");
    expect(describeLocator("getByText(/Saved|Done/i)")).toBe("the text /Saved|Done/");
  });

  it("keeps the first line of anything it does not recognise, without the code", () => {
    const error = at("Error: Something odd happened\n  at foo (bar.js:1:1)", 2, "await odd();");
    expect(summariseFailure(error, "// Step 1: Odd\nawait odd();").actualResult).toBe(
      "At step 1 (Odd): Something odd happened.",
    );
  });

  it("does not guess a place in a script with no steps marked", () => {
    const error = at("Error: expect(received).toBe(expected)\n\nExpected: 1\nReceived: 2", 1, "expect(a).toBe(1);");
    expect(summariseFailure(error, "expect(a).toBe(1);")).toEqual({
      actualResult: "Expected 1, got 2.",
      beforeSteps: false,
    });
  });
});
