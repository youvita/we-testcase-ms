import type { Prisma } from "@prisma/client";

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

function toDto(
  row: {
    id: string;
    name: string;
    webBaseUrl: string | null;
    apiBaseUrl: string | null;
    startPath: string | null;
    variablesSealed: string | null;
  },
  defaultId: string | null,
): RunEnvironmentDto {
  return {
    id: row.id,
    isDefault: row.id === defaultId,
    name: row.name,
    webBaseUrl: row.webBaseUrl,
    apiBaseUrl: row.apiBaseUrl,
    startPath: row.startPath,
    variables: readVariables(row.variablesSealed).map(
      (v): RunVariableDto => ({
        key: v.key,
        value: v.secret ? null : v.value,
        secret: v.secret,
        empty: v.value === "",
      }),
    ),
  };
}

async function defaultIdOf(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { defaultEnvironmentId: true },
  });
  return project?.defaultEnvironmentId ?? null;
}

/**
 * The project's environments, its default first. Every picker preselects the
 * first one, so this is what makes the default the default everywhere.
 */
export async function listRunEnvironments(
  projectId: string,
): Promise<RunEnvironmentDto[]> {
  const [rows, defaultId] = await Promise.all([
    prisma.runEnvironment.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    }),
    defaultIdOf(projectId),
  ]);
  return rows
    .map((row) => toDto(row, defaultId))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Make this the project's default environment. */
export async function setDefaultRunEnvironment(environmentId: string) {
  const env = await prisma.runEnvironment.findUnique({
    where: { id: environmentId },
    select: { projectId: true },
  });
  if (!env) throw notFound("Environment");
  // The default now says where the project runs; the old free-text label
  // would only contradict it.
  await prisma.project.update({
    where: { id: env.projectId },
    data: { defaultEnvironmentId: environmentId, environment: null },
  });
}

/**
 * Merge submitted variables with what is stored. A secret submitted with a
 * null value keeps its stored value; one that was never stored cannot.
 *
 * A secret must end up with a value. A blank one is never intended — it is
 * what a copied environment holds until someone fills it in — and a script
 * reading it gets "", which the system under test reports as wrong
 * credentials rather than missing ones.
 */
function mergeVariables(
  submitted: RunEnvironmentInput["variables"],
  stored: StoredVariable[],
): StoredVariable[] {
  const previous = new Map(stored.map((v) => [v.key, v]));
  return (submitted ?? []).map((v) => {
    if (v.value !== null) {
      if (v.secret && v.value === "") throw badRequest(`Give ${v.key} a value`);
      return { key: v.key, value: v.value, secret: v.secret ?? false };
    }
    const kept = previous.get(v.key);
    if (!kept || ((v.secret ?? kept.secret) && kept.value === "")) {
      throw badRequest(`Give ${v.key} a value`);
    }
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

/**
 * A new project's environments, created inside its transaction. Returns
 * their ids by name, so the caller can make one the default.
 */
export async function addEnvironmentsToNewProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  inputs: ParsedInput[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const input of inputs) {
    const variables = mergeVariables(input.variables, []);
    const row = await tx.runEnvironment.create({
      data: {
        projectId,
        name: input.name,
        webBaseUrl: input.webBaseUrl ?? null,
        apiBaseUrl: input.apiBaseUrl ?? null,
        startPath: input.startPath ?? null,
        variablesSealed: variables.length ? seal(JSON.stringify(variables)) : null,
      },
      select: { id: true },
    });
    ids.set(input.name, row.id);
  }
  return ids;
}

export async function createRunEnvironment(projectId: string, input: ParsedInput) {
  await assertProjectExists(projectId);
  await assertNameFree(projectId, input.name);
  const variables = mergeVariables(input.variables, []);
  return prisma.$transaction(async (tx) => {
    const row = await tx.runEnvironment.create({
      data: {
        projectId,
        name: input.name,
        webBaseUrl: input.webBaseUrl ?? null,
        apiBaseUrl: input.apiBaseUrl ?? null,
        startPath: input.startPath ?? null,
        variablesSealed: variables.length ? seal(JSON.stringify(variables)) : null,
      },
    });
    // A project's first environment is where it runs until told otherwise.
    const claimed = await tx.project.updateMany({
      where: { id: projectId, defaultEnvironmentId: null },
      data: { defaultEnvironmentId: row.id, environment: null },
    });
    return toDto(row, claimed.count > 0 ? row.id : await defaultIdOf(projectId));
  });
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
  return toDto(row, await defaultIdOf(row.projectId));
}

/**
 * A copy of an environment in the same project, as "UAT copy" — the quick way
 * to set up PRO from UAT. Secret values come along: the copy stays in the
 * project, where the same people could already use them. It is never the
 * default; renaming it and pointing it elsewhere is the next step.
 */
export async function duplicateRunEnvironment(environmentId: string) {
  const source = await prisma.runEnvironment.findUnique({
    where: { id: environmentId },
  });
  if (!source) throw notFound("Environment");

  const taken = new Set(
    (
      await prisma.runEnvironment.findMany({
        where: { projectId: source.projectId },
        select: { name: true },
      })
    ).map((env) => env.name),
  );
  let name = "";
  for (let n = 1; !name || taken.has(name); n += 1) {
    const suffix = n === 1 ? " copy" : ` copy ${n}`;
    // Names are capped at 60; trim the original, never the suffix.
    name = source.name.slice(0, 60 - suffix.length) + suffix;
  }

  const row = await prisma.runEnvironment.create({
    data: {
      projectId: source.projectId,
      name,
      webBaseUrl: source.webBaseUrl,
      apiBaseUrl: source.apiBaseUrl,
      startPath: source.startPath,
      variablesSealed: source.variablesSealed,
    },
  });
  return toDto(row, await defaultIdOf(row.projectId));
}

/** Past runs keep their environment name; they only lose the link. */
export async function deleteRunEnvironment(environmentId: string) {
  await prisma.runEnvironment.delete({ where: { id: environmentId } });
}

/**
 * An environment's variables re-sealed for another project, secret values
 * blanked: a copy must not carry credentials somewhere new on its own. The
 * keys stay, so the target shows exactly what to fill in.
 */
export function variablesForCopy(sealed: string | null) {
  const variables = readVariables(sealed).map((v) =>
    v.secret ? { ...v, value: "" } : v,
  );
  return {
    sealed: variables.length ? seal(JSON.stringify(variables)) : null,
    secretKeys: variables.filter((v) => v.secret).map((v) => v.key),
  };
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
    variables: readVariables(row.variablesSealed).map((v) => ({
      key: v.key,
      secret: v.secret,
      empty: v.value === "",
    })),
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
