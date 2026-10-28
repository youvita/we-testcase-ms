import type { RequirementDocKind } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { conflict, notFound } from "@/lib/api";
import type {
  RequirementDocDto,
  RequirementDto,
  RequirementInput,
} from "@wetestcase/dto";

import { assertProjectExists } from "./project.service";

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function createRequirementDoc(
  projectId: string,
  userId: string,
  input: {
    title: string;
    kind: RequirementDocKind;
    fileName: string | null;
    content: string;
  },
) {
  await assertProjectExists(projectId);
  return prisma.requirementDoc.create({
    data: {
      projectId,
      createdById: userId,
      title: input.title.trim(),
      kind: input.kind,
      fileName: input.fileName,
      content: input.content,
      charCount: input.content.length,
    },
    select: { id: true },
  });
}

export async function listRequirementDocs(
  projectId: string,
): Promise<RequirementDocDto[]> {
  const docs = await prisma.requirementDoc.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      fileName: true,
      charCount: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { requirements: true } },
    },
  });
  return docs.map(({ _count, createdAt, ...doc }) => ({
    ...doc,
    createdAt: createdAt.toISOString(),
    requirementCount: _count.requirements,
  }));
}

export async function getRequirementDoc(docId: string) {
  const doc = await prisma.requirementDoc.findUnique({
    where: { id: docId },
    select: {
      id: true,
      projectId: true,
      title: true,
      kind: true,
      fileName: true,
      content: true,
    },
  });
  if (!doc) throw notFound("Document");
  return doc;
}

/** Its requirements go with it, and so do their links to test cases. The cases stay. */
export async function deleteRequirementDoc(docId: string) {
  await prisma.requirementDoc.delete({ where: { id: docId } });
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export async function listRequirements(
  projectId: string,
): Promise<RequirementDto[]> {
  const [rows, pendingDrafts] = await Promise.all([
    prisma.requirement.findMany({
      where: { projectId },
      // Documents in upload order, then each document's own order.
      orderBy: [{ doc: { createdAt: "asc" } }, { position: "asc" }],
      include: {
        doc: { select: { title: true } },
        testCases: {
          select: {
            testCase: { select: { id: true, tcId: true, status: true } },
          },
          orderBy: { testCase: { tcId: "asc" } },
        },
      },
    }),
    prisma.testCaseDraft.findMany({
      where: { projectId, status: "PENDING" },
      select: { requirementIds: true },
    }),
  ]);

  const pendingByRequirement = new Map<string, number>();
  for (const draft of pendingDrafts) {
    for (const id of draft.requirementIds) {
      pendingByRequirement.set(id, (pendingByRequirement.get(id) ?? 0) + 1);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    acceptanceCriteria: row.acceptanceCriteria,
    openQuestions: row.openQuestions,
    section: row.section,
    docId: row.docId,
    docTitle: row.doc.title,
    testCases: row.testCases.map((link) => link.testCase),
    pendingDraftCount: pendingByRequirement.get(row.id) ?? 0,
  }));
}

async function assertCodeFree(docId: string, code: string, exceptId?: string) {
  const clash = await prisma.requirement.findFirst({
    where: { docId, code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`"${code}" is already used in this document`);
}

export async function createRequirement(
  projectId: string,
  docId: string,
  input: RequirementInput,
) {
  const doc = await prisma.requirementDoc.findFirst({
    where: { id: docId, projectId },
    select: { id: true },
  });
  if (!doc) throw notFound("Document");

  const code = input.code.trim();
  await assertCodeFree(docId, code);
  const position = await prisma.requirement.count({ where: { docId } });

  return prisma.requirement.create({
    data: {
      projectId,
      docId,
      code,
      title: input.title.trim(),
      description: input.description ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      openQuestions: input.openQuestions ?? null,
      section: input.section ?? null,
      position,
    },
  });
}

export async function updateRequirement(
  requirementId: string,
  input: RequirementInput,
) {
  const existing = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: { docId: true },
  });
  if (!existing) throw notFound("Requirement");

  const code = input.code.trim();
  await assertCodeFree(existing.docId, code, requirementId);

  return prisma.requirement.update({
    where: { id: requirementId },
    data: {
      code,
      title: input.title.trim(),
      description: input.description ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      openQuestions: input.openQuestions ?? null,
      section: input.section ?? null,
    },
  });
}

export async function deleteRequirement(requirementId: string) {
  await prisma.requirement.delete({ where: { id: requirementId } });
}

export type ExtractedRequirement = {
  code: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  openQuestions?: string;
  section?: string;
};

/**
 * Save what extraction found, keyed by code within the document.
 *
 * A code already present is updated in place rather than replaced, so a
 * re-extraction after the PRD changes keeps every link to existing test cases.
 * Requirements the new pass did not mention are left alone — a missed item is
 * likelier than a removed one, and QA can delete it by hand.
 */
export async function upsertExtractedRequirements(
  docId: string,
  projectId: string,
  items: ExtractedRequirement[],
  startPosition: number,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const [index, item] of items.entries()) {
    const data = {
      title: item.title,
      description: item.description ?? null,
      acceptanceCriteria: item.acceptanceCriteria ?? null,
      openQuestions: item.openQuestions ?? null,
      section: item.section ?? null,
      position: startPosition + index,
    };
    const existing = await prisma.requirement.findUnique({
      where: { docId_code: { docId, code: item.code } },
      select: { id: true },
    });
    if (existing) {
      await prisma.requirement.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.requirement.create({
        data: { ...data, docId, projectId, code: item.code },
      });
      created += 1;
    }
  }

  return { created, updated };
}
