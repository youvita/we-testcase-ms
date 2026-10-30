import { prisma } from "@/lib/prisma";

/** Empty every table, so each test starts from nothing. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;

export async function createUser(role: "ADMIN" | "QA" | "DEVELOPER" = "QA") {
  counter += 1;
  return prisma.user.create({
    data: {
      id: `user-${counter}`,
      name: `${role} ${counter}`,
      email: `user${counter}@example.test`,
      role,
    },
  });
}

/** A project with one module, owned by a fresh QA user. */
export async function createProject(name = "Project") {
  const owner = await createUser("QA");
  const project = await prisma.project.create({
    data: { name, createdById: owner.id, qaOwnerId: owner.id },
  });
  const module = await prisma.module.create({
    data: { projectId: project.id, name: "Login" },
  });
  return { project, module, owner };
}

export async function createTestCase(
  projectId: string,
  moduleId: string,
  tcId: string,
  title = `Case ${tcId}`,
) {
  return prisma.testCase.create({
    data: { projectId, moduleId, tcId, title },
  });
}
