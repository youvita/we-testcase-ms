import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { exportRequirementDoc } from "./requirement.service";

beforeEach(resetDatabase);

async function doc(data: { title: string; fileName?: string | null; version?: number }) {
  const { project, owner } = await createProject();
  return prisma.requirementDoc.create({
    data: {
      projectId: project.id,
      createdById: owner.id,
      title: data.title,
      fileName: data.fileName ?? null,
      version: data.version ?? 1,
      content: "FR-1 Users can log in.",
      charCount: 22,
    },
  });
}

describe("exportRequirementDoc", () => {
  it("names the Markdown file after the title, whatever was uploaded", async () => {
    const created = await doc({ title: "Login PRD", fileName: "login.pdf" });
    expect(await exportRequirementDoc(created.id)).toEqual({
      fileName: "Login PRD.md",
      content: "FR-1 Users can log in.",
    });
  });

  it("marks later versions", async () => {
    const created = await doc({ title: "Billing FRD", fileName: "billing.docx", version: 3 });
    expect((await exportRequirementDoc(created.id)).fileName).toBe("Billing FRD v3.md");
  });

  it("keeps the header-breaking characters out of the name", async () => {
    const created = await doc({ title: 'Login "v2"/; final\r\n' });
    expect((await exportRequirementDoc(created.id)).fileName).toBe("Login -v2- final.md");
  });
});
