import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";
import { pastedDocumentText } from "@/utils/document-text";

import { findApiSpecSections } from "./ai-scripts.service";

beforeEach(resetDatabase);

const SPEC = `openapi: 3.0.0
info: { title: Shop, version: "1" }
paths:
  /orders:
    post:
      summary: Place an order
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [sku]
              properties: { sku: { type: string } }
      responses: { "201": { description: Placed } }
  /orders/{id}:
    get:
      responses: { "404": { description: No such order } }
`;

describe("findApiSpecSections", () => {
  it("hands an API case the spec sections of the requirements it verifies", async () => {
    const { project, module, owner } = await createProject();
    const spec = await prisma.requirementDoc.create({
      data: {
        projectId: project.id,
        createdById: owner.id,
        title: "Shop API",
        kind: "OTHER",
        content: pastedDocumentText(SPEC),
        charCount: 1,
      },
    });
    const prd = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: owner.id, title: "PRD", content: "Orders can be placed.", charCount: 1 },
    });
    const [place, read, prose] = await Promise.all(
      [
        { docId: spec.id, code: "POST /orders" },
        { docId: spec.id, code: "get /orders/{id}" },
        { docId: prd.id, code: "FR-1" },
      ].map((req) =>
        prisma.requirement.create({ data: { ...req, projectId: project.id, title: req.code } }),
      ),
    );

    const testCase = await createTestCase(project.id, module.id, "TC-1");
    const apiCase = await prisma.testCase.update({ where: { id: testCase.id }, data: { platform: "API" } });
    await prisma.testCaseRequirement.createMany({
      data: [place!, read!, prose!].map((req) => ({ testCaseId: apiCase.id, requirementId: req.id })),
    });

    const sections = await findApiSpecSections(apiCase);
    expect(sections).toHaveLength(2);
    expect(sections.join("\n")).toContain("- sku (string, required)");
    expect(sections.join("\n")).toContain("- 404 — No such order");
    // A PRD requirement has no spec section, and a Web case gets none at all.
    expect(sections.join("\n")).not.toContain("Orders can be placed");
    expect(await findApiSpecSections({ ...apiCase, platform: "WEB" })).toEqual([]);
  });
});
