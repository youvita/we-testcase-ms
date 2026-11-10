import type { Platform, Prisma } from "@prisma/client";

import { includingTrash, prisma, type Tx } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { PLATFORMS } from "@/lib/constants";
import type {
  CopyTarget,
  ProjectCopyPreview,
  ProjectCopyRequest,
  ProjectCopySummary,
} from "@wetestcase/dto";

import { variablesForCopy } from "./run-environment.service";

/**
 * Copy test cases — with their scripts, and optionally the project's run
 * environments and the requirements the cases verify — into another project.
 *
 * What a copy is: the case as written, never its history. Results, executions,
 * comments, attachments and fix status stay behind; copies start Not run.
 * Scripts arrive as drafts, because what was proven was the source project's
 * environment, not the target's.
 *
 * `planCopy` decides everything; the preview reports it and the copy carries
 * it out inside its transaction, so the two cannot disagree.
 */

type Db = Tx;

/** Projects this viewer may copy into: every one they can open but this. */
export async function listCopyTargets(
  sourceProjectId: string,
  access: Prisma.ProjectWhereInput,
): Promise<CopyTarget[]> {
  return prisma.project.findMany({
    where: { AND: [access, { NOT: { id: sourceProjectId } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function loadSourceCases(
  db: Db,
  projectId: string,
  scope: ProjectCopyRequest["scope"],
) {
  if (scope.kind === "module") {
    const found = await db.module.findFirst({
      where: { id: scope.moduleId, projectId },
      select: { id: true },
    });
    if (!found) throw notFound("Module");
  }

  return db.testCase.findMany({
    // Scoped to the source project, so ids from elsewhere are simply ignored.
    where: {
      projectId,
      ...(scope.kind === "cases" ? { id: { in: scope.ids } } : {}),
      ...(scope.kind === "module" ? { moduleId: scope.moduleId } : {}),
    },
    orderBy: [{ module: { position: "asc" } }, { tcId: "asc" }],
    select: {
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
      script: { select: { code: true } },
      requirements: { select: { requirementId: true } },
    },
  });
}

/** The target's cases with these TC IDs, by lower-cased ID; exact spelling wins. */
async function findExisting(db: Db, projectId: string, tcIds: string[]) {
  // A case in the target's Trash still holds its TC ID; overwriting brings it back.
  const found = await db.testCase.findMany({
    where: { projectId, tcId: { in: tcIds, mode: "insensitive" }, ...includingTrash },
    select: { id: true, tcId: true, script: { select: { code: true } } },
  });
  const exact = new Set(tcIds);
  const byKey = new Map<string, (typeof found)[number]>();
  for (const row of found) {
    const key = row.tcId.toLowerCase();
    if (!byKey.has(key) || exact.has(row.tcId)) byKey.set(key, row);
  }
  return byKey;
}

/** A requirement document is "the same" in the target by kind and title. */
const docKey = (doc: { kind: string; title: string }) => `${doc.kind}\u0000${doc.title}`;

async function planCopy(db: Db, sourceProjectId: string, request: ProjectCopyRequest) {
  if (request.targetProjectId === sourceProjectId) {
    throw badRequest("Choose a different project to copy to");
  }
  const target = await db.project.findUnique({
    where: { id: request.targetProjectId },
    select: { id: true, name: true, platforms: true, defaultEnvironmentId: true },
  });
  if (!target) throw notFound("Project");

  const cases = await loadSourceCases(db, sourceProjectId, request.scope);
  if (cases.length === 0) throw badRequest("There are no test cases to copy");

  const existing = await findExisting(db, target.id, cases.map((c) => c.tcId));
  const writes = cases
    .map((source) => ({ source, existing: existing.get(source.tcId.toLowerCase()) ?? null }))
    .filter((item) => !item.existing || request.mode === "overwrite");
  const skipped = cases
    .filter((c) => existing.has(c.tcId.toLowerCase()) && request.mode === "skip")
    .map((c) => c.tcId);

  const targetModules = await db.module.findMany({
    where: { projectId: target.id },
    select: { id: true, name: true },
  });
  const moduleNames = [...new Set(writes.map((w) => w.source.module.name))];
  const known = new Set(targetModules.map((m) => m.name));

  const used = new Set<Platform>(writes.map((w) => w.source.platform));
  const platformsAdded = PLATFORMS.filter(
    (p) => used.has(p) && !target.platforms.includes(p),
  );
  const platformsAll = PLATFORMS.filter(
    (p) => used.has(p) || target.platforms.includes(p),
  );

  const environments = request.includeEnvironments
    ? await planEnvironments(db, sourceProjectId, target.id)
    : { create: [], existing: 0, sourceDefaultName: null };

  const requirements = request.includeRequirements
    ? await planRequirements(db, sourceProjectId, target.id, request.scope, writes)
    : { docs: [] };

  return {
    target,
    cases,
    writes,
    skipped,
    targetModules,
    newModuleNames: moduleNames.filter((name) => !known.has(name)),
    platformsAdded,
    platformsAll,
    environments,
    requirements,
  };
}

async function planEnvironments(db: Db, sourceProjectId: string, targetProjectId: string) {
  const [source, target, sourceProject] = await Promise.all([
    db.runEnvironment.findMany({ where: { projectId: sourceProjectId }, orderBy: { name: "asc" } }),
    db.runEnvironment.findMany({ where: { projectId: targetProjectId }, select: { name: true } }),
    db.project.findUnique({
      where: { id: sourceProjectId },
      select: { defaultEnvironment: { select: { name: true } } },
    }),
  ]);
  const taken = new Set(target.map((env) => env.name));
  return {
    // One the target already has by name is its own now; never overwrite it.
    create: source.filter((env) => !taken.has(env.name)),
    existing: source.filter((env) => taken.has(env.name)).length,
    sourceDefaultName: sourceProject?.defaultEnvironment?.name ?? null,
  };
}

/**
 * Which documents and requirements to bring, and where each lands.
 *
 * A whole-project copy brings every document; a narrower one only the
 * requirements its copied cases verify, and their documents. Matching by
 * document kind and title, then requirement code, makes copying twice a
 * no-op rather than a second set.
 */
async function planRequirements(
  db: Db,
  sourceProjectId: string,
  targetProjectId: string,
  scope: ProjectCopyRequest["scope"],
  writes: { source: { requirements: { requirementId: string }[] } }[],
) {
  const linked = [...new Set(writes.flatMap((w) => w.source.requirements.map((r) => r.requirementId)))];
  const wholeProject = scope.kind === "project";

  const sourceDocs = await db.requirementDoc.findMany({
    where: wholeProject
      ? { projectId: sourceProjectId }
      : { projectId: sourceProjectId, requirements: { some: { id: { in: linked } } } },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      kind: true,
      fileName: true,
      content: true,
      charCount: true,
      requirements: {
        where: wholeProject ? {} : { id: { in: linked } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          acceptanceCriteria: true,
          openQuestions: true,
          section: true,
          position: true,
          status: true,
          verifiedAt: true,
          verifiedById: true,
        },
      },
    },
  });

  const targetDocs = await db.requirementDoc.findMany({
    where: { projectId: targetProjectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, kind: true, requirements: { select: { id: true, code: true } } },
  });
  const targetByKey = new Map<string, (typeof targetDocs)[number]>();
  for (const doc of targetDocs) {
    if (!targetByKey.has(docKey(doc))) targetByKey.set(docKey(doc), doc);
  }

  return {
    docs: sourceDocs.map((doc) => {
      const match = targetByKey.get(docKey(doc)) ?? null;
      const codes = new Map(match?.requirements.map((r) => [r.code, r.id]) ?? []);
      return {
        source: doc,
        targetDocId: match?.id ?? null,
        requirements: doc.requirements.map((req) => ({
          source: req,
          targetId: codes.get(req.code) ?? null,
        })),
      };
    }),
  };
}

/** Report what copying would do, without writing anything. */
export async function previewCopy(
  sourceProjectId: string,
  request: ProjectCopyRequest,
): Promise<ProjectCopyPreview> {
  const plan = await planCopy(prisma, sourceProjectId, request);
  const docs = plan.requirements.docs;
  return {
    targetProjectName: plan.target.name,
    cases: plan.cases.length,
    newCases: plan.writes.filter((w) => !w.existing).length,
    existing: plan.cases.length - plan.writes.filter((w) => !w.existing).length,
    scripts: plan.writes.filter((w) => w.source.script).length,
    newModules: plan.newModuleNames.length,
    platformsAdded: plan.platformsAdded,
    newEnvironments: plan.environments.create.length,
    existingEnvironments: plan.environments.existing,
    newRequirementDocs: docs.filter((d) => !d.targetDocId).length,
    newRequirements: docs.flatMap((d) => d.requirements).filter((r) => !r.targetId).length,
  };
}

/**
 * Copy into the target in one transaction: a failure leaves it untouched.
 *
 * Overwriting a case replaces its details, never its results — as a
 * re-import does. Its script is replaced when the source has one, and stays
 * verified only if the code is unchanged. Requirement links are added, not
 * swapped, so links made in the target survive.
 */
export async function copyToProject(
  sourceProjectId: string,
  request: ProjectCopyRequest,
  userId: string,
): Promise<ProjectCopySummary> {
  return prisma.$transaction(
    async (tx) => {
      const plan = await planCopy(tx, sourceProjectId, request);
      const targetProjectId = plan.target.id;

      if (plan.platformsAdded.length > 0) {
        await tx.project.update({
          where: { id: targetProjectId },
          data: { platforms: plan.platformsAll },
        });
      }

      // Modules: new ones go after the target's own, in the source's order.
      const moduleIdByName = new Map(plan.targetModules.map((m) => [m.name, m.id]));
      const startPosition = plan.targetModules.length;
      for (const [index, name] of plan.newModuleNames.entries()) {
        const made = await tx.module.create({
          data: { projectId: targetProjectId, name, position: startPosition + index },
          select: { id: true },
        });
        moduleIdByName.set(name, made.id);
      }

      const fields = (source: (typeof plan.writes)[number]["source"]) => ({
        moduleId: moduleIdByName.get(source.module.name)!,
        subModule: source.subModule,
        title: source.title,
        preconditions: source.preconditions,
        steps: source.steps,
        expectedResult: source.expectedResult,
        testType: source.testType,
        priority: source.priority,
        platform: source.platform,
      });

      // Cases. New ones in one statement; their ids come back by TC ID.
      const fresh = plan.writes.filter((w) => !w.existing);
      const created = fresh.length
        ? await tx.testCase.createManyAndReturn({
            data: fresh.map((w) => ({ projectId: targetProjectId, tcId: w.source.tcId, ...fields(w.source) })),
            select: { id: true, tcId: true },
          })
        : [];
      const createdIdByTcId = new Map(created.map((c) => [c.tcId, c.id]));

      const written: ((typeof plan.writes)[number] & { targetId: string })[] = [];
      for (const write of plan.writes) {
        if (write.existing) {
          // Deliberately leaves `status` and `lastExecutedAt` alone.
          await tx.testCase.update({
            where: { id: write.existing.id, ...includingTrash },
            data: { ...fields(write.source), deletedAt: null, deletedById: null },
          });
          written.push({ ...write, targetId: write.existing.id });
        } else {
          written.push({ ...write, targetId: createdIdByTcId.get(write.source.tcId)! });
        }
      }

      // Scripts, as drafts.
      let scriptsCopied = 0;
      const newScripts: Prisma.AutomationScriptCreateManyInput[] = [];
      for (const item of written) {
        const code = item.source.script?.code;
        if (code === undefined) continue;
        scriptsCopied += 1;
        const existingScript = item.existing?.script;
        if (!existingScript) {
          newScripts.push({ testCaseId: item.targetId, code, updatedById: userId, verifiedAt: null });
        } else if (existingScript.code !== code) {
          await tx.automationScript.update({
            where: { testCaseId: item.targetId },
            data: { code, updatedById: userId, verifiedAt: null },
          });
        }
      }
      if (newScripts.length) await tx.automationScript.createMany({ data: newScripts });

      // Environments, secret values blanked.
      const environmentsCreated: string[] = [];
      const secretsToFill: ProjectCopySummary["secretsToFill"] = [];
      const createdEnvIds = new Map<string, string>();
      for (const env of plan.environments.create) {
        const variables = variablesForCopy(env.variablesSealed);
        const made = await tx.runEnvironment.create({
          data: {
            projectId: targetProjectId,
            name: env.name,
            webBaseUrl: env.webBaseUrl,
            apiBaseUrl: env.apiBaseUrl,
            startPath: env.startPath,
            variablesSealed: variables.sealed,
          },
          select: { id: true },
        });
        createdEnvIds.set(env.name, made.id);
        environmentsCreated.push(env.name);
        if (variables.secretKeys.length) {
          secretsToFill.push({ environment: env.name, keys: variables.secretKeys });
        }
      }

      // A target with no default takes the source's, or else the first copied.
      if (!plan.target.defaultEnvironmentId && createdEnvIds.size > 0) {
        const name = plan.environments.sourceDefaultName;
        await tx.project.update({
          where: { id: targetProjectId },
          data: {
            defaultEnvironmentId:
              (name && createdEnvIds.get(name)) || createdEnvIds.values().next().value!,
            environment: null,
          },
        });
      }

      // Requirements. A new document carries only its current text, as version 1.
      let requirementDocsCreated = 0;
      let requirementsCreated = 0;
      const targetRequirementId = new Map<string, string>();
      // Codes made so far per target document: two source documents with one
      // kind and title land in the same one and must not make a code twice.
      const madeCodes = new Map<string, Map<string, string>>();
      for (const doc of plan.requirements.docs) {
        let docId = doc.targetDocId;
        if (!docId) {
          const made = await tx.requirementDoc.create({
            data: {
              projectId: targetProjectId,
              title: doc.source.title,
              kind: doc.source.kind,
              fileName: doc.source.fileName,
              content: doc.source.content,
              charCount: doc.source.charCount,
              createdById: userId,
            },
            select: { id: true },
          });
          docId = made.id;
          requirementDocsCreated += 1;
        }

        const codes = madeCodes.get(docId) ?? new Map<string, string>();
        madeCodes.set(docId, codes);
        const missing = doc.requirements.filter((r) => !r.targetId && !codes.has(r.source.code));
        const made = missing.length
          ? await tx.requirement.createManyAndReturn({
              data: missing.map(({ source }) => ({
                docId: docId!,
                projectId: targetProjectId,
                code: source.code,
                title: source.title,
                description: source.description,
                acceptanceCriteria: source.acceptanceCriteria,
                openQuestions: source.openQuestions,
                section: source.section,
                position: source.position,
                status: source.status,
                // The same text the PO verified in the source project.
                verifiedAt: source.verifiedAt,
                verifiedById: source.verifiedById,
              })),
              select: { id: true, code: true },
            })
          : [];
        requirementsCreated += made.length;
        for (const r of made) codes.set(r.code, r.id);
        for (const req of doc.requirements) {
          targetRequirementId.set(req.source.id, req.targetId ?? codes.get(req.source.code)!);
        }
      }

      const links = written.flatMap((item) =>
        item.source.requirements
          .map((r) => targetRequirementId.get(r.requirementId))
          .filter((id): id is string => Boolean(id))
          .map((requirementId) => ({ testCaseId: item.targetId, requirementId })),
      );
      const linked = links.length
        ? await tx.testCaseRequirement.createMany({ data: links, skipDuplicates: true })
        : { count: 0 };

      return {
        targetProjectId,
        targetProjectName: plan.target.name,
        created: fresh.length,
        updated: plan.writes.length - fresh.length,
        skipped: plan.skipped,
        scriptsCopied,
        modulesCreated: plan.newModuleNames,
        platformsAdded: plan.platformsAdded,
        environmentsCreated,
        secretsToFill,
        requirementDocsCreated,
        requirementsCreated,
        requirementLinks: linked.count,
      };
    },
    // A whole project is thousands of statements; the 5 s default is for one form.
    { maxWait: 10_000, timeout: 120_000 },
  );
}
