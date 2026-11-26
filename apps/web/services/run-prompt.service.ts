import { timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { open, seal } from "@/lib/secret-box";
import type { RunPromptCreateInput, RunPromptDto } from "@wetestcase/dto";

/**
 * A script asking a person for a value while it runs — `ask("Enter the SMS
 * code")` — for what no environment variable can hold: a one-time code sent
 * to a phone, a captcha. The test process asks and waits; the run page shows
 * an input box; the answer goes back sealed and is dropped once read.
 */

/** The run this token was issued to, while it is running; null otherwise. */
export async function authorizeAsk(runId: string, token: string): Promise<boolean> {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { status: true, askToken: true },
  });
  if (!run?.askToken || run.status !== "RUNNING") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(run.askToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createPrompt(runId: string, input: RunPromptCreateInput) {
  const prompt = await prisma.runPrompt.create({
    data: {
      runId,
      label: input.label,
      question: input.question,
      expiresAt: new Date(Date.now() + (input.timeoutSeconds ?? 180) * 1000),
    },
    select: { id: true },
  });
  return prompt;
}

/**
 * The script checking for its answer. Handed over once: the sealed value is
 * cleared as it is read, so an OTP does not sit in the database.
 */
export async function takeAnswer(
  runId: string,
  promptId: string,
): Promise<{ status: "waiting" | "expired" } | { status: "answered"; answer: string }> {
  const prompt = await prisma.runPrompt.findFirst({
    where: { id: promptId, runId },
    select: { answerSealed: true, answeredAt: true, deliveredAt: true, expiresAt: true },
  });
  if (!prompt) throw notFound("Prompt");
  if (prompt.answeredAt && prompt.answerSealed && !prompt.deliveredAt) {
    const answer = open(prompt.answerSealed);
    const { count } = await prisma.runPrompt.updateMany({
      where: { id: promptId, deliveredAt: null },
      data: { deliveredAt: new Date(), answerSealed: null },
    });
    if (answer !== null && count === 1) return { status: "answered", answer };
  }
  return { status: prompt.expiresAt.getTime() <= Date.now() ? "expired" : "waiting" };
}

/** Questions still waiting for a person, for the run page's input box. */
export async function listOpenPrompts(runId: string): Promise<RunPromptDto[]> {
  const prompts = await prisma.runPrompt.findMany({
    where: { runId, answeredAt: null, expiresAt: { gt: new Date() }, run: { status: "RUNNING" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, question: true, createdAt: true, expiresAt: true },
  });
  return prompts.map((p) => ({
    id: p.id,
    label: p.label,
    question: p.question,
    askedAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
  }));
}

export async function answerPrompt(runId: string, promptId: string, answer: string) {
  const { count } = await prisma.runPrompt.updateMany({
    where: { id: promptId, runId, answeredAt: null, expiresAt: { gt: new Date() }, run: { status: "RUNNING" } },
    data: { answerSealed: seal(answer.trim()), answeredAt: new Date() },
  });
  if (count === 0) {
    throw badRequest("The test is no longer waiting for this — it was answered, timed out, or the run ended.");
  }
}

/** Whether the run is waiting on a person: the runner then lets it run longer. */
export async function isWaitingForAnswer(runId: string): Promise<boolean> {
  const open = await prisma.runPrompt.count({
    where: { runId, deliveredAt: null, expiresAt: { gt: new Date() } },
  });
  return open > 0;
}
