import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { AiError, askClaude, parseJsonBlock } from "@/lib/claude";
import { isAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { caseQuestions, splitOpenQuestions } from "@/utils/open-questions";
import type { AiJobDto, CaseUpdateSuggestion, SuggestCaseUpdateInput } from "@wetestcase/dto";

import { defineJob, enqueueJob } from "./ai-job.service";

/**
 * After the PO answers a question about a test case, the AI suggests how
 * the case's text should change. It only suggests: QA reviews the
 * suggestion in the apply dialog and saves it, edits it, or drops it —
 * an answer can be short or ambiguous, and the case is what testers,
 * reports and scripts trust.
 *
 * The question is one in the case's discussion, or one asked on a
 * requirement the case verifies.
 */

type Source = SuggestCaseUpdateInput["source"];

type Message = { author: string; fromPo: boolean; body: string };

/** The case, the question with everything said under it, and the requirements it verifies. */
async function loadContext(testCaseId: string, source: Source) {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      id: true,
      projectId: true,
      tcId: true,
      title: true,
      subModule: true,
      preconditions: true,
      steps: true,
      expectedResult: true,
      openQuestions: true,
      module: { select: { name: true } },
      requirements: {
        select: {
          requirement: {
            select: {
              id: true,
              code: true,
              title: true,
              description: true,
              acceptanceCriteria: true,
              openQuestions: true,
            },
          },
        },
      },
    },
  });
  if (!testCase) throw notFound("Test case");

  let question: Message;
  let thread: Message[];
  if (source.kind === "comment") {
    const comment = await prisma.comment.findUnique({
      where: { id: source.questionId },
      select: {
        testCaseId: true,
        kind: true,
        deletedAt: true,
        body: true,
        author: { select: { name: true, role: true } },
        answers: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { body: true, kind: true, author: { select: { name: true, role: true } } },
        },
      },
    });
    if (!comment || comment.testCaseId !== testCaseId || comment.kind !== "QUESTION" || comment.deletedAt) {
      throw notFound("Question");
    }
    question = { author: comment.author.name, fromPo: false, body: comment.body };
    thread = comment.answers.map((reply) => ({
      author: reply.author.name,
      fromPo: reply.kind === "ANSWER" || isAdmin(reply.author.role),
      body: reply.body,
    }));
  } else {
    const asked = await prisma.poQuestion.findUnique({
      where: { id: source.questionId },
      select: {
        requirementId: true,
        body: true,
        asker: { select: { name: true } },
        replies: {
          orderBy: { createdAt: "asc" },
          select: { body: true, author: { select: { name: true, role: true } } },
        },
      },
    });
    const linked = testCase.requirements.some((link) => link.requirement.id === asked?.requirementId);
    if (!asked || !linked) throw notFound("Question");
    question = { author: asked.asker.name, fromPo: false, body: asked.body };
    thread = asked.replies.map((reply) => ({
      author: reply.author.name,
      fromPo: isAdmin(reply.author.role),
      body: reply.body,
    }));
  }
  if (!thread.some((message) => message.fromPo)) {
    throw badRequest("The PO has not answered this question yet.");
  }
  return { testCase, question, thread };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

export async function startCaseUpdateSuggestion(
  testCaseId: string,
  input: SuggestCaseUpdateInput,
  user: SessionUser,
): Promise<AiJobDto> {
  const { testCase } = await loadContext(testCaseId, input.source);
  return enqueueJob({
    projectId: testCase.projectId,
    kind: "SUGGEST_CASE_UPDATE",
    userId: user.id,
    input: { testCaseId, source: input.source, model: input.model ?? null },
  });
}

const SYSTEM = `You are a senior QA engineer keeping a manual test case in line with what the product owner (PO) has just confirmed.

You get the test case, the question that was asked about it, the conversation under it (the PO's answers and QA's follow-ups), and the requirements the case verifies. Rewrite the case's text so it tests what the PO confirmed.

Rules:
- Change only what the answer affects. Keep everything else word for word, in the same style and format (numbered steps stay numbered).
- Use the PO's exact values: messages, limits, formats, rules.
- Remove from the open questions each question this conversation settles; keep the ones it does not.
- "Not defined", "no rule", "any value is fine" or "not in scope" settle a question too: the PO has decided there is no rule. Remove the question, and where it helps the tester, state the decision in the case (e.g. "No format or length rule applies to the Biller ID (confirmed by the PO).").
- A question stays open only when the PO has not decided yet ("to be confirmed", "we will check") or did not answer it.
- Do not invent behaviour the PO did not confirm. If the answer is unclear, leave the text as it is, keep the question open, and say so in the summary.
- A case checks one behaviour. If the answer adds behaviour this case cannot cover (a new state, a new rule), do not cram it in: describe it in newCaseIdea as a test case to add.
- Write in the language the case is written in.

Answer with only a \`\`\`json block:
{"preconditions": "", "steps": "", "expectedResult": "", "openQuestions": "", "summary": "", "newCaseIdea": null}
Give every field's full text, changed or not; "" for an empty field. summary is one sentence on what changed and why. newCaseIdea is null or one sentence.`;

function prompt({ testCase, question, thread }: Context): string {
  const text = splitOpenQuestions(testCase);
  const group = testCase.subModule ? `${testCase.module.name} › ${testCase.subModule}` : testCase.module.name;
  const requirements = testCase.requirements
    .map(({ requirement: r }) =>
      [
        `${r.code} — ${r.title}`,
        r.description && `Description:\n${r.description}`,
        r.acceptanceCriteria && `Acceptance criteria:\n${r.acceptanceCriteria}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  const conversation = thread
    .map((message) => `${message.fromPo ? "PO" : "QA"} (${message.author}): ${message.body}`)
    .join("\n\n");

  return `Test case ${testCase.tcId} — ${testCase.title}
Feature: ${group}

Preconditions:
${text.preconditions || "(none)"}

Steps:
${text.steps || "(none)"}

Expected result:
${text.expectedResult || "(none)"}

Open questions${testCase.requirements.length ? " (kept on its requirements, shared with their other cases)" : ""}:
${caseQuestions(text.openQuestions, testCase.requirements.map(({ requirement }) => requirement)).text || "(none)"}
${requirements ? `\nRequirements this case verifies:\n${requirements}\n` : ""}
Question asked by ${question.author}:
${question.body}

Conversation since:
${conversation}

Rewrite the test case to match what the PO confirmed.`;
}

const text = z
  .string()
  .nullish()
  .transform((v) => (v ?? "").trim());

const suggestionSchema = z.object({
  preconditions: text,
  steps: text,
  expectedResult: text,
  openQuestions: text,
  summary: text,
  newCaseIdea: z
    .string()
    .nullish()
    .transform((v) => v?.trim() || null),
});

/** Read the AI's answer into a suggestion. Exported for tests. */
export function readSuggestion(reply: string): CaseUpdateSuggestion {
  const parsed = suggestionSchema.safeParse(parseJsonBlock(reply));
  if (!parsed.success) throw new AiError("The AI's answer did not contain a readable update.");
  return parsed.data;
}

defineJob("SUGGEST_CASE_UPDATE", async (job) => {
  const input = job.input as { testCaseId: string; source: Source; model?: string | null };
  const context = await loadContext(input.testCaseId, input.source);
  return async ({ token, progress, setResult, throwIfCancelled, signal }) => {
    await progress(0, 1);
    const reply = await askClaude({
      token,
      signal,
      system: SYSTEM,
      prompt: prompt(context),
      ...(input.model ? { model: input.model } : {}),
    });
    const suggestion = readSuggestion(reply);
    throwIfCancelled();
    await setResult(suggestion);
    await progress(1, 1);
    return `${context.testCase.tcId}: ${suggestion.summary || "update suggested"}`;
  };
});
