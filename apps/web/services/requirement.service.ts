import {
  Prisma,
  type RequirementChange,
  type RequirementDocKind,
  type RequirementStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/api";
import type {
  RequirementDocDto,
  RequirementDto,
  RequirementInput,
  RequirementReviewInput,
  RequirementSnapshot,
} from "@wetestcase/dto";
import { findMatch, sameRequirementText } from "@/utils/requirement-match";

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
      version: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
      _count: { select: { requirements: { where: { status: "ACTIVE" } } } },
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

/**
 * Replace a document's text with a newer version. The current text is
 * archived first; reading the new text (a separate job) then compares its
 * requirements with the ones the project has.
 */
export async function addRequirementDocVersion(
  docId: string,
  userId: string,
  input: { fileName: string | null; content: string },
) {
  const doc = await prisma.requirementDoc.findUnique({
    where: { id: docId },
    select: { id: true, version: true, fileName: true, content: true, charCount: true },
  });
  if (!doc) throw notFound("Document");
  if (doc.content === input.content) {
    throw badRequest("This text is the same as the current version");
  }

  const [, updated] = await prisma.$transaction([
    prisma.requirementDocVersion.create({
      data: {
        docId,
        version: doc.version,
        fileName: doc.fileName,
        content: doc.content,
        charCount: doc.charCount,
        replacedById: userId,
      },
    }),
    prisma.requirementDoc.update({
      where: { id: docId },
      data: {
        version: { increment: 1 },
        content: input.content,
        charCount: input.content.length,
        fileName: input.fileName,
      },
      select: { id: true, version: true },
    }),
  ]);
  return updated;
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
        doc: { select: { title: true, version: true } },
        possibleMatch: { select: { id: true, code: true, title: true } },
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

  return rows.map((row) => {
    // Only what the current version did counts; an older version's change has
    // been read past.
    const change = row.changedInVersion === row.doc.version ? row.change : null;
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      acceptanceCriteria: row.acceptanceCriteria,
      openQuestions: row.openQuestions,
      section: row.section,
      docId: row.docId,
      docTitle: row.doc.title,
      status: row.status,
      change,
      previous: change === "CHANGED" ? (row.previous as RequirementSnapshot | null) : null,
      possibleMatch: row.possibleMatch,
      testCases: row.testCases.map((link) => link.testCase),
      pendingDraftCount: pendingByRequirement.get(row.id) ?? 0,
    };
  });
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

/**
 * QA settling what the latest reading did to a requirement.
 *
 * - keep: one the reading did not find stays in force.
 * - remove / restore: confirm it gone from the document, or bring it back.
 * - merge: this new requirement is the earlier one under a new code. The
 *   earlier row takes this one's code and text, so its id, its links to test
 *   cases and any drafts that cite it carry on; this row goes.
 * - notSame: the possible match is a different requirement.
 */
export async function reviewRequirement(
  requirementId: string,
  action: RequirementReviewInput["action"],
) {
  const row = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      ...SNAPSHOT_SELECT,
      id: true,
      openQuestions: true,
      position: true,
      changedInVersion: true,
      possibleMatchId: true,
    },
  });
  if (!row) throw notFound("Requirement");

  switch (action) {
    case "keep":
      await prisma.requirement.update({
        where: { id: row.id },
        data: { status: "ACTIVE", change: "UNCHANGED" },
      });
      return;
    case "remove":
      await prisma.requirement.update({
        where: { id: row.id },
        data: { status: "REMOVED", possibleMatchId: null },
      });
      return;
    case "restore":
      await prisma.requirement.update({
        where: { id: row.id },
        data: { status: "ACTIVE" },
      });
      return;
    case "notSame":
      await prisma.requirement.update({
        where: { id: row.id },
        data: { possibleMatchId: null },
      });
      return;
    case "merge": {
      if (!row.possibleMatchId) throw badRequest("There is nothing to merge this requirement with");
      const earlier = await prisma.requirement.findUnique({
        where: { id: row.possibleMatchId },
        select: { ...SNAPSHOT_SELECT, id: true },
      });
      if (!earlier) throw notFound("Requirement");
      await prisma.$transaction(async (tx) => {
        const links = await tx.testCaseRequirement.findMany({
          where: { requirementId: row.id },
          select: { testCaseId: true },
        });
        // Delete first: the earlier row is about to take this one's code.
        await tx.requirement.delete({ where: { id: row.id } });
        if (links.length) {
          await tx.testCaseRequirement.createMany({
            data: links.map((link) => ({ testCaseId: link.testCaseId, requirementId: earlier.id })),
            skipDuplicates: true,
          });
        }
        await tx.requirement.update({
          where: { id: earlier.id },
          data: {
            ...textOf(row),
            openQuestions: row.openQuestions,
            position: row.position,
            status: "ACTIVE",
            change: sameRequirementText(earlier, row) && earlier.code === row.code ? "UNCHANGED" : "CHANGED",
            changedInVersion: row.changedInVersion,
            previous: snapshotOf(earlier),
          },
        });
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Reading a document into requirements
// ---------------------------------------------------------------------------

export type ExtractedRequirement = {
  code: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  openQuestions?: string;
  section?: string;
};

const SNAPSHOT_SELECT = {
  code: true,
  title: true,
  section: true,
  description: true,
  acceptanceCriteria: true,
} as const;

function snapshotOf(row: RequirementSnapshot): Prisma.InputJsonObject {
  return {
    code: row.code,
    title: row.title,
    section: row.section,
    description: row.description,
    acceptanceCriteria: row.acceptanceCriteria,
  };
}

function textOf(item: RequirementSnapshot) {
  return {
    code: item.code,
    title: item.title,
    section: item.section,
    description: item.description,
    acceptanceCriteria: item.acceptanceCriteria,
  };
}

type KnownRequirement = RequirementSnapshot & {
  id: string;
  status: RequirementStatus;
  change: RequirementChange | null;
  changedInVersion: number | null;
};

export type ReadingTally = {
  added: number;
  changed: number;
  unchanged: number;
  missing: number;
  /** New requirements that may be an earlier one under a new code. */
  toConfirm: number;
};

/**
 * Save what a reading of a document finds, part by part, and compare it with
 * what the project already had.
 *
 * A requirement is the same one when its code matches; failing that, when its
 * text is clearly the closest (utils/requirement-match.ts). A merely likely
 * match is saved as new with `possibleMatchId` for QA to settle — guessing
 * wrong would move test cases onto the wrong requirement. Links to test cases
 * hang on the row, so updating in place keeps them.
 *
 * Every requirement the reading touches is marked against the document's
 * current version: ADDED, CHANGED (with the text it had before), UNCHANGED.
 * `finish` marks the ones it never found MISSING — they stay in force until QA
 * confirms them removed. Reading the same version again keeps the changes the
 * first reading found, so a re-read does not hide them.
 */
export async function startRequirementReading(docId: string) {
  const doc = await prisma.requirementDoc.findUnique({
    where: { id: docId },
    select: { projectId: true, version: true },
  });
  if (!doc) throw notFound("Document");
  const { projectId, version } = doc;

  const known: KnownRequirement[] = await prisma.requirement.findMany({
    where: { docId },
    orderBy: { position: "asc" },
    select: {
      ...SNAPSHOT_SELECT,
      id: true,
      status: true,
      change: true,
      changedInVersion: true,
    },
  });
  // A document read for the first time has nothing to compare against.
  const comparing = known.length > 0;
  const matched = new Set<string>();
  const tally: ReadingTally = { added: 0, changed: 0, unchanged: 0, missing: 0, toConfirm: 0 };

  async function save(item: ExtractedRequirement, position: number) {
    const text: RequirementSnapshot = {
      code: item.code,
      title: item.title,
      section: item.section ?? null,
      description: item.description ?? null,
      acceptanceCriteria: item.acceptanceCriteria ?? null,
    };

    let match = known.find((row) => row.code === item.code);
    let possibleMatchId: string | null = null;
    if (match && matched.has(match.id)) return;
    if (!match) {
      const verdict = findMatch(
        text,
        known.filter((row) => row.status === "ACTIVE" && !matched.has(row.id)),
      );
      if (verdict.kind === "same") match = verdict.candidate;
      if (verdict.kind === "ask") possibleMatchId = verdict.candidate.id;
    }

    if (!match) {
      await prisma.requirement.create({
        data: {
          ...text,
          openQuestions: item.openQuestions ?? null,
          position,
          docId,
          projectId,
          change: comparing ? "ADDED" : null,
          changedInVersion: comparing ? version : null,
          possibleMatchId,
        },
      });
      if (comparing) tally.added += 1;
      if (possibleMatchId) tally.toConfirm += 1;
      return;
    }

    matched.add(match.id);
    // Matched by its text under another code: keep the old code if the new
    // one belongs to a different requirement of this document.
    const code = known.some((row) => row.code === item.code && row.id !== match.id) ? match.code : item.code;
    const next = { ...text, code };
    const before = snapshotOf(match);
    const differs = code !== match.code || !sameRequirementText(match, next);
    const rereadOfThisVersion = match.changedInVersion === version;
    const keepEarlierFinding =
      rereadOfThisVersion && (match.change === "ADDED" || match.change === "CHANGED");

    const change: RequirementChange | null = keepEarlierFinding
      ? match.change
      : match.status === "REMOVED"
        ? "ADDED"
        : differs
          ? "CHANGED"
          : "UNCHANGED";

    // Later parts look codes up here, so it has to know this one moved.
    match.code = code;
    await prisma.requirement.update({
      where: { id: match.id },
      data: {
        ...next,
        openQuestions: item.openQuestions ?? null,
        position,
        status: "ACTIVE",
        change,
        changedInVersion: version,
        ...(keepEarlierFinding ? {} : { previous: differs ? before : Prisma.DbNull }),
      },
    });
    if (change === "ADDED") tally.added += 1;
    else if (change === "CHANGED") tally.changed += 1;
    else tally.unchanged += 1;
  }

  async function finish(): Promise<ReadingTally> {
    const unseen = known.filter((row) => row.status === "ACTIVE" && !matched.has(row.id));
    if (unseen.length) {
      await prisma.requirement.updateMany({
        where: { id: { in: unseen.map((row) => row.id) } },
        data: { change: "MISSING", changedInVersion: version },
      });
    }
    tally.missing = unseen.length;
    return tally;
  }

  /** What the document had before, for telling the AI which codes to reuse. */
  const previous = known.filter((row) => row.status === "ACTIVE");

  return { version, previous, save, finish };
}
