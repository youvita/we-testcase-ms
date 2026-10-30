import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { AiError, askClaude, parseJsonBlock } from "@/lib/claude";
import { PLATFORM_LABELS, PRIORITY_LABELS, TEST_TYPE_LABELS } from "@/lib/constants";
import type { SessionUser } from "@/lib/session";
import type { AiJobDto, AiModel } from "@wetestcase/dto";

import { defineJob, enqueueJob } from "./ai-job.service";

/**
 * An FRD written from a test case that has none — a case written by hand,
 * or suggested by exploring the app. Saved to Requirements → Documents with
 * one requirement the case is linked to, so the case's FRD button downloads
 * it from then on.
 */

type CaseForFrd = Awaited<ReturnType<typeof loadCase>>;

type FrdRequirement = {
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  openQuestions: string | null;
};

async function loadCase(testCaseId: string) {
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
      testType: true,
      priority: true,
      platform: true,
      subModule: true,
      module: { select: { name: true } },
      project: { select: { name: true } },
      _count: { select: { requirements: true } },
    },
  });
  if (!testCase) throw notFound("Test case");
  if (testCase._count.requirements > 0) {
    throw badRequest("This test case already has an FRD — download it with the FRD button.");
  }
  return testCase;
}

const groupOf = (tc: CaseForFrd) => (tc.subModule ? `${tc.module.name} › ${tc.subModule}` : tc.module.name);

/** What the case leaves for the PO to confirm: its "(confirm with PO)" lines. */
function openQuestionsOf(tc: CaseForFrd): string | null {
  const lines = [tc.preconditions, tc.steps, tc.expectedResult]
    .flatMap((text) => (text ?? "").split(/\n|(?<=\.)\s+/))
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ""))
    .filter((line) => /confirm with (the )?po/i.test(line));
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : null;
}

/** The case laid out as an FRD, without the AI. */
function quickFrd(tc: CaseForFrd): { markdown: string; requirement: FrdRequirement } {
  const code = `FR-${tc.tcId}`;
  const openQuestions = openQuestionsOf(tc);
  const section = (heading: string, body: string | null) =>
    body?.trim() ? `#### ${heading}\n\n${body.trim()}\n\n` : "";
  const markdown = `# FRD — ${tc.title}

_Generated from test case ${tc.tcId} in ${tc.project.name}. It describes what the test case checks; confirm it with the PO before treating it as the specification._

## 1. Overview

- **Feature:** ${groupOf(tc)}
- **Platform:** ${PLATFORM_LABELS[tc.platform]}
- **Priority:** ${PRIORITY_LABELS[tc.priority]}
- **Kind of check:** ${TEST_TYPE_LABELS[tc.testType]}

## 2. Functional requirements

### ${code} ${tc.title}

${section("Preconditions", tc.preconditions)}${section("Behaviour", tc.steps)}${section("Acceptance criteria", tc.expectedResult)}## 3. Open questions

${openQuestions ?? "None noted in the test case."}
`;
  return {
    markdown,
    requirement: {
      title: tc.title,
      description: tc.steps,
      acceptanceCriteria: tc.expectedResult,
      openQuestions,
    },
  };
}

const FRD_SYSTEM = `You are a senior business analyst. You write a Functional Requirements Document (FRD) for one feature, working backwards from a black-box test case: the case shows what the system must do; your FRD states it as requirements.

Rules:
- State only what the test case shows or clearly implies. Where you fill a gap — a rule, a field, a message — mark it "(assumption — confirm with PO)".
- Write in English, whatever language the case is in.
- Use Markdown with these sections: # FRD — <feature>; ## 1. Purpose; ## 2. Scope; ## 3. Functional requirements (each as "### FR-<n> <name>" with Description, Business rules, Fields and validations where relevant, Messages, Acceptance criteria); ## 4. Open questions.

Answer with the FRD between <frd> and </frd>, then a \`\`\`json block summarising the main requirement:
{"title": "", "description": "", "acceptanceCriteria": "", "openQuestions": ""}`;

function frdPrompt(tc: CaseForFrd): string {
  return `Project: ${tc.project.name}
Feature: ${groupOf(tc)} (${PLATFORM_LABELS[tc.platform]})

Test case ${tc.tcId} — ${tc.title}
Type: ${TEST_TYPE_LABELS[tc.testType]} · Priority: ${PRIORITY_LABELS[tc.priority]}
Preconditions:
${tc.preconditions ?? "(none)"}
Steps:
${tc.steps ?? "(none)"}
Expected result:
${tc.expectedResult ?? "(none)"}

Write the FRD for what this case tests.`;
}

const requirementSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().nullish().transform((v) => v || null),
    acceptanceCriteria: z.string().trim().nullish().transform((v) => v || null),
    openQuestions: z.string().trim().nullish().transform((v) => v || null),
  })
  .nullable()
  .catch(null);

function readAiFrd(reply: string, tc: CaseForFrd) {
  const markdown = /<frd>([\s\S]*?)<\/frd>/i.exec(reply)?.[1]?.trim();
  if (!markdown) throw new AiError("The AI's answer did not contain an FRD.");
  const requirement = requirementSchema.parse(parseJsonBlock(reply)) ?? {
    title: tc.title,
    description: tc.steps,
    acceptanceCriteria: tc.expectedResult,
    openQuestions: null,
  };
  return { markdown, requirement };
}

/** Save it as the case's FRD: a document with one requirement, linked. */
async function saveFrd(
  tc: CaseForFrd,
  userId: string,
  frd: { markdown: string; requirement: FrdRequirement },
  how: "quick" | "ai",
) {
  return prisma.$transaction(async (tx) => {
    // Another tab may have made one meanwhile.
    const linked = await tx.testCaseRequirement.count({ where: { testCaseId: tc.id } });
    if (linked > 0) throw badRequest("This test case already has an FRD.");
    const doc = await tx.requirementDoc.create({
      data: {
        projectId: tc.projectId,
        createdById: userId,
        kind: "FRD",
        title: `FRD — ${tc.tcId} ${tc.title}`.slice(0, 200),
        fileName: null,
        content: frd.markdown,
        charCount: frd.markdown.length,
      },
    });
    await tx.requirement.create({
      data: {
        docId: doc.id,
        projectId: tc.projectId,
        code: `FR-${tc.tcId}`,
        title: frd.requirement.title,
        description: frd.requirement.description,
        acceptanceCriteria: frd.requirement.acceptanceCriteria,
        openQuestions: frd.requirement.openQuestions,
        section: how === "ai" ? "Written by AI from the test case" : "From the test case",
        testCases: { create: { testCaseId: tc.id } },
      },
    });
    return doc;
  });
}

/**
 * Make the case's FRD. Quick returns once it is saved; the AI's runs in the
 * background, and the job is returned to follow.
 */
export async function generateCaseFrd(
  testCaseId: string,
  user: SessionUser,
  input: { method: "ai" | "quick"; model?: AiModel },
): Promise<{ saved: true } | { job: AiJobDto }> {
  const tc = await loadCase(testCaseId);
  if (input.method === "quick") {
    await saveFrd(tc, user.id, quickFrd(tc), "quick");
    return { saved: true };
  }

  const job = await enqueueJob({
    projectId: tc.projectId,
    kind: "GENERATE_FRD",
    userId: user.id,
    input: { testCaseId, ...input },
  });
  return { job };
}

defineJob("GENERATE_FRD", async (job) => {
  const input = job.input as { testCaseId: string; model?: AiModel };
  const tc = await loadCase(input.testCaseId);
  return async ({ token, progress }) => {
    await progress(0, 1);
    const reply = await askClaude({ token, model: input.model, system: FRD_SYSTEM, prompt: frdPrompt(tc) });
    await saveFrd(tc, job.createdById, readAiFrd(reply, tc), "ai");
    await progress(1, 1);
    return `Wrote the FRD for ${tc.tcId}`;
  };
});
