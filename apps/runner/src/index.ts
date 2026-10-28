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
 *   EXPECT_TIMEOUT_MS  how long a check waits         default: 15000
 *   WORK_DIR       scratch space                      default: <runner>/.work
 *   HEADED=1       show the browser window — only where the runner has a
 *                  screen, i.e. run on your own Mac, not in Docker
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
// Playwright's own default is 5 s, too short for slow test environments: a
// login whose redirect took 6 s failed although it worked.
const EXPECT_TIMEOUT_MS = Math.max(1_000, Number(process.env.EXPECT_TIMEOUT_MS) || 15_000);
const HEADED = process.env.HEADED === "1";
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

// Secret values never leave the test: the outline records what was typed
// into fields, a password included.
const secrets = ${JSON.stringify(job.environment.secretKeys)}.map((k) => vars[k]).filter((v) => v && v.length >= 3);
const mask = (text) => secrets.reduce((out, secret) => out.split(secret).join("••••"), String(text));

// Paths join onto the base URL as text: "/users" on ".../api/v1" is
// ".../api/v1/users". Standard URL resolution would drop "/api/v1", which is
// never what a tester means. Full URLs are left alone.
const join = (root, url) =>
  typeof url !== "string" || !root || /^[a-z][a-z0-9+.-]*:/i.test(url)
    ? url
    : root.replace(/[/]+$/, "") + "/" + url.replace(/^[/]+/, "");

// Requests that went wrong — an error status or no answer at all. They are
// often the real reason a test failed (a 401 at login, a 500 on save), and
// are attached for the run page and for Claude. Page loads and API calls
// only; a missing image or font is not the story.
const failedRequests = [];
const noteFailure = (method, url, status, statusText) => {
  if (failedRequests.length < 50) {
    failedRequests.push({ method, url: mask(String(url).slice(0, 300)), status, statusText: mask(String(statusText ?? "")) });
  }
};
const worthNoting = (type) => type === "document" || type === "xhr" || type === "fetch";

const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = (url, options) => goto(join(env.webUrl, url), options);
    page.on("response", (response) => {
      const request = response.request();
      if (response.status() >= 400 && worthNoting(request.resourceType())) {
        noteFailure(request.method(), response.url(), response.status(), response.statusText());
      }
    });
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "failed";
      // An aborted request is the browser moving on, not a failure.
      if (worthNoting(request.resourceType()) && !/ERR_ABORTED/.test(reason)) {
        noteFailure(request.method(), request.url(), null, reason);
      }
    });
    // Native alert/confirm/prompt popups are not part of the page, so they
    // are in no screenshot or outline. Say so in the output. Listening stops
    // Playwright's own dismissing, so dismiss here unless the script handles
    // the popup itself (it added a listener of its own).
    page.on("dialog", async (dialog) => {
      const handled = page.listenerCount("dialog") > 1;
      console.log(
        "[browser " + dialog.type() + "] " + JSON.stringify(mask(dialog.message())) +
          (handled
            ? " — handled by the script"
            : " — dismissed (Cancel), because the script did not handle it. To accept it, call page.once(\\"dialog\\", (d) => d.accept()) before the click that opens it."),
      );
      if (!handled) await dialog.dismiss().catch(() => {});
    });
${
  job.run.liveToken
    ? `
    // "Watch live": Chrome sends a frame whenever the page changes; the
    // newest goes to the app a few times a second, for the run page.
    const cdp = await page.context().newCDPSession(page);
    let sentAt = 0;
    cdp.on("Page.screencastFrame", (frame) => {
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      const now = Date.now();
      if (now - sentAt < 300) return;
      sentAt = now;
      fetch(process.env.WTC_APP_URL + "/api/runner/live/${item.id}", {
        method: "POST",
        headers: { authorization: "Bearer " + process.env.WTC_LIVE_TOKEN, "content-type": "image/jpeg" },
        body: Buffer.from(frame.data, "base64"),
      }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1024, maxHeight: 768 });
    await use(page);
    await cdp.send("Page.stopScreencast").catch(() => {});
`
    : `
    await use(page);
`
}  },
  request: async ({ request }, use) => {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "fetch"]) {
      const send = request[method].bind(request);
      request[method] = async (url, options) => {
        const target = join(requestRoot, url);
        const verb = method === "fetch" ? String(options?.method ?? "GET").toUpperCase() : method.toUpperCase();
        try {
          const response = await send(target, options);
          if (response.status() >= 400) noteFailure(verb, response.url(), response.status(), response.statusText());
          return response;
        } catch (error) {
          noteFailure(verb, typeof target === "string" ? target : "(request)", null, String(error?.message ?? error).split("\\n")[0]);
          throw error;
        }
      };
    }
    await use(request);
  },
});

test.use({ baseURL: ${JSON.stringify(baseURL ?? undefined)} });

test.afterEach(async ({}, testInfo) => {
  if (failedRequests.length) {
    await testInfo.attach("network-errors", {
      body: JSON.stringify(failedRequests),
      contentType: "application/json",
    });
  }
});
${
  isApi
    ? ""
    : `
// The page as the test left it, as text: every field and button with its
// role and name. It is what Claude reads to repair a script or explain a
// failure, and QA can read it too.
test.afterEach(async ({ page }, testInfo) => {
  try {
    const outline = await page.locator("body").ariaSnapshot({ timeout: 5000 });
    await testInfo.attach("page-snapshot", {
      body: mask("URL: " + page.url() + "\\nTitle: " + (await page.title()) + "\\n\\n" + outline.slice(0, 60000)),
      contentType: "text/plain",
    });
  } catch {
    // A page that is gone or never opened has nothing to describe.
  }
});
`
}
test(${JSON.stringify(`${item.tcId} ${item.title}`)}, async (${fixtures}) => {
// ---- script ----
${item.code}
// ---- end of script ----
});
`;
}


function configSource(job: RunnerJob): string {
  return `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "./results",
  // "In order": one worker, files in their numbered order — for cases that
  // build on each other's data. Otherwise side by side.
  fullyParallel: ${!job.run.inOrder},
  workers: ${job.run.inOrder ? 1 : WORKERS},
  timeout: ${TEST_TIMEOUT_MS},
  expect: { timeout: ${EXPECT_TIMEOUT_MS} },
  retries: 0,
  reporter: [["json", { outputFile: "report.json" }]],
  use: {
    // Evidence for every result, not just failures: a pass with a screenshot
    // is something QA can show; one without is a claim.
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
    headless: ${!HEADED},
    // Slows every browser action when someone is watching the run.
    launchOptions: { slowMo: ${job.run.slowMoMs} },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
`;
}

// ---------------------------------------------------------------------------
// Reading Playwright's JSON report
// ---------------------------------------------------------------------------

/** A file attachment has `path`; one attached as data has base64 `body`. */
type ReportAttachment = { name: string; contentType: string; path?: string; body?: string };
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

/**
 * Drop Playwright's "Browser logs" block from an error: the browser's launch
 * command and process chatter, thousands of characters that push the code
 * frame — which line was running — past what is stored.
 */
const withoutBrowserLogs = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(Browser logs:|<launching>|<launched>|\[pid=\d+\])/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

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
    .map((e) => withoutBrowserLogs(clean(e.message ?? "")))
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

const ARTIFACT_FIELDS: Record<string, "screenshot" | "video" | "trace" | "snapshot" | "network"> = {
  screenshot: "screenshot",
  video: "video",
  trace: "trace",
  "page-snapshot": "snapshot",
  "network-errors": "network",
};

/**
 * Make an error's line numbers count from the top of the script, not of the
 * generated spec around it — so "line 18" is line 18 of what QA sees. Lines
 * of the wrapper itself (zero or below) keep their spec numbers.
 */
function renumber(text: string | undefined, offset: number): string | undefined {
  if (!text || !offset) return text;
  return text
    .replace(/script:(\d+):(\d+)/g, (whole, line: string, col: string) =>
      Number(line) - offset > 0 ? `script:${Number(line) - offset}:${col}` : whole,
    )
    .replace(/^(\s*>?\s*)(\d+)( \|)/gm, (whole, lead: string, line: string, bar: string) =>
      Number(line) - offset > 0 ? `${lead}${Number(line) - offset}${bar}` : whole,
    );
}

/** The current run's secret values, masked out of what is reported. */
let currentSecrets: string[] = [];
const maskSecrets = (text: string | undefined) =>
  text === undefined
    ? undefined
    : currentSecrets.reduce((out, secret) => out.split(secret).join("••••"), text);

async function reportItem(
  itemId: string,
  result: RunnerItemResult,
  attachments: ReportAttachment[] = [],
) {
  const form = new FormData();
  form.append(
    "result",
    JSON.stringify({ ...result, error: maskSecrets(result.error), log: maskSecrets(result.log) }),
  );
  for (const attachment of attachments) {
    const field = ARTIFACT_FIELDS[attachment.name];
    if (!field || (!attachment.path && !attachment.body)) continue;
    try {
      const bytes = attachment.path
        ? await readFile(attachment.path)
        : Buffer.from(attachment.body!, "base64");
      form.append(
        field,
        new Blob([new Uint8Array(bytes)], { type: attachment.contentType }),
        attachment.path ? path.basename(attachment.path) : `${attachment.name}.txt`,
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

function runPlaywright(dir: string, liveToken: string | null, extraArgs: string[] = []): ChildProcess {
  // Scripts run in this process and are written by people, so it never sees
  // the runner's own token. Watching live, it gets one good only for frames.
  const { RUNNER_TOKEN: _withheld, ...env } = process.env;
  return spawn(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", "--config", path.join(dir, "playwright.config.ts"), ...extraArgs],
    {
      cwd: dir,
      env: {
        ...env,
        CI: "1",
        FORCE_COLOR: "0",
        ...(liveToken ? { WTC_APP_URL: APP_URL, WTC_LIVE_TOKEN: liveToken } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
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
    await exited(runPlaywright(dir, null, ["--list"]));
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
  currentSecrets = job.environment.secretKeys
    .map((key) => job.environment.vars[key])
    .filter((value): value is string => typeof value === "string" && value.length >= 3);
  const dir = path.join(WORK_DIR, `run-${job.run.id}`);
  const label = `${job.run.label} (${job.run.projectName}, ${job.items.length} case${job.items.length === 1 ? "" : "s"}, ${job.environment.name})`;
  log(`starting ${label}`);

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // The specs are TypeScript modules; say which kind, whatever the package
  // above them declares.
  await writeFile(path.join(dir, "package.json"), '{ "type": "commonjs" }\n');
  await writeFile(path.join(dir, "playwright.config.ts"), configSource(job));
  const fileToItem = new Map<string, RunnerJob["items"][number]>();
  // How many lines of wrapper sit above each script in its spec.
  const offsets = new Map<string, number>();
  for (const [index, item] of job.items.entries()) {
    const file = `${String(index + 1).padStart(4, "0")}-${item.id}.spec.ts`;
    fileToItem.set(file, item);
    const spec = specSource(job, item);
    offsets.set(item.id, spec.slice(0, spec.indexOf(item.code)).split("\n").length - 1);
    await writeFile(path.join(dir, file), spec);
  }

  const { broken, fatal } = await setAsideBrokenSpecs(dir, [...fileToItem.keys()]);
  for (const [file, message] of broken) {
    const item = fileToItem.get(file)!;
    fileToItem.delete(file);
    await reportItem(item.id, { status: "ERROR", error: renumber(message, offsets.get(item.id) ?? 0) }).catch((error) =>
      log(`could not report ${item.tcId}: ${(error as Error).message}`),
    );
  }
  if (fatal || fileToItem.size === 0) {
    await api("POST", `/runs/${job.run.id}/finish`, fatal ? { error: fatal } : {});
    log(`${job.run.label} ${fatal ? "could not start" : "had no script that loads"}`);
    await rm(dir, { recursive: true, force: true });
    return;
  }
  await rm(path.join(dir, "report.json"), { force: true });

  let output = "";
  let cancelled = false;
  const child = runPlaywright(dir, job.run.liveToken);
  child.stdout?.on("data", (chunk) => (output = (output + chunk.toString()).slice(-20_000)));
  child.stderr?.on("data", (chunk) => (output = (output + chunk.toString()).slice(-20_000)));

  const beat = setInterval(async () => {
    try {
      const { data } = await api<{ cancel: boolean }>("POST", `/runs/${job.run.id}/heartbeat`);
      if (data?.cancel && !cancelled) {
        cancelled = true;
        log(`cancel requested for ${job.run.label}`);
        stop(child);
      }
    } catch (error) {
      log(`heartbeat failed: ${(error as Error).message}`);
    }
  }, HEARTBEAT_MS);

  // A hard ceiling so one hung browser cannot hold the runner forever.
  const workers = job.run.inOrder ? 1 : WORKERS;
  const ceilingMs = (Math.ceil(job.items.length / workers) + 1) * TEST_TIMEOUT_MS + 120_000;
  const ceiling = setTimeout(() => {
    log(`${job.run.label} exceeded ${Math.round(ceilingMs / 1000)} s — stopping`);
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
    log(`${job.run.label} ended without a report`);
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
        const outcome = itemResult(result);
        await reportItem(
          item.id,
          { ...outcome, error: renumber(outcome.error, offsets.get(item.id) ?? 0) },
          result.attachments,
        );
      } else if (!cancelled) {
        // Never ran: usually a script that does not compile, which Playwright
        // reports at the top level with the file it failed on.
        const own = topErrors.filter((e) => (e.location?.file ?? e.message ?? "").includes(file));
        const message = (own.length ? own : topErrors)
          .map((e) => withoutBrowserLogs(clean(e.message ?? "")))
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
  log(`finished ${job.run.label}${cancelled ? " (cancelled)" : ""}`);
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
  log(
    `${RUNNER_NAME} polling ${APP_URL} (workers ${WORKERS}, test ${TEST_TIMEOUT_MS / 1000} s, checks ${EXPECT_TIMEOUT_MS / 1000} s${HEADED ? ", headed" : ""})`,
  );

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
      log(`${job.run.label} failed: ${(error as Error).stack ?? error}`);
      await api("POST", `/runs/${job.run.id}/finish`, {
        error: `The runner failed: ${(error as Error).message}`,
      }).catch(() => undefined);
    }
  }
  log("stopped");
}

void main();
