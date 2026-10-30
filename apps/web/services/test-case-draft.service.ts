import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import type {
  DraftReviewInput,
  DraftReviewResult,
  TestCaseDraftDto,
  TestCaseDraftInput,
} from "@wetestcase/dto";

import { resolveProjectPlatform } from "./project.service";

/**
 * AI-written test cases waiting for review.
 *
 * Accepting one is the only way AI output becomes a TestCase, so a person
 * always stands between the model and the test plan.
 */

export async function listPendingDrafts(
  projectId: string,
): Promise<TestCaseDraftDto[]> {
  const drafts = await prisma.testCaseDraft.findMany({
    where: { projectId, status: "PENDING" },
    orderBy: [
      { moduleName: "asc" },
      { subModule: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
  });

  const requirementIds = Array.from(new Set(drafts.flatMap((d) => d.requirementIds)));
  const requirements = await prisma.requirement.findMany({
    where: { id: { in: requirementIds } },
    select: { id: true, code: true, title: true },
  });
  const byId = new Map(requirements.map((req) => [req.id, req]));

  return drafts.map((draft) => ({
    id: draft.id,
    status: draft.status,
    moduleName: draft.moduleName,
    subModule: draft.subModule,
    title: draft.title,
    preconditions: draft.preconditions,
    steps: draft.steps,
    expectedResult: draft.expectedResult,
    testType: draft.testType,
    priority: draft.priority,
    platform: draft.platform,
    requirements: draft.requirementIds.flatMap((id) => {
      const req = byId.get(id);
      return req ? [req] : [];
    }),
    createdAt: draft.createdAt.toISOString(),
  }));
}

export async function updateDraft(draftId: string, input: TestCaseDraftInput) {
  const draft = await prisma.testCaseDraft.findUnique({
    where: { id: draftId },
    select: { status: true, projectId: true },
  });
  if (!draft) throw notFound("Draft");
  if (draft.status !== "PENDING") {
    throw badRequest("This draft has already been reviewed.");
  }

  const platform = await resolveProjectPlatform(draft.projectId, input.platform);

  await prisma.testCaseDraft.update({
    where: { id: draftId },
    data: {
      moduleName: input.moduleName.trim(),
      subModule: input.subModule ?? null,
      title: input.title.trim(),
      preconditions: input.preconditions ?? null,
      steps: input.steps ?? null,
      expectedResult: input.expectedResult ?? null,
      testType: input.testType ?? "FUNCTIONAL",
      priority: input.priority ?? "MEDIUM",
      platform,
    },
  });
}

/** "FR-012" → "FR-012", "3.2.1 Login" → "3.2.1-LOGIN". Safe inside a TC ID. */
function tcIdStem(code: string): string {
  return (
    code
      .toUpperCase()
      .replace(/[^A-Z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "AI"
  );
}

/**
 * The next free "TC-<stem>-NN" in the project.
 *
 * `reserved` holds ids handed out earlier in the same review, which are not
 * in the database yet when several drafts share a requirement.
 */
async function allocateTcId(
  tx: Prisma.TransactionClient,
  projectId: string,
  stem: string,
  reserved: Set<string>,
): Promise<string> {
  const prefix = `TC-${stem}-`;
  const taken = await tx.testCase.findMany({
    where: { projectId, tcId: { startsWith: prefix, mode: "insensitive" } },
    select: { tcId: true },
  });
  // Lower-cased: TC IDs are unique regardless of case.
  const used = new Set(
    [...taken.map((row) => row.tcId), ...reserved].map((id) => id.toLowerCase()),
  );
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}${String(n).padStart(2, "0")}`;
    if (!used.has(candidate.toLowerCase())) {
      reserved.add(candidate);
      return candidate;
    }
  }
}

export async function reviewDrafts(
  projectId: string,
  reviewerId: string,
  input: DraftReviewInput,
): Promise<DraftReviewResult> {
  const drafts = await prisma.testCaseDraft.findMany({
    where: { projectId, id: { in: input.ids }, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  const skipped = input.ids.length - drafts.length;

  if (input.action === "reject") {
    const { count } = await prisma.testCaseDraft.updateMany({
      where: { id: { in: drafts.map((d) => d.id) }, status: "PENDING" },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: reviewerId },
    });
    return { accepted: [], rejected: count, skipped };
  }

  // A platform removed from the project since the draft was written would
  // leave a case the project's own filters cannot show.
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { platforms: true },
  });
  const offPlatform = drafts.filter((d) => !project.platforms.includes(d.platform));
  if (offPlatform.length > 0) {
    throw badRequest(
      `${offPlatform.length} selected draft${offPlatform.length === 1 ? " is" : "s are"} for a platform this project no longer has. Edit ${offPlatform.length === 1 ? "it" : "them"} first.`,
    );
  }

  // One transaction: a review either adds all its cases or none, so a failure
  // halfway never leaves half the drafts accepted and the rest unexplained.
  const accepted = await prisma.$transaction(
    async (tx) => {
      const reserved = new Set<string>();
      const moduleIds = new Map<string, string>();
      const results: DraftReviewResult["accepted"] = [];

      const requirements = await tx.requirement.findMany({
        where: { projectId, id: { in: drafts.flatMap((d) => d.requirementIds) } },
        select: { id: true, code: true },
      });
      const codeById = new Map(requirements.map((req) => [req.id, req.code]));

      for (const draft of drafts) {
        const moduleName = draft.moduleName.trim() || "General";
        let moduleId = moduleIds.get(moduleName);
        if (!moduleId) {
          const found =
            (await tx.module.findUnique({
              where: { projectId_name: { projectId, name: moduleName } },
              select: { id: true },
            })) ??
            (await tx.module.create({
              data: {
                projectId,
                name: moduleName,
                position: await tx.module.count({ where: { projectId } }),
              },
              select: { id: true },
            }));
          moduleId = found.id;
          moduleIds.set(moduleName, moduleId);
        }

        // Requirements deleted since the draft was written are dropped.
        const linkedIds = draft.requirementIds.filter((id) => codeById.has(id));
        const firstCode = linkedIds[0] ? codeById.get(linkedIds[0]) : undefined;
        const tcId = await allocateTcId(
          tx,
          projectId,
          firstCode ? tcIdStem(firstCode) : "AI",
          reserved,
        );

        const testCase = await tx.testCase.create({
          data: {
            projectId,
            moduleId,
            subModule: draft.subModule,
            tcId,
            title: draft.title,
            preconditions: draft.preconditions,
            steps: draft.steps,
            expectedResult: draft.expectedResult,
            testType: draft.testType,
            priority: draft.priority,
            platform: draft.platform,
            requirements: {
              create: linkedIds.map((requirementId) => ({ requirementId })),
            },
          },
          select: { id: true },
        });

        await tx.testCaseDraft.update({
          where: { id: draft.id },
          data: {
            status: "ACCEPTED",
            reviewedAt: new Date(),
            reviewedById: reviewerId,
            testCaseId: testCase.id,
          },
        });
        results.push({ draftId: draft.id, testCaseId: testCase.id, tcId });
      }
      return results;
    },
    // Two hundred drafts is a few hundred small writes.
    { timeout: 60_000 },
  );

  return { accepted, rejected: 0, skipped };
}
