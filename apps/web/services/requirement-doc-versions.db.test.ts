import { beforeEach, describe, expect, it } from "vitest";

import { createProject, createUser, resetDatabase } from "@/test/db";

import {
  addRequirementDocVersion,
  createRequirementDoc,
  exportRequirementDoc,
  getRequirementDoc,
  listRequirementDocs,
  listRequirementDocVersions,
  setRequirementDocFolder,
} from "./requirement.service";

beforeEach(resetDatabase);

describe("document folders", () => {
  it("keeps a feature's documents under one folder, and moves them", async () => {
    const { project, owner } = await createProject();
    const frd = await createRequirementDoc(project.id, owner.id, {
      title: "Billing FRD",
      kind: "FRD",
      fileName: null,
      content: "text",
      folder: "  Billing ",
    });
    await createRequirementDoc(project.id, owner.id, { title: "Loose", kind: "FRD", fileName: null, content: "x" });

    expect((await listRequirementDocs(project.id)).map((d) => [d.title, d.folder])).toEqual([
      ["Billing FRD", "Billing"],
      ["Loose", null],
    ]);

    await setRequirementDocFolder(frd.id, "Payments");
    expect((await listRequirementDocs(project.id))[0]!.folder).toBe("Payments");
    await setRequirementDocFolder(frd.id, "  ");
    expect((await listRequirementDocs(project.id))[0]!.folder).toBeNull();
  });
});

describe("version history", () => {
  it("lists every version with who uploaded it, and opens any of them", async () => {
    const { project, owner } = await createProject();
    const second = await createUser("QA");
    const third = await createUser("ADMIN");
    const { id } = await createRequirementDoc(project.id, owner.id, {
      title: "Billing FRD",
      kind: "FRD",
      fileName: "billing-v1.docx",
      content: "first text",
    });
    await addRequirementDocVersion(id, second.id, { fileName: "billing-v2.docx", content: "second text" });
    await addRequirementDocVersion(id, third.id, { fileName: "billing-v3.docx", content: "third text" });

    const versions = await listRequirementDocVersions(id);
    expect(versions.map((v) => [v.version, v.current, v.fileName, v.uploadedBy?.id])).toEqual([
      [3, true, "billing-v3.docx", third.id],
      [2, false, "billing-v2.docx", second.id],
      [1, false, "billing-v1.docx", owner.id],
    ]);

    expect((await getRequirementDoc(id)).content).toBe("third text");
    expect(await getRequirementDoc(id, 2)).toMatchObject({ version: 2, content: "second text", fileName: "billing-v2.docx" });
    expect(await exportRequirementDoc(id, 1)).toEqual({ fileName: "Billing FRD.md", content: "first text" });
    expect(await exportRequirementDoc(id, 2)).toEqual({ fileName: "Billing FRD v2.md", content: "second text" });
    await expect(getRequirementDoc(id, 9)).rejects.toThrow();

    // The list says when the current version came, and from whom.
    const [doc] = await listRequirementDocs(project.id);
    expect(doc).toMatchObject({ version: 3, versionBy: { id: third.id } });
  });

  it("is one version for a document never replaced", async () => {
    const { project, owner } = await createProject();
    const { id } = await createRequirementDoc(project.id, owner.id, { title: "PRD", kind: "PRD", fileName: null, content: "x" });
    expect(await listRequirementDocVersions(id)).toMatchObject([{ version: 1, current: true, uploadedBy: { id: owner.id } }]);
    const [doc] = await listRequirementDocs(project.id);
    expect(doc!.versionAt).toBe(doc!.createdAt);
  });
});
