import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { listNotifications } from "@/services/clarification.service";
import { createProject, createUser, resetDatabase } from "@/test/db";

import { lastVerifyReminder, remindToVerify } from "./verify-reminder.service";

beforeEach(resetDatabase);

async function setUp() {
  const { project, owner: qa } = await createProject();
  const [po, otherAdmin] = [await createUser("ADMIN"), await createUser("ADMIN")];
  await prisma.project.update({ where: { id: project.id }, data: { productOwnerId: po.id } });
  const doc = await prisma.requirementDoc.create({
    data: { projectId: project.id, createdById: qa.id, title: "FRD", content: "x", charCount: 1 },
  });
  const [waiting, alsoWaiting, verified] = await Promise.all(
    ["FR-1", "FR-2", "FR-3"].map((code) =>
      prisma.requirement.create({ data: { projectId: project.id, docId: doc.id, code, title: code, description: code } }),
    ),
  );
  await prisma.requirement.update({ where: { id: verified!.id }, data: { verifiedAt: new Date(), verifiedById: po.id } });
  return { project, qa: { id: qa.id, name: "Quinn" }, po, otherAdmin, waiting: waiting!, alsoWaiting: alsoWaiting!, verified: verified! };
}

describe("reminding the PO to verify requirements", () => {
  it("goes to the project's PO, with how many are waiting, and opens them", async () => {
    const { project, qa, po } = await setUp();
    const result = await remindToVerify(project.id, qa, { note: "We draft on Monday." });
    expect(result).toEqual({ waiting: 2, to: [po.name] });

    const { items } = await listNotifications(po.id);
    expect(items).toMatchObject([
      {
        kind: "REQUIREMENTS_TO_VERIFY",
        actor: { id: qa.id },
        href: `/projects/${project.id}/requirements?tab=requirements&coverage=unverified`,
        excerpt: "2 requirements are waiting for you to verify. We draft on Monday.",
      },
    ]);
    expect(await lastVerifyReminder(project.id)).toMatchObject({ by: "QA 1" });
  });

  it("goes to every admin while the project has no PO", async () => {
    const { project, qa, po, otherAdmin } = await setUp();
    await prisma.project.update({ where: { id: project.id }, data: { productOwnerId: null } });
    const result = await remindToVerify(project.id, qa, {});
    expect(result.to.sort()).toEqual([po.name, otherAdmin.name].sort());
  });

  it("reminds anyone @mentioned in the message too", async () => {
    const { project, qa, po, otherAdmin } = await setUp();
    await prisma.user.update({ where: { id: otherAdmin.id }, data: { username: "t_alice" } });
    const result = await remindToVerify(project.id, qa, { note: "@t_alice can you check too?" });
    expect(result.to.sort()).toEqual([po.name, otherAdmin.name].sort());
  });

  it("counts only the picked requirements still waiting", async () => {
    const { project, qa, waiting, verified } = await setUp();
    expect((await remindToVerify(project.id, qa, { requirementIds: [waiting.id, verified.id] })).waiting).toBe(1);
  });

  it("refuses when nothing is waiting, and a second reminder within the hour", async () => {
    const { project, qa, verified } = await setUp();
    await expect(remindToVerify(project.id, qa, { requirementIds: [verified.id] })).rejects.toThrow(/already verified/);
    await remindToVerify(project.id, qa, {});
    await expect(remindToVerify(project.id, qa, {})).rejects.toThrow(/one reminder an hour/);
  });
});
