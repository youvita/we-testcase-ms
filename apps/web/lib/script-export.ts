import type { RunEnvironmentDto } from "@wetestcase/dto";

/**
 * Automation scripts as files a developer can run outside this platform:
 * `npx playwright test` on their machine or in CI.
 *
 * A saved script is only the body of a test; the runner wraps it with the
 * fixtures it relies on (`vars`, `env`, paths joined under the base URL).
 * The same wrapping is written out here, reading the environment from
 * process.env / a .env file instead of the platform. Secret values are
 * never written: the person fills them in their own .env.
 */

export type ExportCase = {
  tcId: string;
  title: string;
  platform: "WEB" | "API";
  moduleName: string;
  subModule: string | null;
  code: string;
};

/** The fixtures every script relies on — the runner's, minus its reporting. */
const FIXTURES_BODY = `// Settings come from the environment, or from a .env file next to the
// Playwright config (Node 20.12+ reads it). See .env.example.
try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file: the variables are set some other way, e.g. in CI.
}

/** The environment's variables, as the platform's scripts use them: vars.LOGIN_ID. */
export const vars: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, key) => (typeof key === "string" ? (process.env[key] ?? "") : undefined),
});

/** Where the tests run. A blank setting counts as not set. */
export const env = {
  name: process.env.ENV_NAME || "local",
  webUrl: process.env.WEB_BASE_URL || null,
  apiUrl: process.env.API_BASE_URL || null,
};

// Paths join onto the base URL as text: "/users" on ".../api/v1" is
// ".../api/v1/users". Standard URL resolution would drop "/api/v1".
const join = (root: string | null, url: string) =>
  typeof url !== "string" || !root || /^[a-z][a-z0-9+.-]*:/i.test(url)
    ? url
    : root.replace(/[/]+$/, "") + "/" + url.replace(/^[/]+/, "");

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (url, options) => goto(join(env.webUrl, url), options);
    await use(page);
  },
  request: async ({ request }, use) => {
    // In a Web case, request is for setting up data through the API.
    const root = env.apiUrl ?? env.webUrl;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "fetch"] as const) {
      const send = (request[method] as (...args: unknown[]) => unknown).bind(request);
      (request as unknown as Record<string, unknown>)[method] = (url: string, options?: unknown) =>
        send(join(root, url), options);
    }
    await use(request);
  },
});

export { expect };
`;

const FIXTURES_FILE = `import { test as base, expect } from "@playwright/test";

${FIXTURES_BODY}`;

function testBody(testCase: ExportCase): string {
  const fixtures =
    testCase.platform === "API" ? "{ request }" : "{ page, context, browser, request }";
  const code = testCase.code
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
  return `test(${JSON.stringify(`${testCase.tcId} ${testCase.title}`)}, async (${fixtures}) => {
${code}
});
`;
}

function caseHeader(testCase: ExportCase): string {
  const group = testCase.subModule
    ? `${testCase.moduleName} › ${testCase.subModule}`
    : testCase.moduleName;
  return `// ${testCase.tcId} — ${testCase.title}
// ${group} · ${testCase.platform === "API" ? "API" : "Web"} · exported from TestCase MS`;
}

/** Variables the scripts use: vars.NAME. */
function usedVariables(cases: ExportCase[]): string[] {
  const names = new Set<string>();
  for (const testCase of cases) {
    for (const match of testCase.code.matchAll(/\bvars\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

/** The settings to fill in, from the environment — secrets left blank. */
function envLines(cases: ExportCase[], environment: RunEnvironmentDto | null): string[] {
  const known = new Map((environment?.variables ?? []).map((v) => [v.key, v]));
  const lines = [
    `ENV_NAME=${environment?.name ?? "local"}`,
    `WEB_BASE_URL=${environment?.webBaseUrl ?? ""}`,
    `API_BASE_URL=${environment?.apiBaseUrl ?? ""}`,
  ];
  const names = new Set([...known.keys(), ...usedVariables(cases)]);
  for (const name of [...names].sort()) {
    const variable = known.get(name);
    // Notes on their own line: not every reader of .env strips a trailing one.
    if (variable?.secret) lines.push("# Secret — fill in yourself", `${name}=`);
    else if (variable) lines.push(`${name}=${variable.value ?? ""}`);
    else lines.push("# Used by a script, but not set in the environment", `${name}=`);
  }
  return lines;
}

/** One case as a single runnable file, fixtures included. */
export function singleSpecFile(testCase: ExportCase, environment: RunEnvironmentDto | null): string {
  const settings = envLines([testCase], environment)
    .map((line) => (line.startsWith("#") ? `//   ${line.slice(1).trim()}:` : `//   ${line}`))
    .join("\n");
  return `${caseHeader(testCase)}
//
// Run it with Playwright (npm i -D @playwright/test && npx playwright install chromium):
//   npx playwright test ${fileName(testCase)}
// after setting these, in the shell or in a .env file next to it:
${settings}

import { test as base, expect } from "@playwright/test";

${FIXTURES_BODY}
${testBody(testCase)}`;
}

/** A file name from the TC ID: "TC-AI-10.spec.ts". */
export function fileName(testCase: Pick<ExportCase, "tcId">): string {
  return `${safeName(testCase.tcId)}.spec.ts`;
}

function safeName(text: string): string {
  return text.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/\s+/g, " ").trim() || "untitled";
}

/** Every file of a Playwright project holding the cases, keyed by path. */
export function projectFiles(
  projectName: string,
  cases: ExportCase[],
  environment: RunEnvironmentDto | null,
): Record<string, string> {
  const files: Record<string, string> = {
    "tests/fixtures.ts": FIXTURES_FILE,
    "playwright.config.ts": CONFIG_FILE,
    "package.json": `${JSON.stringify(
      {
        name: safeName(projectName).toLowerCase().replace(/[ .]+/g, "-") + "-tests",
        private: true,
        scripts: { test: "playwright test", report: "playwright show-report" },
        devDependencies: { "@playwright/test": "1.64.0", "@types/node": "^22.0.0" },
      },
      null,
      2,
    )}\n`,
    ".env.example": `${envLines(cases, environment).join("\n")}\n`,
    ".gitignore": "node_modules/\n.env\ntest-results/\nplaywright-report/\n",
    "README.md": readme(projectName, cases, environment),
  };
  for (const testCase of cases) {
    const folder = [testCase.moduleName, testCase.subModule]
      .filter((part): part is string => Boolean(part))
      .map(safeName)
      .join("/");
    files[`tests/${folder}/${fileName(testCase)}`] = `${caseHeader(testCase)}

import { test, expect, vars, env } from "${"../".repeat(folder.split("/").length)}fixtures";

${testBody(testCase)}`;
  }
  return files;
}

const CONFIG_FILE = `import { defineConfig } from "@playwright/test";

// The same settings the TestCase MS runner uses.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
`;

function readme(
  projectName: string,
  cases: ExportCase[],
  environment: RunEnvironmentDto | null,
): string {
  return `# ${projectName} — automated tests

Exported from TestCase MS: ${cases.length} test case${cases.length === 1 ? "" : "s"}, one file each under \`tests/<module>/<sub-module>/\`.

## Run them

Needs Node.js 20.12 or newer.

\`\`\`sh
npm install
npx playwright install chromium
cp .env.example .env    # then fill in the blanks — passwords are not exported
npm test
\`\`\`

\`npm run report\` opens the HTML report with screenshots and traces of failures.

## Settings

\`.env\` holds where the tests run (\`WEB_BASE_URL\`, \`API_BASE_URL\`) and the
variables the scripts read as \`vars.NAME\`.${environment ? ` The example is filled from the **${environment.name}** environment; secret values are left blank.` : ""}
In CI, set the same names as environment variables instead of a file.

## Editing

Each file is the script saved on its test case, wrapped in a Playwright test.
Changes made here do not go back to TestCase MS — paste them into the case's
script there if the platform should run them too.
`;
}
