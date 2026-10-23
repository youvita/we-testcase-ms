/**
 * The TestCase MS runner: executes automated test runs with Playwright.
 *
 * It holds no database credentials and serves nothing. It asks the app for
 * work and reports back, all over the app's /api/runner/* routes with a shared
 * token:
 *
 *   claim → (heartbeat every 10 s) → result per test case → finish
 *
 * Each claimed run becomes a throwaway Playwright project under WORK_DIR: one
 * spec file per test case, its script wrapped in a `test(...)`, with the
 * environment's base URL and variables in scope. Playwright runs it, its JSON
 * report is read back, and every result goes to the app with its screenshot,
 * video and trace.
 *
 *   APP_URL        the app, including its base path   e.g. http://app:3000/cases
 *   RUNNER_TOKEN   the same value the app has
 *   RUNNER_NAME    shown on runs                      default: hostname
 *   WORKERS        parallel tests per run             default: 2
 *   TEST_TIMEOUT_MS  per test                         default: 60000
 *   WORK_DIR       scratch space                      default: <runner>/.work
 *
 * Runs with Node's own TypeScript support (Node 23.6+): `node src/index.ts`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RunnerItemResult, RunnerJob } from "@wetestcase/dto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[runner] ${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const APP_URL = required("APP_URL").replace(/\/+$/, "");
const RUNNER_TOKEN = required("RUNNER_TOKEN");
const RUNNER_NAME = process.env.RUNNER_NAME?.trim() || hostname();
const WORKERS = Math.max(1, Number(process.env.WORKERS) || 2);
const TEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.TEST_TIMEOUT_MS) || 60_000);
const POLL_MS = 3_000;
const HEARTBEAT_MS = 10_000;

const RUNNER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Inside the runner package so the specs resolve @playwright/test from its
// node_modules (or the workspace's hoisted one).
const WORK_DIR = path.resolve(process.env.WORK_DIR?.trim() || path.join(RUNNER_ROOT, ".work"));

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CLI = require.resolve("@playwright/test/cli");

const log = (message: string) =>
  console.log(`${new Date().toISOString()} [runner] ${message}`);

// ---------------------------------------------------------------------------
// The app's runner API
// ---------------------------------------------------------------------------

async function api<T>(
  method: "POST",
  route: string,
  body?: unknown,
): Promise<{ status: number; data: T | null }> {
  const response = await fetch(`${APP_URL}/api/runner${route}`, {
    method,
    headers: {
      authorization: `Bearer ${RUNNER_TOKEN}`,
      ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
    },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 204) return { status: 204, data: null };
  const json = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string }
    | null;
  if (!response.ok || !json || json.ok !== true) {
    const message = json && json.ok === false ? json.error : `HTTP ${response.status}`;
    throw new Error(`${route}: ${message}`);
  }
  return { status: response.status, data: json.data };
}

// ---------------------------------------------------------------------------
// Building the Playwright project for a run
// ---------------------------------------------------------------------------

/**
 * One spec per test case. The script is the body of the test; what it can
 * use is documented on the script editor in the app:
 *
 *   Web:  page, context, browser, request, expect, env, vars
 *   API:  request, expect, env, vars   (no browser is started)
 *
 * The environment is written into the spec itself rather than a file beside
 * it, so the spec has no module-format assumptions about how to read one.
 */
function specSource(job: RunnerJob, item: RunnerJob["items"][number]): string {
  const env = {
    name: job.environment.name,
    webUrl: job.environment.webBaseUrl,
    apiUrl: job.environment.apiBaseUrl,
  };
  const isApi = item.platform === "API";
  const baseURL = isApi ? env.apiUrl : env.webUrl;
  // In a Web case, `request` is for setting up data through the API.
  const requestRoot = isApi ? env.apiUrl : (env.apiUrl ?? env.webUrl);
  const fixtures = isApi ? "{ request }" : "{ page, context, browser, request }";

  return `import { test as base, expect } from "@playwright/test";

const env = ${JSON.stringify(env)};
const vars = ${JSON.stringify(job.environment.vars)};
const requestRoot = ${JSON.stringify(requestRoot)};

// Paths join onto the base URL as text: "/users" on ".../api/v1" is
// ".../api/v1/users". Standard URL resolution would drop "/api/v1", which is
// never what a tester means. Full URLs are left alone.
const join = (root, url) =>
  typeof url !== "string" || !root || /^[a-z][a-z0-9+.-]*:/i.test(url)
    ? url
    : root.replace(/[/]+$/, "") + "/" + url.replace(/^[/]+/, "");

const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (url, options) => goto(join(env.webUrl, url), options);
    await use(page);
  },
  request: async ({ request }, use) => {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "fetch"]) {
      const send = request[method].bind(request);
      request[method] = (url, options) => send(join(requestRoot, url), options);
    }
    await use(request);
  },
});

test.use({ baseURL: ${JSON.stringify(baseURL ?? undefined)} });

test(${JSON.stringify(`${item.tcId} ${item.title}`)}, async (${fixtures}) => {
// ---- script ----
${item.code}
// ---- end of script ----
});
`;
}


function configSource(): string {
  return `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "./results",
  fullyParallel: true,
  workers: ${WORKERS},
  timeout: ${TEST_TIMEOUT_MS},
  retries: 0,
  reporter: [["json", { outputFile: "report.json" }]],
  use: {
    // Evidence for every result, not just failures: a pass with a screenshot
    // is something QA can show; one without is a claim.
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
`;
}

// ---------------------------------------------------------------------------
// Reading Playwright's JSON report
// ---------------------------------------------------------------------------

type ReportAttachment = { name: string; contentType: string; path?: string };
type ReportResult = {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  duration: number;
  errors?: { message?: string }[];
  error?: { message?: string };
  stdout?: ({ text?: string } | { buffer?: string })[];
  stderr?: ({ text?: string } | { buffer?: string })[];
  attachments?: ReportAttachment[];
};
type ReportSpec = { file: string; tests: { results: ReportResult[] }[] };
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };
type Report = {
  suites?: ReportSuite[];
  errors?: { message?: string; location?: { file?: string } }[];
};

function collectSpecs(suites: ReportSuite[] = [], into: ReportSpec[] = []): ReportSpec[] {
  for (const suite of suites) {
    into.push(...(suite.specs ?? []));
    collectSpecs(suite.suites, into);
  }
  return into;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
/** The generated spec's path means nothing to QA; call it what it is. */
const SPEC_PATH = /\S*\/run-[^/\s]+\/\d{4}-[a-z0-9]+\.spec\.ts/g;
const clean = (text: string) => text.replace(ANSI, "").replace(SPEC_PATH, "script").trim();

function outputText(chunks: ReportResult["stdout"] = []): string {
  return chunks
    .map((chunk) =>
      "text" in chunk && chunk.text
        ? chunk.text
        : "buffer" in chunk && chunk.buffer
          ? Buffer.from(chunk.buffer, "base64").toString("utf8")
          : "",
    )
    .join("");
}

/**
 * A script that throws before it tests anything — a typo'd method, an
 * undefined variable — is a broken script, not a failing product. Recording it
 * as a test failure would put a false red on the case, so it is ERROR.
 */
const SCRIPT_BUG = /^(TypeError|ReferenceError|SyntaxError)\b/;

function itemResult(result: ReportResult): RunnerItemResult {
  const messages = (result.errors?.length ? result.errors : result.error ? [result.error] : [])
    .map((e) => clean(e.message ?? ""))
    .filter(Boolean);
  const error = messages.join("\n\n") || undefined;
  const logText = clean(outputText(result.stdout) + outputText(result.stderr));

  let status: RunnerItemResult["status"];
  switch (result.status) {
    case "passed":
      status = "PASSED";
      break;
    case "failed":
    case "timedOut":
      status = error && SCRIPT_BUG.test(error) ? "ERROR" : "FAILED";
      break;
    default:
      status = "SKIPPED";
  }

  return {
    status,
    durationMs: Math.round(result.duration),
    error:
      result.status === "timedOut"
        ? `Timed out after ${Math.round(TEST_TIMEOUT_MS / 1000)} s.${error ? `\n\n${error}` : ""}`
        : error,
    log: logText || undefined,
  };
}

const ARTIFACT_FIELDS: Record<string, "screenshot" | "video" | "trace"> = {
  screenshot: "screenshot",
  video: "video",
  trace: "trace",
};

async function reportItem(
  itemId: string,
  result: RunnerItemResult,
  attachments: ReportAttachment[] = [],
) {
  const form = new FormData();
  form.append("result", JSON.stringify(result));
  for (const attachment of attachments) {
    const field = ARTIFACT_FIELDS[attachment.name];
    if (!field || !attachment.path) continue;
    try {
      const bytes = await readFile(attachment.path);
      form.append(
        field,
        new Blob([new Uint8Array(bytes)], { type: attachment.contentType }),
        path.basename(attachment.path),
      );
    } catch {
      // Missing evidence should not lose the result itself.
    }
  }
  await api("POST", `/items/${itemId}/result`, form);
}

// ---------------------------------------------------------------------------
// Running one job
// ---------------------------------------------------------------------------

function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5_000).unref();
}

function runPlaywright(dir: string, extraArgs: string[] = []): ChildProcess {
  return spawn(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", "--config", path.join(dir, "playwright.config.ts"), ...extraArgs],
    { cwd: dir, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] },
  );
}

const exited = (child: ChildProcess) =>
  new Promise<void>((resolve) => child.on("close", () => resolve()));

async function readReport(dir: string): Promise<Report | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")) as Report;
  } catch {
    return null;
  }
}

/**
 * Find the specs Playwright cannot load, and set them aside.
 *
 * Playwright loads every spec before running any, so one script with a
 * syntax error would otherwise fail the whole run. A `--list` pass (load
 * only, nothing runs) reports which files broke; those are renamed out of the
 * way and the pass repeats until the rest load cleanly. It is Playwright's
 * own parser, so valid TypeScript is never mistaken for an error.
 */
async function setAsideBrokenSpecs(
  dir: string,
  files: string[],
): Promise<{ broken: Map<string, string>; fatal: string | null }> {
  const broken = new Map<string, string>();
  for (let pass = 0; pass < 5; pass += 1) {
    await rm(path.join(dir, "report.json"), { force: true });
    await exited(runPlaywright(dir, ["--list"]));
    const report = await readReport(dir);
    const errors = report?.errors ?? [];
    if (errors.length === 0) return { broken, fatal: null };

    let found = false;
    for (const error of errors) {
      const where = `${error.location?.file ?? ""}\n${error.message ?? ""}`;
      const file = files.find((f) => !broken.has(f) && where.includes(f));
      if (!file) continue;
      broken.set(file, clean(error.message ?? "The script could not be loaded."));
      await rm(path.join(dir, file), { force: true });
      found = true;
    }
    // Every script is broken: nothing left to load, and another pass would
    // only report "no tests found".
    if (broken.size === files.length) return { broken, fatal: null };
    // Errors that belong to no spec are about the project itself.
    if (!found) {
      return { broken, fatal: errors.map((e) => clean(e.message ?? "")).join("\n\n") };
    }
  }
  return { broken, fatal: "Too many scripts failed to load." };
}

async function executeRun(job: RunnerJob) {
  const dir = path.join(WORK_DIR, `run-${job.run.id}`);
  const label = `run #${job.run.number} (${job.run.projectName}, ${job.items.length} case${job.items.length === 1 ? "" : "s"}, ${job.environment.name})`;
  log(`starting ${label}`);

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // The specs are TypeScript modules; say which kind, whatever the package
  // above them declares.
  await writeFile(path.join(dir, "package.json"), '{ "type": "commonjs" }\n');
  await writeFile(path.join(dir, "playwright.config.ts"), configSource());
  const fileToItem = new Map<string, RunnerJob["items"][number]>();
  for (const [index, item] of job.items.entries()) {
    const file = `${String(index + 1).padStart(4, "0")}-${item.id}.spec.ts`;
    fileToItem.set(file, item);
    await writeFile(path.join(dir, file), specSource(job, item));
  }

  const { broken, fatal } = await setAsideBrokenSpecs(dir, [...fileToItem.keys()]);
  for (const [file, message] of broken) {
    const item = fileToItem.get(file)!;
    fileToItem.delete(file);
    await reportItem(item.id, { status: "ERROR", error: message }).catch((error) =>
      log(`could not report ${item.tcId}: ${(error as Error).message}`),
    );
  }
  if (fatal || fileToItem.size === 0) {
    await api("POST", `/runs/${job.run.id}/finish`, fatal ? { error: fatal } : {});
    log(`run #${job.run.number} ${fatal ? "could not start" : "had no script that loads"}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await rm(path.join(dir, "report.json"), { force: true });

  let output = "";
  let cancelled = false;
  const child = runPlaywright(dir);
  child.stdout?.on("data", (chunk) => (output = (output + chunk.toString()).slice(-20_000)));
  child.stderr?.on("data", (chunk) => (output = (output + chunk.toString()).slice(-20_000)));

  const beat = setInterval(async () => {
    try {
      const { data } = await api<{ cancel: boolean }>("POST", `/runs/${job.run.id}/heartbeat`);
      if (data?.cancel && !cancelled) {
        cancelled = true;
        log(`cancel requested for run #${job.run.number}`);
        stop(child);
      }
    } catch (error) {
      log(`heartbeat failed: ${(error as Error).message}`);
    }
  }, HEARTBEAT_MS);

  // A hard ceiling so one hung browser cannot hold the runner forever.
  const ceilingMs = (Math.ceil(job.items.length / WORKERS) + 1) * TEST_TIMEOUT_MS + 120_000;
  const ceiling = setTimeout(() => {
    log(`run #${job.run.number} exceeded ${Math.round(ceilingMs / 1000)} s — stopping`);
    stop(child);
  }, ceilingMs);

  await exited(child);
  clearInterval(beat);
  clearTimeout(ceiling);

  const report = await readReport(dir);

  if (!report) {
    await api("POST", `/runs/${job.run.id}/finish`, {
      error: cancelled ? undefined : `Playwright did not produce a report.\n\n${clean(output).slice(-3_000)}`,
    });
    log(`run #${job.run.number} ended without a report`);
    await rm(dir, { recursive: true, force: true });
    return;
  }

  const specs = collectSpecs(report.suites);
  const topErrors = report.errors ?? [];

  for (const [file, item] of fileToItem) {
    const spec = specs.find((s) => path.basename(s.file) === file);
    const results = spec?.tests[0]?.results ?? [];
    const result = results[results.length - 1];
    try {
      if (result) {
        await reportItem(item.id, itemResult(result), result.attachments);
      } else if (!cancelled) {
        // Never ran: usually a script that does not compile, which Playwright
        // reports at the top level with the file it failed on.
        const own = topErrors.filter((e) => (e.location?.file ?? e.message ?? "").includes(file));
        const message = (own.length ? own : topErrors)
          .map((e) => clean(e.message ?? ""))
          .filter(Boolean)
          .join("\n\n");
        await reportItem(item.id, {
          status: "ERROR",
          error: message || "The script did not run. See the run log.",
        });
      }
    } catch (error) {
      log(`could not report ${item.tcId}: ${(error as Error).message}`);
    }
  }

  await api("POST", `/runs/${job.run.id}/finish`, {});
  log(`finished run #${job.run.number}${cancelled ? " (cancelled)" : ""}`);
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Finish the current run; the app would otherwise mark it as abandoned.
    log(`${signal} — stopping after the current run`);
    stopping = true;
  });
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true });
  log(`${RUNNER_NAME} polling ${APP_URL} (workers ${WORKERS}, timeout ${TEST_TIMEOUT_MS / 1000} s)`);

  let failures = 0;
  while (!stopping) {
    let job: RunnerJob | null = null;
    try {
      job = (await api<RunnerJob>("POST", "/claim", { runner: RUNNER_NAME })).data;
      if (failures > 0) log("connected to the app again");
      failures = 0;
    } catch (error) {
      failures += 1;
      // Say it once, then quietly keep trying — the app may just be deploying.
      if (failures === 1) log(`cannot reach the app: ${(error as Error).message}`);
      await sleep(Math.min(POLL_MS * failures, 30_000));
      continue;
    }

    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    try {
      await executeRun(job);
    } catch (error) {
      log(`run #${job.run.number} failed: ${(error as Error).stack ?? error}`);
      await api("POST", `/runs/${job.run.id}/finish`, {
        error: `The runner failed: ${(error as Error).message}`,
      }).catch(() => undefined);
    }
  }
  log("stopped");
}

void main();
