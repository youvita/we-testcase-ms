import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createUser, resetDatabase } from "@/test/db";

import {
  listRequirements,
  startRequirementReading,
  updateRequirement,
  verifyRequirements,
} from "./requirement.service";
import { listPendingDrafts, reviewDrafts } from "./test-case-draft.service";

beforeEach(resetDatabase);

async function seed() {
  const { project, owner } = await createProject();
  await prisma.project.update({ where: { id: project.id }, data: { platforms: ["WEB"] } });
  const po = await createUser("ADMIN");
  const doc = await prisma.requirementDoc.create({
    data: { projectId: project.id, createdById: owner.id, kind: "FRD", title: "FRD", content: "x", charCount: 1 },
  });
  const make = (code: string, title: string) =>
    prisma.requirement.create({ data: { projectId: project.id, docId: doc.id, code, title, description: "As written." } });
  const signIn = await make("FR-1", "Sign in");
  const lockout = await make("FR-2", "Lockout");
  return { project, owner, po, doc, signIn, lockout };
}

const draftFor = (projectId: string, requirementId: string, title: string) =>
  prisma.testCaseDraft.create({
    data: { projectId, moduleName: "Login", title, platform: "WEB", requirementIds: [requirementId] },
  });

const verifiedOf = async (id: string) => (await prisma.requirement.findUniqueOrThrow({ where: { id } })).verifiedAt;

describe("verifying requirements", () => {
  it("records who verified, and can be taken back", async () => {
    const { project, po, signIn, lockout } = await seed();

    expect(await verifyRequirements(project.id, po.id, [signIn.id], true)).toEqual({ updated: 1 });

    const [one, two] = await listRequirements(project.id);
    expect(one).toMatchObject({ code: "FR-1", verifiedBy: { id: po.id } });
    expect(one!.verifiedAt).not.toBeNull();
    expect(two).toMatchObject({ code: "FR-2", verifiedAt: null, verifiedBy: null });

    await verifyRequirements(project.id, po.id, [signIn.id], false);
    expect(await verifiedOf(signIn.id)).toBeNull();
    expect(await verifiedOf(lockout.id)).toBeNull();
  });

  it("only touches this project's requirements still in force", async () => {
    const { project, po, signIn } = await seed();
    const other = await seed();
    await prisma.requirement.update({ where: { id: signIn.id }, data: { status: "REMOVED" } });

    expect(await verifyRequirements(project.id, po.id, [signIn.id, other.signIn.id], true)).toEqual({ updated: 0 });
  });
});

describe("accepting drafts", () => {
  it("waits until the PO has verified the requirement", async () => {
    const { project, owner, po, signIn } = await seed();
    const draft = await draftFor(project.id, signIn.id, "Sign in works");

    const [pending] = await listPendingDrafts(project.id);
    expect(pending!.requirements).toEqual([expect.objectContaining({ code: "FR-1", verified: false })]);
    await expect(reviewDrafts(project.id, owner.id, { action: "accept", ids: [draft.id] })).rejects.toThrow(
      /Waiting for the PO to verify FR-1/,
    );
    expect(await prisma.testCase.count()).toBe(0);

    await verifyRequirements(project.id, po.id, [signIn.id], true);
    const result = await reviewDrafts(project.id, owner.id, { action: "accept", ids: [draft.id] });
    expect(result.accepted).toHaveLength(1);
  });

  it("lets drafts with no requirement through, and rejecting is never held up", async () => {
    const { project, owner, signIn } = await seed();
    const explored = await prisma.testCaseDraft.create({
      data: { projectId: project.id, moduleName: "Login", title: "From exploring", platform: "WEB", requirementIds: [] },
    });
    const waiting = await draftFor(project.id, signIn.id, "Waits");

    expect((await reviewDrafts(project.id, owner.id, { action: "accept", ids: [explored.id] })).accepted).toHaveLength(1);
    expect((await reviewDrafts(project.id, owner.id, { action: "reject", ids: [waiting.id] })).rejected).toBe(1);
  });
});

describe("a change to the text", () => {
  it("needs the PO again when QA edits what it says, not when only its questions change", async () => {
    const { project, po, signIn } = await seed();
    await verifyRequirements(project.id, po.id, [signIn.id], true);

    await updateRequirement(signIn.id, {
      code: "FR-1",
      title: "Sign in",
      description: "As written.",
      openQuestions: "- Is SSO in scope?",
    });
    expect(await verifiedOf(signIn.id)).not.toBeNull();

    await updateRequirement(signIn.id, { code: "FR-1", title: "Sign in", description: "With a one-time code." });
    expect(await verifiedOf(signIn.id)).toBeNull();
  });

  it("needs the PO again when a new version changes it, and keeps what did not change", async () => {
    const { project, po, doc, signIn, lockout } = await seed();
    await verifyRequirements(project.id, po.id, [signIn.id, lockout.id], true);
    await prisma.requirementDoc.update({ where: { id: doc.id }, data: { version: 2 } });

    const reading = await startRequirementReading(doc.id);
    await reading.save({ code: "FR-1", title: "Sign in", description: "As written." }, 0);
    await reading.save({ code: "FR-2", title: "Lockout", description: "After three attempts now." }, 1);
    await reading.save({ code: "FR-3", title: "Remember me", description: "New." }, 2);
    await reading.finish();

    expect(await verifiedOf(signIn.id)).not.toBeNull();
    expect(await verifiedOf(lockout.id)).toBeNull();
    const added = await prisma.requirement.findFirstOrThrow({ where: { code: "FR-3" } });
    expect(added.verifiedAt).toBeNull();
  });
});
