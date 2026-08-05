import type { Prisma, ProjectStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import { PROJECT_ENVIRONMENTS } from "@/lib/constants";
import type { ProjectOutput } from "@/lib/validations";
import type { ProjectWithStats, StatusBreakdown } from "@/types";
import { buildBreakdown } from "@/utils/stats";

const qaOwnerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/** People in charge, in a stable order for display. */
const memberSelect = {
  select: { user: qaOwnerSelect },
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
      include: { qaOwner: qaOwnerSelect, members: memberSelect },
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
      qaOwner: qaOwnerSelect,
      createdBy: qaOwnerSelect,
      members: memberSelect,
      modules: { orderBy: [{ position: "asc" }, { name: "asc" }] },
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
    environment: input.environment ?? null,
    status: input.status,
    startDate: input.startDate,
    endDate: input.endDate,
    qaOwnerId: input.qaOwnerId,
  };
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

export async function createProject(input: ProjectOutput, createdById: string) {
  const memberIds = await resolveMemberIds(input.memberIds ?? []);

  return prisma.project.create({
    data: {
      ...toProjectData(input),
      createdById,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
    include: { qaOwner: qaOwnerSelect, members: memberSelect },
  });
}

export async function updateProject(projectId: string, input: ProjectOutput) {
  await assertProjectExists(projectId);

  // Omitted means "do not touch who is in charge" — see memberIds in the schema.
  if (input.memberIds === undefined) {
    return prisma.project.update({
      where: { id: projectId },
      data: toProjectData(input),
      include: { qaOwner: qaOwnerSelect, members: memberSelect },
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
      include: { qaOwner: qaOwnerSelect, members: memberSelect },
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

export async function assertProjectExists(projectId: string) {
  const exists = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!exists) throw notFound("Project");
  return exists;
}

/** Users eligible to be a project's QA owner. */
export async function listQaOwnerCandidates() {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["QA", "ADMIN"] } },
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

/**
 * Environments to offer in the project form: the standard three plus anything
 * teams have already typed, so a one-off name becomes a normal choice next time.
 */
export async function listEnvironmentOptions(): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { environment: { not: null } },
    select: { environment: true },
    distinct: ["environment"],
    orderBy: { environment: "asc" },
  });

  const used = rows
    .map((row) => row.environment?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set<string>([...PROJECT_ENVIRONMENTS, ...used]));
}
