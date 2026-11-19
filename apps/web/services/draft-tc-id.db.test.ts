import { beforeEach, describe, expect, it } from "vitest";

import { normalizeTcIdPrefix } from "@wetestcase/dto";
import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { listPendingDrafts, reviewDrafts, setDraftsPrefix, updateDraft } from "./test-case-draft.service";

beforeEach(resetDatabase);

async function drafts(projectId: string, moduleName: string, titles: string[]) {
  const created = [];
  for (const title of titles) {
    created.push(await prisma.testCaseDraft.create({ data: { projectId, moduleName, title, requirementIds: [] } }));
  }
  return created;
}

async function accept(projectId: string, reviewerId: string, ids: string[]) {
  const result = await reviewDrafts(projectId, reviewerId, { action: "accept", ids });
  return result.accepted.map((a) => a.tcId);
}

describe("TC IDs of accepted drafts", () => {
  it("come from the module, numbered after the cases already there", async () => {
    const { project, module, owner } = await createProject();
    await createTestCase(project.id, module.id, "TC-LOGIN-01");
    const [a, b] = await drafts(project.id, "Login", ["Wrong password", "Empty fields"]);

    expect(await accept(project.id, owner.id, [a!.id, b!.id])).toEqual(["TC-LOGIN-02", "TC-LOGIN-03"]);
  });

  it("use the prefix chosen for a module's drafts, or for one draft", async () => {
    const { project, owner } = await createProject();
    const [a, b, c] = await drafts(project.id, "Customers", ["Create", "Delete", "Search"]);

    await setDraftsPrefix(project.id, [a!.id, b!.id, c!.id], "tc-cust-##");
    await updateDraft(c!.id, { moduleName: "Customers", title: "Search", tcIdPrefix: "Search" });

    const listed = await listPendingDrafts(project.id);
    expect(listed.map((d) => [d.tcIdPrefix, d.defaultTcIdPrefix])).toEqual([
      ["CUST", "CUSTOMERS"],
      ["CUST", "CUSTOMERS"],
      ["SEARCH", "CUSTOMERS"],
    ]);
    expect(await accept(project.id, owner.id, [a!.id, b!.id, c!.id])).toEqual([
      "TC-CUST-01",
      "TC-CUST-02",
      "TC-SEARCH-01",
    ]);
  });

  it("go back to the default when the prefix is cleared, and keep it when an edit leaves it out", async () => {
    const { project, owner } = await createProject();
    const [a] = await drafts(project.id, "Login", ["Login succeeds"]);
    await setDraftsPrefix(project.id, [a!.id], "AUTH");

    await updateDraft(a!.id, { moduleName: "Login", title: "Login succeeds" });
    expect((await listPendingDrafts(project.id))[0]!.tcIdPrefix).toBe("AUTH");

    await setDraftsPrefix(project.id, [a!.id], "  ");
    expect(await accept(project.id, owner.id, [a!.id])).toEqual(["TC-LOGIN-01"]);
  });

  it("still come from the requirement's code when the draft verifies one", async () => {
    const { project, owner } = await createProject();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, title: "FRD", kind: "FRD", content: "x", charCount: 1, createdById: owner.id },
    });
    const requirement = await prisma.requirement.create({
      data: { projectId: project.id, docId: doc.id, code: "FR-012", title: "Sign in", verifiedAt: new Date() },
    });
    const draft = await prisma.testCaseDraft.create({
      data: { projectId: project.id, moduleName: "Login", title: "Sign in works", requirementIds: [requirement.id] },
    });

    expect(await accept(project.id, owner.id, [draft.id])).toEqual(["TC-FR-012-01"]);
  });
});

describe("normalizeTcIdPrefix", () => {
  it("keeps what matters and drops the TC- and -## around it", () => {
    expect(normalizeTcIdPrefix("login")).toBe("LOGIN");
    expect(normalizeTcIdPrefix("TC-LOGIN-##")).toBe("LOGIN");
    expect(normalizeTcIdPrefix("FR-012")).toBe("FR-012");
    expect(normalizeTcIdPrefix("customer create")).toBe("CUSTOMER-CREATE");
    expect(normalizeTcIdPrefix("  ")).toBeNull();
    expect(normalizeTcIdPrefix(null)).toBeNull();
  });
});
