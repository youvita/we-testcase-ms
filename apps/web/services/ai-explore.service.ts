import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { badRequest, HttpError, notFound } from "@/lib/api";
import { AiError, askClaude, parseJsonReply, type ClaudeImage } from "@/lib/claude";
import { isAutomationConfigured } from "@/lib/runner-auth";
import type { SessionUser } from "@/lib/session";
import {
  PRIORITIES,
  TEST_TYPES,
  type AiJobDto,
  type ExploreAppResult,
  type GenerationDepth,
} from "@wetestcase/dto";

import { enqueueJob } from "./ai-job.service";
import {
  draftReplySchema,
  moduleOutline,
  parseItems,
  SUB_MODULE_RULE,
} from "./ai-requirements.service";
import { getEnvironmentOutline } from "./run-environment.service";
import { queueRun, readItemPages, waitForRun } from "./test-run.service";

/**
 * Suggest test cases by looking at the application itself — black-box, no
 * document needed.
 *
 * The runner opens each page in a real browser (after an optional sign-in,
 * borrowed from an automated case's script) and captures its outline and a
 * screenshot, as a script check that records nothing. Claude studies the
 * pages next to the project's existing cases and suggests what is missing.
 * The suggestions are drafts: QA accepts them in Review drafts.
 */

const MAX_PAGES = 5;
const OUTLINE_CHARS = 20_000;

/**
 * The script the runner executes: sign in (if asked), then visit each page
 * and attach its outline and screenshot under the names the runner uploads.
 * `test` is the spec's own, so `test.info()` reaches this test's attachments.
 */
function explorationScript(paths: string[], setupCode: string | null) {
  const visits = paths.map((p) => `await visit(${JSON.stringify(p)});`).join("\n");
  return `${setupCode ? `// Sign in first, with the chosen case's own script\n${setupCode}\n\n` : ""}// Look at each page: its outline (fields, buttons, text) and a screenshot
const visit = async (path) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const outline = await page.locator("body").ariaSnapshot({ timeout: 10000 });
  await test.info().attach("page-snapshot", {
    body: "URL: " + page.url() + "\\nTitle: " + (await page.title()) + "\\n\\n" + outline.slice(0, 60000),
    contentType: "text/plain",
  });
  await test.info().attach("screenshot", { body: await page.screenshot(), contentType: "image/png" });
};
${visits}`;
}

const EXPLORE_SYSTEM = `You are a senior QA analyst doing black-box test design on a live web application. You see the pages themselves — their outline (every field, button, link and text, from Playwright's aria snapshot) and screenshots — not source code or specifications.

Suggest the test cases a careful tester would write for what is on these pages:
- the main positive flows,
- negative and validation cases: empty, too long, wrong format, wrong credentials,
- boundaries the fields imply,
- states and messages the page shows or should show,
- links and navigation that must work.

Rules:
- Base every case on something actually visible. Never invent features the pages do not show.
- When an expected result depends on behaviour you cannot see (an exact error message, a rule), describe what to check and end it with "(confirm with PO)".
- Do not repeat cases the project already has.
- Use test accounts through variable names, never real data.
- Write in English, whatever language the application is in.
- ${SUB_MODULE_RULE}

testType is one of ${TEST_TYPES.join(", ")}; priority is one of ${PRIORITIES.join(", ")}.

Answer with JSON only, in exactly this shape:
{"testCases":[{"module":"","subModule":"","title":"","preconditions":"","steps":[""],"expectedResult":"","testType":"FUNCTIONAL","priority":"MEDIUM"}],"observations":[""]}
"observations" are short notes on things a tester should know that are not test cases — e.g. a field without a label, a broken-looking element, text that seems wrong. Leave it empty if there is nothing.`;

/** "Customers › Create", or the module alone. */
function groupName(module: string, subModule: string | null) {
  return subModule ? `${module} › ${subModule}` : module;
}

const DEPTH_GUIDE: Record<GenerationDepth, string> = {
  essential: "About 4–8 cases per page: the main flows and the most important negative cases.",
  thorough: "As many cases as the page warrants: every field's validation, boundaries, states and navigation.",
};

const observationsSchema = z.array(z.string().trim().min(1)).catch([]);

export async function startExploration(
  projectId: string,
  user: SessionUser,
  input: {
    environmentId: string;
    paths: string[];
    setupTestCaseId?: string;
    depth: GenerationDepth;
    instructions?: string;
  },
): Promise<AiJobDto> {
  if (!isAutomationConfigured()) {
    throw new HttpError(503, "Automation is not set up on this server (RUNNER_TOKEN), so the app cannot be opened.");
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, platforms: true },
  });
  if (!project) throw notFound("Project");
  if (!project.platforms.includes("WEB")) {
    throw badRequest("Exploring opens web pages; add Web to this project's platforms first.");
  }

  const env = await getEnvironmentOutline(input.environmentId, projectId);
  if (!env.webBaseUrl) throw badRequest(`${env.name} has no Web base URL. Add it in Environments.`);

  let setup: { tcId: string; code: string } | null = null;
  if (input.setupTestCaseId) {
    const found = await prisma.testCase.findFirst({
      where: { id: input.setupTestCaseId, projectId, platform: "WEB" },
      select: { id: true, tcId: true, script: { select: { code: true } } },
    });
    if (!found?.script) throw badRequest("The sign-in case needs a Web automation script.");
    setup = { tcId: found.tcId, code: found.script.code };
  }

  const paths = input.paths.slice(0, MAX_PAGES);

  return enqueueJob(
    {
      projectId,
      kind: "EXPLORE_APP",
      userId: user.id,
      input: { ...input, paths },
    },
    async ({ jobId, token, progress, setResult }) => {
      await progress(0, 2);
      const result: ExploreAppResult = { pages: [], drafted: 0, observations: [], runId: null };

      // 1. Look at the pages.
      const queued = await queueRun({
        projectId,
        userId: user.id,
        environment: env,
        purpose: "SCRIPT_CHECK",
        recordResults: false,
        // No test case: exploring comes before there are any.
        items: [{ testCaseId: null, code: explorationScript(paths, setup?.code ?? null) }],
      });
      result.runId = queued.id;
      await setResult(result);

      const run = await waitForRun(queued.id);
      const item = run.items[0];
      // Only a visit that got through every page counts: when one fails, the
      // last outline the runner took is of whatever error page was left.
      const pages =
        item?.status === "PASSED" ? await readItemPages(item.id, paths.length) : [];
      if (pages.length === 0) {
        const reason = item?.error?.split("\n")[0] ?? run.error ?? "the pages did not load";
        throw new AiError(
          setup
            ? `Could not sign in with ${setup.tcId} or open the pages: ${reason}`
            : `Could not open the pages on ${env.name}: ${reason}`,
        );
      }
      result.pages = pages.map((p) => ({ url: p.url, title: p.title }));
      await setResult(result);
      await progress(1, 2);

      // 2. Ask Claude what to test.
      const [modules, current, pending] = await Promise.all([
        moduleOutline(projectId),
        prisma.testCase.findMany({
          where: { projectId },
          orderBy: { tcId: "asc" },
          take: 300,
          select: { title: true, subModule: true, module: { select: { name: true } } },
        }),
        // Suggestions still waiting for review count too — exploring the same
        // page twice before reviewing must not suggest everything again.
        prisma.testCaseDraft.findMany({
          where: { projectId, status: "PENDING" },
          take: 200,
          select: { title: true, moduleName: true, subModule: true },
        }),
      ]);
      const existing = [
        ...current.map((c) => `- [${groupName(c.module.name, c.subModule)}] ${c.title}`),
        ...pending.map(
          (d) => `- [${groupName(d.moduleName, d.subModule)}] ${d.title} (suggested, awaiting review)`,
        ),
      ];

      const images: ClaudeImage[] = pages.flatMap((p) => (p.screenshot ? [p.screenshot] : []));
      const prompt = `Project: ${project.name}
Environment: ${env.name} (${env.webBaseUrl})
${setup ? `Signed in first, using the script of ${setup.tcId}.\n` : ""}Variables available for test data: ${env.variables.map((v) => `vars.${v.key}`).join(", ") || "none"}
Existing modules (reuse a name when one fits): ${modules}
How many cases: ${DEPTH_GUIDE[input.depth]}
${input.instructions ? `Instructions from QA: ${input.instructions}\n` : ""}
Test cases the project already has or has been suggested (do not repeat these):
${existing.length ? existing.join("\n") : "(none)"}

The pages, in the order visited — screenshots are attached in the same order:

${pages
  .map(
    (p, index) => `### Page ${index + 1}: ${p.title || "(no title)"} — ${p.url}
\`\`\`yaml
${p.outline.replace(/^URL: .*\nTitle: .*\n\n/, "").slice(0, OUTLINE_CHARS)}
\`\`\``,
  )
  .join("\n\n")}`;

      const reply = await askClaude({ token, system: EXPLORE_SYSTEM, images, prompt });
      const cases = parseItems(reply, "testCases", draftReplySchema);
      const json = parseJsonReply(reply) as { observations?: unknown };
      result.observations = observationsSchema.parse(json.observations);

      await prisma.testCaseDraft.createMany({
        data: cases.map((c) => ({
          projectId,
          jobId,
          moduleName: c.module,
          subModule: c.subModule,
          title: c.title,
          preconditions: c.preconditions ?? null,
          steps: c.steps ?? null,
          expectedResult: c.expectedResult ?? null,
          testType: c.testType,
          priority: c.priority,
          platform: "WEB" as const,
          requirementIds: [],
        })),
      });
      result.drafted = cases.length;
      await setResult(result);
      await progress(2, 2);

      if (cases.length === 0) {
        throw new AiError("Claude did not suggest any new test cases for these pages.");
      }
      return `Suggested ${cases.length} test case${cases.length === 1 ? "" : "s"} from ${pages.length} page${pages.length === 1 ? "" : "s"} — review them before they are added`;
    },
  );
}
