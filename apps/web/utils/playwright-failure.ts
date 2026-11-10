/**
 * A Playwright failure, said the way a tester would write it in "Actual
 * result" — no stack, no code frame — and where in the case it happened.
 *
 * No AI: Playwright's own assertion messages have a fixed shape (Expected /
 * Received / Locator / "waiting for …"), and that is all this reads. What it
 * does not recognise falls back to the error's first line.
 *
 * Where it happened comes from the script that ran: the AI marks each step
 * with a `// Step N: …` comment, and "Sign in first" puts the sign-in case's
 * script above the case's own (`// ---- TC-… ----` separates them). A failure
 * before Step 1 — signing in, opening the start page — means the case never
 * got to its steps: it is blocked, not failed.
 */

export type FailureSummary = {
  /** The plain sentence for "Actual result". */
  actualResult: string;
  /** Failed before the case's first step: the case is blocked, not failed. */
  beforeSteps: boolean;
};

const STEP = /^\s*\/\/\s*Step\s+(\d+)\s*[:.)-]?\s*(.*)$/i;
const CASE_SEPARATOR = /^\/\/ ---- (?!Sign in first)[^\n]* ----$/;

/** Roles as a tester names them. */
const ROLE_NAMES: Record<string, string> = {
  button: "button",
  link: "link",
  textbox: "field",
  searchbox: "search field",
  combobox: "dropdown",
  listbox: "list",
  option: "option",
  checkbox: "checkbox",
  radio: "option",
  heading: "heading",
  dialog: "dialog",
  alert: "message",
  tab: "tab",
  menuitem: "menu item",
  row: "row",
  cell: "cell",
  img: "image",
};

const quoted = (text: string) => `“${text}”`;

/**
 * A text pattern as a tester would read it: /^\s*\d+\s+Customers\s*$/ →
 * “N Customers”. Patterns too clever to read stay as written.
 */
function readablePattern(pattern: string): string {
  const plainText = pattern
    .replace(/^\^|\$$/g, "")
    .replace(/\\s\*/g, "")
    .replace(/\\s\+/g, " ")
    .replace(/\\d\+|\\d/g, "N")
    .replace(/\\(.)/g, "$1")
    .trim();
  return /[[\](){}|?*+]/.test(plainText) ? `/${pattern}/` : quoted(plainText);
}

/** `getByRole('button', { name: 'Save' })` → the “Save” button. */
export function describeLocator(source: string): string | null {
  const str = `(['"\`])((?:\\\\.|(?!\\1).)*)\\1`;
  const text = (pattern: string) => source.match(new RegExp(pattern))?.[2];

  const role = source.match(
    /getByRole\(\s*(['"`])(\w+)\1(?:\s*,\s*\{[^}]*?name\s*:\s*(['"`])((?:\\.|(?!\3).)*)\3)?/,
  );
  if (role) {
    const kind = ROLE_NAMES[role[2]!] ?? role[2]!;
    return role[4] ? `the ${quoted(role[4])} ${kind}` : `the ${kind}`;
  }
  const label = text(`getByLabel\\(\\s*${str}`);
  if (label) return `the ${quoted(label)} field`;
  const placeholder = text(`getByPlaceholder\\(\\s*${str}`);
  if (placeholder) return `the field ${quoted(placeholder)}`;
  const shown = text(`getByText\\(\\s*${str}`);
  if (shown) return `the text ${quoted(shown)}`;
  const shownPattern = source.match(/getByText\(\s*\/((?:\\.|[^/])+)\/[a-z]*/)?.[1];
  if (shownPattern) return `the text ${readablePattern(shownPattern)}`;
  const title = text(`getByTitle\\(\\s*${str}`);
  if (title) return `the element titled ${quoted(title)}`;
  const testId = text(`getByTestId\\(\\s*${str}`);
  if (testId) return `the element ${quoted(testId)}`;
  const css = text(`locator\\(\\s*${str}`);
  if (css) return `the element ${quoted(css)}`;
  return null;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const unquote = (text: string) => text.trim().replace(/^"(.*)"$/s, "$1");
const seconds = (ms: string) => {
  const value = Number(ms) / 1000;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} s`;
};

/** A labelled line of Playwright's message: "Received string: …". */
function field(error: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = error.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"));
    if (match) return match[1]!.trim();
  }
  return null;
}

/** The script line that failed, from the code frame ("> 92 | …"). */
function failingCode(error: string): string | null {
  return error.match(/^\s*>\s*\d+\s*\|\s?(.*)$/m)?.[1]?.trim() ?? null;
}

/** The line number the error gives, counted from the top of the script. */
export function failingLine(error: string): number | null {
  const frame = error.match(/^\s*>\s*(\d+)\s*\|/m)?.[1] ?? error.match(/\bscript:(\d+):\d+/)?.[1];
  return frame ? Number(frame) : null;
}

/**
 * Where in `lines` the failure is (1-based). By the failing line's text, not
 * its number: runners have counted lines differently over time, so a number
 * can point anywhere. With several matches, the neighbouring lines of the
 * code frame pick the right one; with no frame, the number is trusted.
 */
export function locateFailure(error: string, lines: string[]): number | null {
  const frame = new Map<number, string>();
  let failing: number | null = null;
  for (const match of error.matchAll(/^\s*(>)?\s*(\d+)\s*\|\s?(.*)$/gm)) {
    const number = Number(match[2]);
    frame.set(number, match[3]!.trim());
    if (match[1]) failing = number;
  }
  const number = failingLine(error);
  if (failing === null) return number && number <= lines.length ? number : null;

  const text = frame.get(failing)!;
  const candidates = lines.flatMap((line, i) => (text && line.trim() === text ? [i + 1] : []));
  if (candidates.length === 0) return null;
  const score = (at: number) =>
    [...frame].reduce((sum, [n, t]) => sum + (t && lines[at - 1 + (n - failing!)]?.trim() === t ? 1 : 0), 0);
  return candidates.reduce((best, at) =>
    score(at) > score(best) || (score(at) === score(best) && Math.abs(at - failing!) < Math.abs(best - failing!))
      ? at
      : best,
  );
}

/** The locator the failure was about: its "Locator:" line, the wait, or the code. */
function locatorOf(error: string, code: string | null): string | null {
  const sources = [
    field(error, "Locator"),
    error.match(/waiting for (.+)$/m)?.[1] ?? null,
    error.match(/strict mode violation: (.+?) resolved to/)?.[1] ?? null,
    code,
  ];
  for (const source of sources) {
    const described = source ? describeLocator(source) : null;
    if (described) return described;
  }
  return null;
}

/** What the script did just before the failing line: “after clicking the … button”. */
function previousAction(lines: string[], failing: number | null): string | null {
  if (!failing) return null;
  for (let i = failing - 2; i >= Math.max(0, failing - 4); i--) {
    const line = lines[i] ?? "";
    if (STEP.test(line)) return null;
    if (/\.click\(/.test(line)) {
      const what = describeLocator(line);
      return what ? `after clicking ${what}` : null;
    }
    if (/\.press\(\s*['"`]Enter/.test(line)) return "after pressing Enter";
  }
  return null;
}

/** The plain sentence for one failure, with no "where". */
function sentence(error: string, lines: string[], line: number | null): string {
  const code = failingCode(error);
  const header = error.split("\n").find((l) => l.trim()) ?? "";
  const negated = /\.not\.to/.test(header);
  // "Timeout: 5000ms" under an assertion, or "Timeout 30000ms exceeded" in an action's line.
  const timeout = field(error, "Timeout") ?? header.match(/Timeout (\d+)ms exceeded/)?.[1] ?? null;
  const wait = timeout ? seconds(timeout.replace(/ms$/, "")) : null;
  const within = wait ? ` within ${wait}` : "";
  const what = locatorOf(error, code);
  const received = field(error, "Received string", "Received value", "Received");
  const expected = field(error, "Expected pattern", "Expected string", "Expected value", "Expected");

  // The page's address.
  if (/toHaveURL/.test(header) && received) {
    const after = previousAction(lines, line);
    const url = unquote(received);
    return negated
      ? `${after ? `${after}, ` : ""}the page stayed on ${url}`
      : `${after ? `${after}, ` : ""}the page went to ${url} instead of ${unquote((expected ?? "").replace(/^not /, ""))}`;
  }
  if (/toHaveTitle/.test(header) && received) {
    return `the page title was ${quoted(unquote(received))}, expected ${quoted(unquote(expected ?? ""))}`;
  }

  // Something on the page.
  if (/toBeVisible|toBeAttached/.test(header)) {
    return negated
      ? `${what ?? "the element"} was still showing${wait ? ` after ${wait}` : ""}`
      : `${what ?? "the element"} did not appear${within}`;
  }
  if (/toBeHidden/.test(header)) return `${what ?? "the element"} was still showing`;
  if (/toBeEnabled|toBeDisabled|toBeChecked|toBeEditable/.test(header)) {
    const state = header.match(/toBe(\w+)/)?.[1]?.toLowerCase() ?? "";
    return `${what ?? "the element"} was ${negated ? "" : "not "}${state}`;
  }
  if (/toHaveText|toContainText|toHaveValue/.test(header)) {
    if (received && /not found/.test(received)) return `${what ?? "the element"} could not be found${within}`;
    if (received && expected) {
      return `${what ?? "the element"} showed ${quoted(unquote(received))}, expected ${quoted(unquote(expected.replace(/^not /, "")))}`;
    }
  }
  if (/toHaveCount/.test(header) && received && expected) {
    return `found ${unquote(received)} of ${what ?? "the element"}, expected ${unquote(expected)}`;
  }

  // Plain values — most often an API response.
  if (/expect\(received\)/.test(header)) {
    if (code && /status\(\)/.test(code) && received && expected) {
      return `the API answered ${unquote(received)} instead of ${unquote(expected)}`;
    }
    if (code && /\.ok\(\)/.test(code)) return "the API request did not succeed";
    if (received && expected) return `expected ${unquote(expected)}, got ${unquote(received)}`;
  }

  // An action that could not be done.
  const action = header.match(/(?:locator|page)\.(click|fill|check|uncheck|selectOption|hover|press|type|setInputFiles)\b/)?.[1];
  if (/strict mode violation/.test(error)) {
    return `more than one ${what?.replace(/^the /, "") ?? "matching element"} is on the page, so the script could not tell which to use`;
  }
  if (action && /Timeout|waiting for/.test(error)) {
    const verb = { click: "click", fill: "fill in", check: "tick", uncheck: "untick", selectOption: "choose from", hover: "point at", press: "type in", type: "type in", setInputFiles: "upload to" }[action];
    return `could not ${verb} ${what ?? "the element"}: it was not found${within}`;
  }
  const goto = header.match(/page\.goto: (net::\w+|.*?) at (\S+)/);
  if (goto) return `could not open ${goto[2]} (${goto[1]})`;
  const testTimeout = header.match(/Test timeout of (\d+)ms exceeded/);
  if (testTimeout) return `the test did not finish within ${seconds(testTimeout[1]!)}`;

  return header.replace(/^\s*(Error|TimeoutError):\s*/, "").trim() || "the script failed";
}

/**
 * The failure as "Actual result", and whether it came before the steps.
 * `code` is the script that ran — with a sign-in case above it, if any.
 */
export function summariseFailure(error: string, code: string): FailureSummary {
  const lines = code.split("\n");
  const failing = locateFailure(error, lines);
  const plain = sentence(error, lines, failing);

  // Where the case's own script starts, and its first step.
  const ownStart = Math.max(0, lines.findIndex((l) => CASE_SEPARATOR.test(l.trim())) + 1);
  const firstStep = lines.findIndex((l, i) => i >= ownStart && STEP.test(l));

  // Can't place it, or the script has no steps marked: just the sentence.
  if (!failing || (firstStep === -1 && ownStart === 0)) {
    return { actualResult: `${capitalise(plain)}.`, beforeSteps: false };
  }

  const index = failing - 1;
  const signInBlock = ownStart > 0 && index < ownStart;
  const beforeSteps = signInBlock || (firstStep !== -1 && index < firstStep);
  if (beforeSteps) {
    // The sign-in case run first ("Sign in first") is what broke.
    if (signInBlock) {
      const signInCase = lines[0]?.match(/Sign in first: (\S+)/)?.[1];
      return {
        actualResult: `The sign-in case${signInCase ? ` ${signInCase}` : ""} failed: ${plain}.`,
        beforeSteps: true,
      };
    }
    // Just what led up to the failure — the comment heading it, and the lines
    // since: signing in, or another precondition.
    let heading: string | null = null;
    const lead: string[] = [];
    for (let i = index; i >= ownStart; i--) {
      const comment = lines[i]?.trim().match(/^\/\/\s*(?:Precondition:\s*)?(.+)$/i);
      if (comment && i < index) {
        heading = comment[1]!.trim().replace(/[.:]$/, "");
        break;
      }
      lead.push(lines[i] ?? "");
      if (lead.length > 4) break;
    }
    const signingIn = /password|log\s?in|sign\s?in|\/login/i.test([heading ?? "", ...lead].join("\n"));
    return {
      actualResult: signingIn
        ? `Could not sign in: ${plain}.`
        : `Before step 1${heading ? ` (${heading})` : ""}: ${plain}.`,
      beforeSteps: true,
    };
  }

  // The step it failed in: the last step marker above the failing line.
  for (let i = index; i >= ownStart; i--) {
    const step = lines[i]?.match(STEP);
    if (step) {
      const title = step[2]?.trim().replace(/[.:]$/, "");
      return { actualResult: `At step ${step[1]}${title ? ` (${title})` : ""}: ${plain}.`, beforeSteps: false };
    }
  }
  return { actualResult: `${capitalise(plain)}.`, beforeSteps: false };
}
