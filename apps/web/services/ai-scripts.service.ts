import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { badRequest, HttpError, notFound } from "@/lib/api";
import {
  AiError,
  askClaude,
  parseCodeReply,
  parseJsonBlock,
  type ClaudeImage,
} from "@/lib/claude";
import { PLATFORM_LABELS } from "@/lib/constants";
import { isAutomationConfigured } from "@/lib/runner-auth";
import type { SessionUser } from "@/lib/session";
import {
  AUTOMATABLE_PLATFORMS,
  RUN_SPEEDS,
  TRIAGE_CATEGORIES,
  isAutomatablePlatform,
  type AiJobDto,
  type FailedRequest,
  type Platform,
  type RunTriageDto,
  type ScriptBatchResult,
  type ScriptJobRow,
  type ScriptWritingResult,
} from "@wetestcase/dto";

import { enqueueJob, stopQueuedJobs, sweepInterrupted } from "./ai-job.service";
import { saveAutomationScript } from "./automation-script.service";
import { getEnvironmentOutline } from "./run-environment.service";
import { queueRun, readItemEvidence, waitForRun } from "./test-run.service";

/**
 * Claude and automation: writing a test case's script, and explaining why an
 * automated result failed.
 *
 * Writing is a loop against the real environment, not a guess from the
 * steps. For a Web case the runner first opens the start page and returns
 * its outline (Playwright's aria snapshot — every field and button by role
 * and name). Claude drafts from the case and that outline; the runner tries
 * the draft as a script check (which records nothing); on failure Claude sees
 * the error, the screenshot and the outline of the page where it stopped, and
 * repairs it. It stops on a pass, when it judges the product itself is wrong,
 * or when it needs something only QA knows. QA reviews the result before
 * anything is saved.
 *
 * Both run as background jobs on the subscription of whoever asked.
 */

const MAX_ATTEMPTS = 3;
const SNAPSHOT_CHARS = 30_000;

// ---------------------------------------------------------------------------
// Shared prompt pieces
// ---------------------------------------------------------------------------

type CaseForPrompt = {
  tcId: string;
  title: string;
  preconditions: string | null;
  steps: string | null;
  expectedResult: string | null;
  platform: Platform;
  module: { name: string };
};

type EnvironmentOutline = Awaited<ReturnType<typeof getEnvironmentOutline>>;

function fixturesFor(platform: Platform) {
  return platform === "API"
    ? "`request` (HTTP client on the API base URL — no browser is started)"
    : "`page`, `context`, `browser` (Chromium on the Web base URL) and `request` (HTTP client on the API base URL, for setting up data)";
}

function describeCase(testCase: CaseForPrompt) {
  return [
    `Test case ${testCase.tcId}: ${testCase.title}`,
    `Module: ${testCase.module.name} · Platform: ${PLATFORM_LABELS[testCase.platform]}`,
    testCase.preconditions && `Preconditions:\n${testCase.preconditions}`,
    `Steps:\n${testCase.steps || "(none written — work from the title and expected result)"}`,
    `Expected result:\n${testCase.expectedResult || "(none written — infer the obvious check from the title)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function describeEnvironment(env: EnvironmentOutline) {
  const vars = env.variables.length
    ? env.variables.map((v) => `- vars.${v.key}${v.secret ? " (secret)" : ""}`).join("\n")
    : "(none — if the test needs an account, use a vars.NAME you suggest and say so in notes)";
  return `Environment "${env.name}"
Web base URL: ${env.webBaseUrl ?? "(none)"}
API base URL: ${env.apiBaseUrl ?? "(none)"}
Variables available (values are hidden from you):
${vars}`;
}

function describeFailedRequests(requests: FailedRequest[] | undefined) {
  if (!requests?.length) return "";
  return `
Requests that went wrong during the test (the application's own answers — often the real reason):
${requests
  .slice(0, 20)
  .map((r) => `- ${r.method} ${r.url} → ${r.status ?? "no response"} ${r.statusText}`.trimEnd())
  .join("\n")}
`;
}

function describePage(snapshot: string | null, where: string) {
  if (!snapshot) return `No page outline is available ${where}.`;
  const trimmed =
    snapshot.length > SNAPSHOT_CHARS
      ? `${snapshot.slice(0, SNAPSHOT_CHARS)}\n… (cut)`
      : snapshot;
  return `Page outline ${where} (Playwright aria snapshot; use these roles and names):
\`\`\`yaml
${trimmed}
\`\`\``;
}

// ---------------------------------------------------------------------------
// Writing a script
// ---------------------------------------------------------------------------

const WRITE_SYSTEM = `You are a senior QA automation engineer. You turn a manual black-box test case into a Playwright test script in TypeScript, and you repair it when it fails against the real application.

You write only the body of an async test function. The runner wraps it: never write imports, test(...), describe(...) or a function around it.

Rules:
- Paths are relative to the environment's base URL: page.goto("/login"), request.get("/users"). Never hard-code a host.
- Never hard-code accounts, passwords, OTPs or tokens. Use vars.NAME from the variables listed. If the test needs a value that is not listed, use a sensible vars.NAME anyway and say in notes that QA must add it.
- Find elements the way a user does: getByRole, getByLabel, getByPlaceholder, getByText — using names that appear in the page outline. Use a CSS selector only when nothing else identifies the element.
- Follow the test case's steps in order, with a short comment for each step.
- End with expect(...) assertions that prove the expected result. A script with no assertion proves nothing.
- Do not use page.waitForTimeout: locators and expect already wait.
- Never weaken or remove an assertion to make a test pass. If the application does not do what the test case expects, that is a finding about the product, not a script problem.

Answer with the complete script in one \`\`\`ts block, then a \`\`\`json block: {"verdict": "...", "notes": "..."}. Notes are for QA: one to three sentences, always in English — whatever language the application or its pages are in.`;

function firstDraftPrompt(options: {
  testCase: CaseForPrompt;
  env: EnvironmentOutline;
  startPath: string;
  instructions?: string;
  snapshot: string | null;
}) {
  const isApi = options.testCase.platform === "API";
  return `${describeCase(options.testCase)}

${describeEnvironment(options.env)}

In scope: ${fixturesFor(options.testCase.platform)}, plus expect, vars and env (env.name, env.webUrl, env.apiUrl).
${options.instructions ? `\nInstructions from QA: ${options.instructions}\n` : ""}
${
  isApi
    ? "No endpoint list is available beyond what the steps say. When an endpoint is not stated, use the most likely REST path and say so in notes."
    : `The browser opened ${options.startPath}. ${options.snapshot ? "A screenshot of it is attached." : ""}\n\n${describePage(options.snapshot, `of ${options.startPath}`)}`
}

Write the first version of the script. Use "draft" as the verdict.`;
}

function repairPrompt(options: {
  testCase: CaseForPrompt;
  env: EnvironmentOutline;
  instructions?: string;
  attempt: number;
  code: string;
  status: string;
  error: string | null;
  log: string | null;
  snapshot: string | null;
  hasScreenshot: boolean;
  failedRequests?: FailedRequest[];
  /** QA's hint after seeing earlier tries. */
  hint?: string;
}) {
  const passed = options.status === "PASSED";
  return `${describeCase(options.testCase)}

${describeEnvironment(options.env)}

In scope: ${fixturesFor(options.testCase.platform)}, plus expect, vars and env.
${options.instructions ? `\nInstructions from QA: ${options.instructions}\n` : ""}${
    options.hint
      ? `
Hint from QA after watching your earlier tries — it is first-hand knowledge of the application, so trust it over anything you assumed:
${options.hint}
`
      : ""
  }
${
  passed
    ? `The script below ran against ${options.env.name} and passed. QA wants it changed as the hint says.`
    : `Attempt ${options.attempt} of the script ran against ${options.env.name} and did not pass.`
}

\`\`\`ts
${options.code}
\`\`\`

Result: ${options.status}
Error:
${options.error ?? "(none reported)"}
${options.log ? `\nConsole output:\n${options.log.slice(-3000)}\n` : ""}
${options.hasScreenshot ? "A screenshot of where it stopped is attached.\n" : ""}${describeFailedRequests(options.failedRequests)}
${describePage(options.snapshot, "where it stopped")}

Decide which one applies and answer with the full script and that verdict:
- "script_fixed": the script was wrong — a locator, a step, the order, a path. Return the corrected script.
- "product_bug": the script did reach the check, and the application does not do what the expected result says. Return the script with its assertion intact and explain the difference in notes.
- "needs_info": it cannot go further without something only QA can provide — an account, an OTP, a CAPTCHA bypass, an endpoint. Return the script as far as it can go and say exactly what is needed.`;
}

const verdictSchema = z
  .object({
    verdict: z.enum(["draft", "script_fixed", "product_bug", "needs_info"]).catch("draft"),
    notes: z.string().catch(""),
  })
  .catch({ verdict: "draft", notes: "" });

function readDraft(reply: string) {
  const code = parseCodeReply(reply);
  if (!code) throw new AiError("Claude did not return a script.");
  return { code, ...verdictSchema.parse(parseJsonBlock(reply)) };
}

export async function startScriptWriting(
  testCaseId: string,
  user: SessionUser,
  input: {
    environmentId: string;
    /** Blank means the environment's start page. */
    startPath?: string;
    instructions?: string;
    liveView?: boolean;
    speed?: keyof typeof RUN_SPEEDS;
    /** Save the script on the case if, and only if, it passed. */
    autoSave?: boolean;
    /** Groups the jobs of one "write scripts for these cases". */
    batchId?: string;
    /**
     * Pick up from an earlier script-writing job for this case — its last
     * script and where it stopped — with a hint from QA, instead of starting
     * over.
     */
    continueFrom?: { jobId: string; hint: string };
  },
): Promise<AiJobDto> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      id: true,
      projectId: true,
      tcId: true,
      title: true,
      preconditions: true,
      steps: true,
      expectedResult: true,
      platform: true,
      module: { select: { name: true } },
    },
  });
  if (!testCase) throw notFound("Test case");
  if (!isAutomatablePlatform(testCase.platform)) {
    throw badRequest(`${PLATFORM_LABELS[testCase.platform]} cases cannot be automated yet.`);
  }
  if (!isAutomationConfigured()) {
    throw new HttpError(503, "Automation is not set up on this server (RUNNER_TOKEN), so Claude cannot try its scripts.");
  }

  const env = await getEnvironmentOutline(input.environmentId, testCase.projectId);
  const startPath = input.startPath ?? env.startPath;
  const base = testCase.platform === "API" ? env.apiBaseUrl : env.webBaseUrl;
  if (!base) {
    throw badRequest(`${env.name} has no ${PLATFORM_LABELS[testCase.platform]} base URL. Add it in Environments.`);
  }

  const busy = await prisma.aiJob.findFirst({
    where: {
      kind: "WRITE_SCRIPT",
      status: { in: ["QUEUED", "RUNNING"] },
      input: { path: ["testCaseId"], equals: testCaseId },
    },
    select: { id: true },
  });
  if (busy) throw badRequest("Claude is already writing a script for this case.");

  let earlier: ScriptWritingResult | null = null;
  if (input.continueFrom) {
    const job = await prisma.aiJob.findUnique({
      where: { id: input.continueFrom.jobId },
      select: { kind: true, status: true, result: true, input: true },
    });
    earlier = (job?.result as ScriptWritingResult | null) ?? null;
    if (
      !job ||
      job.kind !== "WRITE_SCRIPT" ||
      job.status !== "SUCCEEDED" ||
      earlier?.testCaseId !== testCaseId ||
      !earlier.code
    ) {
      throw badRequest("There is no finished script from Claude on this case to continue from.");
    }
  }

  return enqueueJob(
    {
      projectId: testCase.projectId,
      kind: "WRITE_SCRIPT",
      userId: user.id,
      input: { testCaseId, ...input, startPath },
    },
    async ({ token, progress, setResult }) => {
      const isWeb = testCase.platform === "WEB";
      // One step before the tries: the start-page look, or picking up the
      // earlier script.
      const total = MAX_ATTEMPTS + (isWeb || earlier ? 1 : 0);
      let step = 0;
      await progress(step, total);

      const result: ScriptWritingResult = {
        testCaseId,
        outcome: "failing",
        code: "",
        notes: "",
        attempts: [],
      };

      const tryScript = async (code: string) => {
        const queued = await queueRun({
          projectId: testCase.projectId,
          userId: user.id,
          environment: env,
          purpose: "SCRIPT_CHECK",
          recordResults: false,
          liveView: input.liveView ?? false,
          slowMoMs: RUN_SPEEDS[input.speed ?? "normal"],
          items: [{ testCaseId, code }],
        });
        // Published before waiting, so the page can show this check live.
        result.currentRunId = queued.id;
        await setResult(result);
        const run = await waitForRun(queued.id);
        result.currentRunId = null;
        const item = run.items[0];
        if (!item) throw new AiError("The script check came back empty.");
        return { runId: run.id, item, runError: run.error };
      };

      // 1. Look at the start page before writing anything — or, continuing,
      //    at where the earlier script stopped.
      let evidence: {
        snapshot: string | null;
        screenshot: ClaudeImage | null;
        failedRequests?: FailedRequest[];
      } = {
        snapshot: null,
        screenshot: null,
      };
      let previous: { code: string; status: string; error: string | null; log: string | null } | null = null;
      if (earlier) {
        const last = earlier.attempts.at(-1);
        const lastItem =
          last && last.code === earlier.code
            ? await prisma.testRunItem.findFirst({
                where: { runId: last.runId },
                select: { id: true, status: true, error: true, log: true },
              })
            : null;
        if (lastItem && last) {
          previous = { code: earlier.code, status: lastItem.status, error: lastItem.error, log: lastItem.log };
          evidence = await readItemEvidence(lastItem.id);
          // Listed first, so the round shows what it picked up from.
          result.attempts.push({ code: earlier.code, runId: last.runId, status: lastItem.status, error: lastItem.error, earlier: true });
        } else {
          // The earlier job ended on a script it never ran (it judged a
          // product bug or needed information): run it now to see.
          const check = await tryScript(earlier.code);
          previous = { code: earlier.code, status: check.item.status, error: check.item.error, log: check.item.log };
          evidence = await readItemEvidence(check.item.id);
          result.attempts.push({ code: earlier.code, runId: check.runId, status: check.item.status, error: check.item.error, earlier: true });
        }
        await setResult(result);
        await progress(++step, total);
      } else if (isWeb) {
        const probe = await tryScript(`await page.goto(${JSON.stringify(startPath)});`);
        if (probe.item.status !== "PASSED") {
          throw new AiError(
            `Could not open ${startPath} on ${env.name}: ${probe.item.error ?? probe.runError ?? "the page did not load"}`,
          );
        }
        evidence = await readItemEvidence(probe.item.id);
        await progress(++step, total);
      }

      // 2. Draft, try, repair.
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const reply = await askClaude({
          token,
          system: WRITE_SYSTEM,
          images: evidence.screenshot ? [evidence.screenshot] : undefined,
          prompt: previous
            ? repairPrompt({
                testCase,
                env,
                instructions: input.instructions,
                // Counting on from the earlier job's tries when continuing.
                attempt: (earlier?.attempts.length ?? 0) + attempt - 1,
                ...previous,
                snapshot: evidence.snapshot,
                hasScreenshot: Boolean(evidence.screenshot),
                failedRequests: evidence.failedRequests,
                // The hint is the reason for this job; it goes with every try.
                hint: input.continueFrom?.hint,
              })
            : firstDraftPrompt({
                testCase,
                env,
                startPath,
                instructions: input.instructions,
                snapshot: evidence.snapshot,
              }),
        });
        const draft = readDraft(reply);
        result.code = draft.code;
        result.notes = draft.notes;

        // Claude's judgement that the script is right and the product is
        // not (or that it needs QA) ends the loop: another run would only
        // repeat the same failure.
        //
        // A product-bug verdict on a script Claude has just changed is a
        // claim about code that never ran, though. Run it once first: a
        // failure confirms it, with the failing line to show; a pass means
        // Claude was wrong and the script is good.
        if (draft.verdict === "product_bug" && draft.code !== previous?.code) {
          const { runId, item } = await tryScript(draft.code);
          result.attempts.push({ code: draft.code, runId, status: item.status, error: item.error });
          await progress(++step, total);
          if (item.status === "PASSED") {
            result.outcome = "passed";
            result.notes = `Claude expected the product to fail this check, but the script passed when it ran. ${draft.notes}`.trim();
            await setResult(result);
            break;
          }
        }
        if (draft.verdict === "product_bug" || draft.verdict === "needs_info") {
          result.outcome = draft.verdict;
          await setResult(result);
          break;
        }

        const { runId, item } = await tryScript(draft.code);
        result.attempts.push({ code: draft.code, runId, status: item.status, error: item.error });
        await progress(++step, total);

        if (item.status === "PASSED") {
          result.outcome = "passed";
          await setResult(result);
          break;
        }
        await setResult(result);
        previous = { code: draft.code, status: item.status, error: item.error, log: item.log };
        evidence = await readItemEvidence(item.id);
      }

      if (input.autoSave && result.outcome === "passed") {
        // Verified against the environment; anything short of a pass waits
        // for QA on the case instead.
        await saveAutomationScript(testCaseId, user.id, result.code, { verified: true });
        result.saved = true;
      }

      await progress(total, total);
      await setResult(result);
      return {
        passed: `Wrote a script that passes on ${env.name}`,
        product_bug: "Wrote a script — and it looks like the product does not meet the expected result",
        needs_info: "Wrote what it could — Claude needs something from QA to finish",
        failing: `Wrote a script, but it still fails after ${MAX_ATTEMPTS} attempts`,
      }[result.outcome];
    },
  );
}

// ---------------------------------------------------------------------------
// Writing scripts for many cases
// ---------------------------------------------------------------------------

/**
 * Queue a script-writing job per case. They run one after another — they all
 * draw on the same person's subscription — and each is the same loop as for
 * a single case. Cases that cannot be written are skipped with the reason.
 */
export async function startScriptWritingBatch(
  projectId: string,
  user: SessionUser,
  input: {
    testCaseIds: string[];
    environmentId: string;
    startPath?: string;
    instructions?: string;
    skipScripted: boolean;
    autoSave: boolean;
  },
): Promise<ScriptBatchResult> {
  const env = await getEnvironmentOutline(input.environmentId, projectId);
  const cases = await prisma.testCase.findMany({
    where: { projectId, id: { in: input.testCaseIds } },
    orderBy: { tcId: "asc" },
    select: { id: true, tcId: true, platform: true, script: { select: { testCaseId: true } } },
  });
  const busy = new Set(
    (
      await prisma.aiJob.findMany({
        where: { projectId, kind: "WRITE_SCRIPT", status: { in: ["QUEUED", "RUNNING"] } },
        select: { input: true },
      })
    ).map((job) => (job.input as { testCaseId?: string } | null)?.testCaseId),
  );

  const batchId = randomUUID();
  const result: ScriptBatchResult = { batchId, queued: [], skipped: [] };
  for (const testCase of cases) {
    const skip = (reason: string) => result.skipped.push({ tcId: testCase.tcId, reason });
    if (!(AUTOMATABLE_PLATFORMS as readonly string[]).includes(testCase.platform)) {
      skip(`${PLATFORM_LABELS[testCase.platform]} cases cannot be automated yet`);
    } else if (input.skipScripted && testCase.script) {
      skip("already has a script");
    } else if (busy.has(testCase.id)) {
      skip("Claude is already writing its script");
    } else if (testCase.platform === "API" && !env.apiBaseUrl) {
      skip(`${env.name} has no API base URL`);
    } else if (testCase.platform === "WEB" && !env.webBaseUrl) {
      skip(`${env.name} has no Web base URL`);
    } else {
      await startScriptWriting(testCase.id, user, {
        environmentId: input.environmentId,
        startPath: input.startPath,
        instructions: input.instructions,
        autoSave: input.autoSave,
        batchId,
      });
      result.queued.push({ tcId: testCase.tcId });
    }
  }
  return result;
}

/** Recent script-writing jobs in a project, newest first, with their cases. */
export async function listScriptJobs(projectId: string): Promise<ScriptJobRow[]> {
  await sweepInterrupted({ projectId, kind: "WRITE_SCRIPT" });
  const jobs = await prisma.aiJob.findMany({
    where: {
      projectId,
      kind: "WRITE_SCRIPT",
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const caseIds = jobs.map((job) => (job.input as { testCaseId?: string } | null)?.testCaseId);
  const cases = await prisma.testCase.findMany({
    where: { id: { in: caseIds.filter((id): id is string => Boolean(id)) } },
    select: { id: true, tcId: true, title: true },
  });
  const byId = new Map(cases.map((c) => [c.id, c]));

  return jobs.map((job) => {
    const input = (job.input ?? {}) as { testCaseId?: string; batchId?: string };
    const result = job.result as ScriptWritingResult | null;
    return {
      jobId: job.id,
      batchId: input.batchId ?? null,
      status: job.status,
      progressDone: job.progressDone,
      progressTotal: job.progressTotal,
      outcome: job.status === "SUCCEEDED" ? (result?.outcome ?? null) : null,
      saved: Boolean(result?.saved),
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      testCase: (input.testCaseId && byId.get(input.testCaseId)) || null,
    };
  });
}

/** Stop the cases of a batch that have not started. */
export async function stopScriptBatch(projectId: string, batchId: string) {
  return stopQueuedJobs({
    projectId,
    kind: "WRITE_SCRIPT",
    input: { path: ["batchId"], equals: batchId },
  });
}

/** The newest script-writing job for a case, for the test case page. */
export async function getLatestScriptJob(testCaseId: string) {
  return prisma.aiJob.findFirst({
    where: { kind: "WRITE_SCRIPT", input: { path: ["testCaseId"], equals: testCaseId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// Explaining a failure
// ---------------------------------------------------------------------------

const TRIAGE_SYSTEM = `You are a senior QA engineer reviewing an automated black-box test that did not pass. You decide why, so the right person acts on it.

Categories:
- "product_bug": the application does not do what the test case expects.
- "script_issue": the script is wrong — a locator, a step, timing, a wrong path or a typo — and the application may well be fine.
- "environment": the environment is at fault — down, slow, wrong data, an expired account, a certificate.
- "unclear": the evidence does not settle it; say what would.

Be concrete and brief; QA and developers read this. Always write in English, whatever language the application or its pages are in. Never call something a product bug just because an assertion failed — check the screenshot, the page outline and any failed requests for what actually happened. A failed request is strong evidence: 401/403 points at the account, 423/429 at a lockout or rate limit, 5xx at the environment or a server bug.

Answer with a \`\`\`json block:
{"category": "...", "summary": "one sentence", "explanation": "two to five sentences", "bugReport": {"title": "...", "steps": "...", "expected": "...", "actual": "..."} or null}
Include bugReport only for product_bug. For script_issue, also add the complete corrected script in a \`\`\`ts block after the JSON (only the body of the test, as before).`;

const triageSchema = z.object({
  category: z.enum(TRIAGE_CATEGORIES).catch("unclear"),
  summary: z.string().min(1),
  explanation: z.string().catch(""),
  bugReport: z
    .object({
      title: z.string(),
      steps: z.string().catch(""),
      expected: z.string().catch(""),
      actual: z.string().catch(""),
    })
    .nullable()
    .catch(null),
});

export async function startTriage(itemId: string, user: SessionUser): Promise<AiJobDto> {
  const item = await prisma.testRunItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      status: true,
      code: true,
      error: true,
      log: true,
      run: { select: { projectId: true, environmentName: true } },
      testCase: {
        select: {
          tcId: true,
          title: true,
          preconditions: true,
          steps: true,
          expectedResult: true,
          platform: true,
          module: { select: { name: true } },
        },
      },
    },
  });
  if (!item) throw notFound("Run item");
  const testCase = item.testCase;
  if (!testCase) throw badRequest("Only a test case's result can be explained.");
  if (item.status !== "FAILED" && item.status !== "ERROR") {
    throw badRequest("Only failed results can be explained.");
  }

  return enqueueJob(
    {
      projectId: item.run.projectId,
      kind: "TRIAGE_FAILURE",
      userId: user.id,
      input: { runItemId: item.id },
    },
    async ({ token, progress }) => {
      await progress(0, 1);
      const evidence = await readItemEvidence(item.id);
      const reply = await askClaude({
        token,
        system: TRIAGE_SYSTEM,
        images: evidence.screenshot ? [evidence.screenshot] : undefined,
        prompt: `${describeCase(testCase)}

Environment: ${item.run.environmentName}

Script that ran:
\`\`\`ts
${item.code}
\`\`\`

Result: ${item.status}${item.status === "ERROR" ? " (the script itself failed to run)" : ""}
Error:
${item.error ?? "(none reported)"}
${item.log ? `\nConsole output:\n${item.log.slice(-3000)}\n` : ""}
${evidence.screenshot ? "A screenshot of the page at the end of the test is attached.\n" : ""}${describeFailedRequests(evidence.failedRequests)}
${describePage(evidence.snapshot, "at the end of the test")}`,
      });

      const parsed = triageSchema.safeParse(parseJsonBlock(reply));
      if (!parsed.success) throw new AiError("Claude's answer did not contain a readable verdict.");
      const fixedCode = parsed.data.category === "script_issue" ? parseCodeReply(reply) : null;

      const triage: Omit<RunTriageDto, "triagedAt"> = {
        ...parsed.data,
        fixedCode,
        bugReport: parsed.data.category === "product_bug" ? parsed.data.bugReport : null,
      };
      await prisma.testRunItem.update({
        where: { id: item.id },
        data: { triage, triagedAt: new Date() },
      });
      await progress(1, 1);
      return `${testCase.tcId}: ${triage.summary}`;
    },
  );
}

/** Explain every failure in a run that has not been explained yet. */
export async function startRunTriage(runId: string, user: SessionUser) {
  const pending = await prisma.testRunItem.findMany({
    where: { runId, status: { in: ["FAILED", "ERROR"] }, triagedAt: null },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (pending.length === 0) throw badRequest("Every failure in this run is already explained.");
  const jobs = [];
  for (const item of pending) jobs.push(await startTriage(item.id, user));
  return jobs;
}
