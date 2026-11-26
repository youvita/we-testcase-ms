import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { answerPrompt, authorizeAsk, createPrompt, isWaitingForAnswer, listOpenPrompts, takeAnswer } from "./run-prompt.service";
import { heartbeat } from "./test-run.service";

beforeEach(resetDatabase);

async function runningRun() {
  const { project, owner } = await createProject();
  const run = await prisma.testRun.create({
    data: {
      projectId: project.id,
      environmentName: "SIT",
      createdById: owner.id,
      status: "RUNNING",
      askToken: "token-1",
    },
  });
  return run;
}

describe("a script asking for a value", () => {
  it("waits, shows the question, and hands the answer over once", async () => {
    const run = await runningRun();
    expect(await authorizeAsk(run.id, "token-1")).toBe(true);
    expect(await authorizeAsk(run.id, "token-2")).toBe(false);

    const { id } = await createPrompt(run.id, { label: "TC-LOGIN", question: "Enter the SMS code", timeoutSeconds: 60 });
    expect(await takeAnswer(run.id, id)).toEqual({ status: "waiting" });
    expect(await listOpenPrompts(run.id)).toMatchObject([{ id, label: "TC-LOGIN", question: "Enter the SMS code" }]);
    expect(await heartbeat(run.id)).toMatchObject({ waitingForAnswer: true });

    await answerPrompt(run.id, id, " 123456 ");
    expect(await listOpenPrompts(run.id)).toEqual([]);
    // Sealed at rest, not the code itself.
    const stored = await prisma.runPrompt.findUniqueOrThrow({ where: { id } });
    expect(stored.answerSealed).not.toContain("123456");

    expect(await takeAnswer(run.id, id)).toEqual({ status: "answered", answer: "123456" });
    // Read once, then dropped.
    expect((await prisma.runPrompt.findUniqueOrThrow({ where: { id } })).answerSealed).toBeNull();
    expect(await isWaitingForAnswer(run.id)).toBe(false);
    await expect(answerPrompt(run.id, id, "999999")).rejects.toThrow(/no longer waiting/);
  });

  it("times out, and takes no answer once the run has ended", async () => {
    const run = await runningRun();
    const { id } = await createPrompt(run.id, { label: "TC-LOGIN", question: "Code?", timeoutSeconds: 60 });
    await prisma.runPrompt.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await takeAnswer(run.id, id)).toEqual({ status: "expired" });
    expect(await listOpenPrompts(run.id)).toEqual([]);

    const other = await createPrompt(run.id, { label: "TC-LOGIN", question: "Code?", timeoutSeconds: 60 });
    await prisma.testRun.update({ where: { id: run.id }, data: { status: "PASSED" } });
    expect(await authorizeAsk(run.id, "token-1")).toBe(false);
    await expect(answerPrompt(run.id, other.id, "1")).rejects.toThrow(/no longer waiting/);
  });
});
