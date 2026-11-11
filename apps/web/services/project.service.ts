import type { Platform, Prisma, ProjectStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/api";
import { PLATFORM_LABELS } from "@/lib/constants";
import type { ProjectCreateOutput, ProjectOutput } from "@/lib/validations";
import type { ProjectWithStats, StatusBreakdown } from "@/types";
import { buildBreakdown } from "@/utils/stats";

import { addEnvironmentsToNewProject } from "./run-environment.service";

const productOwnerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/** People in charge, in a stable order for display. */
/** Where the project runs by default, and what it could choose from. */
const environmentInclude = {
  defaultEnvironment: { select: { id: true, name: true } },
  runEnvironments: { select: { id: true, name: true }, orderBy: { name: "asc" } },
} as const satisfies Prisma.ProjectInclude;

const memberSelect = {
  select: { user: productOwnerSelect },
  orderBy: [{ user: { name: "asc" } }],
} as const satisfies Prisma.Project$membersArgs;

/**
 * List projects with their status roll-ups.
 *
 * Test-case counts come from a single grouped query rather than a per-project
 * count, so the list stays at two queries regardless of project count.
 */
export async function listProjects(options?: {
  status?: ProjectStatus;
  search?: string;
  /**
   * Restrict the list to projects this viewer may open. Callers pass
   * `projectAccessWhere(user)`; omitting it lists every project, which only
   * unscoped internals (seeding, reports over all data) should do.
   */
  access?: Prisma.ProjectWhereInput;
}): Promise<ProjectWithStats[]> {
  const where = {
    ...(options?.access ?? {}),
    ...(options?.status ? { status: options.status } : {}),
    ...(options?.search
      ? {
          OR: [
            { name: { contains: options.search, mode: "insensitive" as const } },
            {
              description: {
                contains: options.search,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const [projects, grouped, moduleCounts] = await Promise.all([
    prisma.project.findMany({
      where,
      include: { productOwner: productOwnerSelect, members: memberSelect, ...environmentInclude },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.testCase.groupBy({
      by: ["projectId", "status"],
      _count: { _all: true },
    }),
    prisma.module.groupBy({
      by: ["projectId"],
      _count: { _all: true },
    }),
  ]);

  const statsByProject = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const entry = statsByProject.get(row.projectId) ?? {};
    entry[row.status] = row._count._all;
    statsByProject.set(row.projectId, entry);
  }

  const modulesByProject = new Map(
    moduleCounts.map((m) => [m.projectId, m._count._all]),
  );

  return projects.map(({ members, ...project }) => ({
    ...project,
    // Flattened so the UI never sees the join row.
    members: members.map((member) => member.user),
    moduleCount: modulesByProject.get(project.id) ?? 0,
    stats: buildBreakdown(statsByProject.get(project.id) ?? {}),
  }));
}

export async function getProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      productOwner: productOwnerSelect,
      createdBy: productOwnerSelect,
      members: memberSelect,
      modules: { orderBy: [{ position: "asc" }, { name: "asc" }] },
      ...environmentInclude,
    },
  });
  if (!project) throw notFound("Project");

  const { members, ...rest } = project;
  return { ...rest, members: members.map((member) => member.user) };
}

/** Project detail plus the roll-ups the overview page renders. */
export async function getProjectWithStats(projectId: string) {
  const project = await getProject(projectId);
  const stats = await getProjectStats(projectId);
  return { ...project, stats };
}

export async function getProjectStats(
  projectId: string,
): Promise<StatusBreakdown> {
  const grouped = await prisma.testCase.groupBy({
    by: ["status"],
    where: { projectId },
    _count: { _all: true },
  });

  return buildBreakdown(
    Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
  );
}

/** Fields shared by create and update, so the two cannot drift apart. */
function toProjectData(input: ProjectOutput) {
  return {
    name: input.name,
    description: input.description ?? null,
    version: input.version ?? null,
    status: input.status,
    startDate: input.startDate,
    endDate: input.endDate,
    productOwnerId: input.productOwnerId,
    // Absent on update means "leave as is" — see projectSchema.
    ...(input.platforms ? { platforms: input.platforms } : {}),
    // Absent leaves it; choosing one retires the old free-text label.
    ...(input.defaultEnvironmentId === undefined
      ? {}
      : {
          defaultEnvironmentId: input.defaultEnvironmentId,
          ...(input.defaultEnvironmentId ? { environment: null } : {}),
        }),
  };
}

/** The product owner is a PO, and POs are admins here: an active admin. */
async function assertProductOwner(userId: string) {
  const eligible = await prisma.user.count({
    where: { id: userId, isActive: true, role: "ADMIN" },
  });
  if (!eligible) throw badRequest("Choose the product owner from the list — an active admin.");
}

/** The default must be one of this project's own environments. */
async function assertDefaultEnvironment(
  projectId: string | null,
  environmentId: string | null | undefined,
) {
  if (!environmentId) return;
  const found = projectId
    ? await prisma.runEnvironment.findFirst({
        where: { id: environmentId, projectId },
        select: { id: true },
      })
    : null;
  if (!found) throw badRequest("Choose one of this project's run environments");
}

/**
 * Refuse to drop a platform that test cases still use. Their platform would
 * no longer be one the project offers, and filters and coverage would hide
 * them — QA should move or delete those cases first.
 */
async function assertPlatformsCoverCases(
  projectId: string,
  platforms: ProjectOutput["platforms"],
) {
  if (!platforms) return;
  const orphaned = await prisma.testCase.groupBy({
    by: ["platform"],
    where: { projectId, platform: { notIn: platforms } },
    _count: { _all: true },
  });
  if (orphaned.length === 0) return;
  const detail = orphaned
    .map((row) => `${row._count._all} ${PLATFORM_LABELS[row.platform]}`)
    .join(", ");
  throw conflict(
    `Test cases still use the platforms you removed (${detail}). Change or delete those cases first.`,
  );
}

/**
 * Drop ids that are not active users.
 *
 * A stale id from a deleted account would otherwise fail the whole save on a
 * foreign key, and silently granting access to a disabled account is worse than
 * ignoring it.
 */
async function resolveMemberIds(memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: memberIds }, isActive: true },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/**
 * Create a project, with any run environments added in its form.
 *
 * Those have no ids until now, so the default is named instead: one of them,
 * or null for none. All in one transaction — a project is never left behind
 * by an environment that failed to save.
 */
export async function createProject(
  input: ProjectOutput & Partial<Pick<ProjectCreateOutput, "environments" | "defaultEnvironmentName">>,
  createdById: string,
) {
  // An id cannot name an environment of a project that does not exist yet.
  await assertDefaultEnvironment(null, input.defaultEnvironmentId);
  await assertProductOwner(input.productOwnerId);
  const environments = input.environments ?? [];
  const defaultName = input.defaultEnvironmentName ?? null;
  if (defaultName && !environments.some((env) => env.name === defaultName)) {
    throw badRequest("The default environment must be one of the environments added");
  }
  const memberIds = await resolveMemberIds(input.memberIds ?? []);

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ...toProjectData(input),
        createdById,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    const ids = await addEnvironmentsToNewProject(tx, project.id, environments);
    return tx.project.update({
      where: { id: project.id },
      data: { defaultEnvironmentId: defaultName ? ids.get(defaultName)! : null },
      include: { productOwner: productOwnerSelect, members: memberSelect },
    });
  });
}

export async function updateProject(projectId: string, input: ProjectOutput) {
  await assertProjectExists(projectId);
  await assertPlatformsCoverCases(projectId, input.platforms);
  await assertDefaultEnvironment(projectId, input.defaultEnvironmentId);
  await assertProductOwner(input.productOwnerId);

  // Omitted means "do not touch who is in charge" — see memberIds in the schema.
  if (input.memberIds === undefined) {
    return prisma.project.update({
      where: { id: projectId },
      data: toProjectData(input),
      include: { productOwner: productOwnerSelect, members: memberSelect },
    });
  }

  const memberIds = await resolveMemberIds(input.memberIds);

  /**
   * The submitted list replaces the stored one, in one transaction: a partial
   * apply could leave someone in charge of a project the form no longer lists,
   * and membership is what grants access.
   */
  return prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: { projectId, userId: { notIn: memberIds } },
    });

    return tx.project.update({
      where: { id: projectId },
      data: {
        ...toProjectData(input),
        members: {
          // Re-adding an existing member must not collide with its own row.
          connectOrCreate: memberIds.map((userId) => ({
            where: { projectId_userId: { projectId, userId } },
            create: { userId },
          })),
        },
      },
      include: { productOwner: productOwnerSelect, members: memberSelect },
    });
  });
}

/**
 * Delete a project. Modules, test cases, executions and attachment rows cascade
 * via the schema; the caller is responsible for removing stored files.
 */
export async function deleteProject(projectId: string) {
  await assertProjectExists(projectId);
  await prisma.project.delete({ where: { id: projectId } });
}

/**
 * The platform to store on a case in this project.
 *
 * A case's platform is always one its project has enabled. Omitted means the
 * project's first platform.
 */
export async function resolveProjectPlatform(
  projectId: string,
  platform: Platform | undefined,
): Promise<Platform> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { platforms: true },
  });
  if (!project) throw notFound("Project");
  if (!platform) return project.platforms[0] ?? "WEB";
  if (!project.platforms.includes(platform)) {
    throw badRequest(
      `${PLATFORM_LABELS[platform]} is not one of this project's platforms. Add it in the project settings first.`,
    );
  }
  return platform;
}

export async function assertProjectExists(projectId: string) {
  const exists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!exists) throw notFound("Project");
  return exists;
}

/** Who can be a project's product owner: the active admins, who are the POs. */
export async function listProductOwnerCandidates() {
  return prisma.user.findMany({
    where: { isActive: true, role: "ADMIN" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Users who can be put in charge of a project.
 *
 * Any active account, unlike the QA-owner list: a developer fixing this
 * project's failures needs to be able to open it, and being in charge grants
 * access without granting them anything their role does not already allow.
 */
export async function listProjectMemberCandidates() {
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
