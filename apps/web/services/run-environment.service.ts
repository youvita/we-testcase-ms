import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/api";
import { open, seal } from "@/lib/secret-box";
import type {
  RunEnvironmentDto,
  RunEnvironmentInput,
  RunVariableDto,
} from "@wetestcase/dto";

import { assertProjectExists } from "./project.service";

/**
 * Where automated runs point, per project: base URLs and variables.
 *
 * Variables are sealed as one blob. A secret's value is never returned to the
 * browser — the form sends `null` for "unchanged" — and only the runner sees
 * it, decrypted for the run it is executing.
 */

type StoredVariable = { key: string; value: string; secret: boolean };

function readVariables(sealed: string | null): StoredVariable[] {
  if (!sealed) return [];
  const json = open(sealed);
  if (json === null) {
    // The key changed (BETTER_AUTH_SECRET / CLAUDE_TOKEN_SECRET rotated).
    // Better to show none than to fail the page; saving again re-seals.
    return [];
  }
  try {
    return JSON.parse(json) as StoredVariable[];
  } catch {
    return [];
  }
}

function toDto(row: {
  id: string;
  name: string;
  webBaseUrl: string | null;
  apiBaseUrl: string | null;
  startPath: string | null;
  variablesSealed: string | null;
}): RunEnvironmentDto {
  return {
    id: row.id,
    name: row.name,
    webBaseUrl: row.webBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    startPath: row.startPath,
    variables: readVariables(row.variablesSealed).map(
      (v): RunVariableDto => ({
        key: v.key,
        value: v.secret ? null : v.value,
        secret: v.secret,
      }),
    ),
  };
}

export async function listRunEnvironments(
  projectId: string,
): Promise<RunEnvironmentDto[]> {
  const rows = await prisma.runEnvironment.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
  return rows.map(toDto);
}

/**
 * Merge submitted variables with what is stored. A secret submitted with a
 * null value keeps its stored value; one that was never stored cannot.
 */
function mergeVariables(
  submitted: RunEnvironmentInput["variables"],
  stored: StoredVariable[],
): StoredVariable[] {
  const previous = new Map(stored.map((v) => [v.key, v]));
  return (submitted ?? []).map((v) => {
    if (v.value !== null) {
      return { key: v.key, value: v.value, secret: v.secret ?? false };
    }
    const kept = previous.get(v.key);
    if (!kept) throw badRequest(`Give ${v.key} a value`);
    return { key: v.key, value: kept.value, secret: v.secret ?? kept.secret };
  });
}

async function assertNameFree(projectId: string, name: string, exceptId?: string) {
  const clash = await prisma.runEnvironment.findFirst({
    where: { projectId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`An environment named "${name}" already exists`);
}

type ParsedInput = {
  name: string;
  webBaseUrl?: string;
  apiBaseUrl?: string;
  startPath?: string;
  variables: RunEnvironmentInput["variables"];
};

export async function createRunEnvironment(projectId: string, input: ParsedInput) {
  await assertProjectExists(projectId);
  await assertNameFree(projectId, input.name);
  const variables = mergeVariables(input.variables, []);
  const row = await prisma.runEnvironment.create({
    data: {
      projectId,
      name: input.name,
      webBaseUrl: input.webBaseUrl ?? null,
      apiBaseUrl: input.apiBaseUrl ?? null,
      startPath: input.startPath ?? null,
      variablesSealed: variables.length ? seal(JSON.stringify(variables)) : null,
    },
  });
  return toDto(row);
}

export async function updateRunEnvironment(environmentId: string, input: ParsedInput) {
  const existing = await prisma.runEnvironment.findUnique({
    where: { id: environmentId },
  });
  if (!existing) throw notFound("Environment");
  await assertNameFree(existing.projectId, input.name, environmentId);

  const variables = mergeVariables(
    input.variables,
    readVariables(existing.variablesSealed),
  );
  const row = await prisma.runEnvironment.update({
    where: { id: environmentId },
    data: {
      name: input.name,
      webBaseUrl: input.webBaseUrl ?? null,
      apiBaseUrl: input.apiBaseUrl ?? null,
      startPath: input.startPath ?? null,
      variablesSealed: variables.length ? seal(JSON.stringify(variables)) : null,
    },
  });
  return toDto(row);
}

/** Past runs keep their environment name; they only lose the link. */
export async function deleteRunEnvironment(environmentId: string) {
  await prisma.runEnvironment.delete({ where: { id: environmentId } });
}

/** Variable names only — what Claude is told exists, never the values. */
export async function getEnvironmentOutline(environmentId: string, projectId: string) {
  const row = await prisma.runEnvironment.findFirst({
    where: { id: environmentId, projectId },
  });
  if (!row) throw notFound("Environment");
  return {
    id: row.id,
    name: row.name,
    webBaseUrl: row.webBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    startPath: row.startPath ?? "/",
    variables: readVariables(row.variablesSealed).map((v) => ({ key: v.key, secret: v.secret })),
  };
}

/** Everything the runner needs, secrets included. Never send this to a browser. */
export async function resolveEnvironmentForRunner(environmentId: string | null) {
  if (!environmentId) return null;
  const row = await prisma.runEnvironment.findUnique({
    where: { id: environmentId },
  });
  if (!row) return null;
  const variables = readVariables(row.variablesSealed);
  return {
    name: row.name,
    webBaseUrl: row.webBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    vars: Object.fromEntries(variables.map((v) => [v.key, v.value])),
    secretKeys: variables.filter((v) => v.secret).map((v) => v.key),
  };
}
