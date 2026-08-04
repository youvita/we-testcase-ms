import type { ProjectStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api";
import type { ProjectOutput } from "@/lib/validations";
import type { ProjectWithStats, StatusBreakdown } from "@/types";
import { buildBreakdown } from "@/utils/stats";

const qaOwnerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/**
 * List projects with their status roll-ups.
 *
 * Test-case counts come from a single grouped query rather than a per-project
 * count, so the list stays at two queries regardless of project count.
 */
export async function listProjects(options?: {
  status?: ProjectStatus;
  search?: string;
}): Promise<ProjectWithStats[]> {
  const where = {
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
      include: { qaOwner: qaOwnerSelect },
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

  return projects.map((project) => ({
    ...project,
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
      modules: { orderBy: [{ position: "asc" }, { name: "asc" }] },
    },
  });
  if (!project) throw notFound("Project");
  return project;
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

export async function createProject(input: ProjectOutput, createdById: string) {
  return prisma.project.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      version: input.version ?? null,
      environment: input.environment ?? null,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      qaOwnerId: input.qaOwnerId,
      createdById,
    },
    include: { qaOwner: qaOwnerSelect },
  });
}

export async function updateProject(projectId: string, input: ProjectOutput) {
  await assertProjectExists(projectId);

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: input.name,
      description: input.description ?? null,
      version: input.version ?? null,
      environment: input.environment ?? null,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      qaOwnerId: input.qaOwnerId,
    },
    include: { qaOwner: qaOwnerSelect },
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
