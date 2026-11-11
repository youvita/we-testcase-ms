import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { renameRequirementDocFolder } from "./requirement.service";

beforeEach(resetDatabase);

async function seed() {
  const { project, owner } = await createProject();
  const doc = (title: string, folder: string | null, projectId = project.id) =>
    prisma.requirementDoc.create({
      data: { projectId, createdById: owner.id, title, folder, content: "x", charCount: 1 },
    });
  return { project, owner, doc };
}

const foldersOf = async (projectId: string) =>
  (await prisma.requirementDoc.findMany({ where: { projectId }, orderBy: { title: "asc" } })).map((d) => [
    d.title,
    d.folder,
  ]);

describe("renaming a folder", () => {
  it("moves every document in it, and only in this project", async () => {
    const { project, doc } = await seed();
    await doc("Bills FRD", "Bill");
    await doc("Bills PRD", "Bill");
    await doc("Customers FRD", "Customers");
    const other = await createProject("Other");
    await doc("Elsewhere", "Bill", other.project.id);

    expect(await renameRequirementDocFolder(project.id, "Bill", "Bills")).toEqual({ moved: 2, merged: false });
    expect(await foldersOf(project.id)).toEqual([
      ["Bills FRD", "Bills"],
      ["Bills PRD", "Bills"],
      ["Customers FRD", "Customers"],
    ]);
    expect(await foldersOf(other.project.id)).toEqual([["Elsewhere", "Bill"]]);
  });

  it("joins a folder that already has the name", async () => {
    const { project, doc } = await seed();
    await doc("Old", "Billing");
    await doc("New", "Bills");

    expect(await renameRequirementDocFolder(project.id, "Billing", "Bills")).toEqual({ moved: 1, merged: true });
    expect(await foldersOf(project.id)).toEqual([
      ["New", "Bills"],
      ["Old", "Bills"],
    ]);
  });

  it("refuses a folder that does not exist", async () => {
    const { project } = await seed();
    await expect(renameRequirementDocFolder(project.id, "Nope", "Bills")).rejects.toThrow(/Folder/);
  });
});
