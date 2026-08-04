import { prisma } from "@/lib/prisma";
import { conflict, notFound } from "@/lib/api";
import type { ModuleInput } from "@/lib/validations";
import type { ModuleProgress } from "@/types";
import { buildBreakdown } from "@/utils/stats";

import { assertProjectExists } from "./project.service";

export async function listModules(projectId: string) {
  return prisma.module.findMany({
    where: { projectId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { testCases: true } } },
  });
}

/**
 * Per-module status roll-up for the progress panel.
 *
 * One groupBy for the whole project, then folded onto the module list, so a
 * project with 50 modules still costs two queries.
 */
export async function getModuleProgress(
  projectId: string,
): Promise<ModuleProgress[]> {
  const [modules, grouped] = await Promise.all([
    prisma.module.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.testCase.groupBy({
      by: ["moduleId", "status"],
      where: { projectId },
      _count: { _all: true },
    }),
  ]);

  const byModule = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const entry = byModule.get(row.moduleId) ?? {};
    entry[row.status] = row._count._all;
    byModule.set(row.moduleId, entry);
  }

  return modules.map((m) => ({
    moduleId: m.id,
    moduleName: m.name,
    ...buildBreakdown(byModule.get(m.id) ?? {}),
  }));
}

export async function createModule(projectId: string, input: ModuleInput) {
  await assertProjectExists(projectId);

  const name = input.name.trim();
  const duplicate = await prisma.module.findUnique({
    where: { projectId_name: { projectId, name } },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`A module named "${name}" already exists in this project`);
  }

  // Append to the end unless an explicit position was supplied.
  const position =
    input.position && Number(input.position) > 0
      ? Number(input.position)
      : await prisma.module.count({ where: { projectId } });

  return prisma.module.create({
    data: {
      projectId,
      name,
      description: input.description ?? null,
      position,
    },
  });
}

export async function updateModule(moduleId: string, input: ModuleInput) {
  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, projectId: true },
  });
  if (!existing) throw notFound("Module");

  const name = input.name.trim();
  const duplicate = await prisma.module.findFirst({
    where: { projectId: existing.projectId, name, NOT: { id: moduleId } },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`A module named "${name}" already exists in this project`);
  }

  return prisma.module.update({
    where: { id: moduleId },
    data: {
      name,
      description: input.description ?? null,
      ...(input.position !== undefined
        ? { position: Number(input.position) }
        : {}),
    },
  });
}

/**
 * Delete a module. Test cases inside it cascade, so this is destructive — the
 * API layer requires an explicit confirmation and reports the case count first.
 */
export async function deleteModule(moduleId: string) {
  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true },
  });
  if (!existing) throw notFound("Module");

  await prisma.module.delete({ where: { id: moduleId } });
}

/**
 * Resolve a module by name inside a project, creating it when absent.
 *
 * Used by the Excel importer: sheets reference modules by name, and QA should
 * not have to pre-create every module before importing.
 */
export async function findOrCreateModuleByName(
  projectId: string,
  rawName: string,
  positionHint: number,
): Promise<{ id: string; created: boolean; name: string }> {
  const name = rawName.trim() || "Unassigned";

  const existing = await prisma.module.findUnique({
    where: { projectId_name: { projectId, name } },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false, name };

  const created = await prisma.module.create({
    data: { projectId, name, position: positionHint },
    select: { id: true },
  });
  return { id: created.id, created: true, name };
}
