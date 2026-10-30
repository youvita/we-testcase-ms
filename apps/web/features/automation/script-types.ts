/**
 * What the script editor knows about a script, so it can complete and check
 * it the way VS Code would.
 *
 * A script is the body of one Playwright test. The runner puts the fixtures
 * and the environment in scope (apps/runner/src/index.ts), so the editor
 * declares the same names: Playwright's own types for the fixtures, and the
 * project's environment variables for `vars`.
 */

/** Must match @playwright/test in apps/runner/package.json (a unit test checks). */
export const PLAYWRIGHT_VERSION = "1.64.0";

/** Must match the monaco-editor package the types come from (a unit test checks). */
export const MONACO_VERSION = "0.57.0";

export const MONACO_CDN = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

/**
 * Playwright's declarations, fetched from the CDN at the runner's version and
 * mounted where the editor's TypeScript looks for packages.
 */
export const PLAYWRIGHT_TYPE_FILES: { url: string; path: string }[] = [
  ["playwright", "test.d.ts"],
  ["playwright", "types/test.d.ts"],
  ["playwright-core", "index.d.ts"],
  ["playwright-core", "types/types.d.ts"],
  ["playwright-core", "types/structs.d.ts"],
  ["playwright-core", "types/protocol.d.ts"],
].map(([pkg, file]) => ({
  url: `https://cdn.jsdelivr.net/npm/${pkg}@${PLAYWRIGHT_VERSION}/${file}`,
  path: `file:///node_modules/${pkg}/${file}`,
}));

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Declarations for what a script has in scope. Web scripts get a browser;
 * API scripts only `request` — the runner starts no browser for them.
 * Variable names become properties of `vars`, so `vars.` lists them.
 */
export function scriptGlobals(
  platform: "WEB" | "API",
  variables: { key: string; secret: boolean }[],
): string {
  const seen = new Set<string>();
  const known = variables
    .filter((v) => IDENTIFIER.test(v.key) && !seen.has(v.key) && seen.add(v.key))
    .map((v) => `  /** ${v.secret ? "Secret — the value stays on the server" : "Environment variable"}. */\n  readonly ${v.key}: string;`);

  const fixtures =
    platform === "WEB"
      ? `/** The browser tab, already pointed at the environment: page.goto("/login"). */
declare const page: import("playwright-core").Page;
declare const context: import("playwright-core").BrowserContext;
declare const browser: import("playwright-core").Browser;
/** For setting up data through the API; paths join onto the API base URL. */
declare const request: import("playwright-core").APIRequestContext;
`
      : `/** HTTP client; paths join onto the environment's API base URL. */
declare const request: import("playwright-core").APIRequestContext;
`;

  return `${fixtures}declare const expect: typeof import("playwright/test").expect;
/** The environment the script runs against. */
declare const env: {
  readonly name: string;
  readonly webUrl: string | null;
  readonly apiUrl: string | null;
};
/** The environment's variables, by name. */
declare const vars: {
${known.join("\n")}
} & { readonly [name: string]: string };
`;
}
