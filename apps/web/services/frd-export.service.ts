import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";

/**
 * The requirement documents (FRD/PRD) a test case comes from, as one
 * Markdown file. Only a document's text is kept at upload, so that is what
 * is downloaded; several documents are joined one after another.
 */
export async function exportCaseFrd(testCaseId: string) {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      tcId: true,
      requirements: {
        select: {
          requirement: {
            select: {
              code: true,
              title: true,
              doc: { select: { id: true, title: true, kind: true, fileName: true, content: true } },
            },
          },
        },
        orderBy: { requirement: { code: "asc" } },
      },
    },
  });
  if (!testCase) throw notFound("Test case");

  const docs = new Map<string, { title: string; kind: string; fileName: string | null; content: string }>();
  for (const { requirement } of testCase.requirements) {
    if (requirement.doc) docs.set(requirement.doc.id, requirement.doc);
  }
  if (docs.size === 0) {
    throw badRequest("This test case is not linked to a requirement document.");
  }

  const verifies = testCase.requirements
    .map(({ requirement }) => `- ${requirement.code} — ${requirement.title}`)
    .join("\n");
  const body = [...docs.values()]
    .map((doc) => `<!-- ${doc.kind}: ${doc.title}${doc.fileName ? ` (uploaded as ${doc.fileName})` : ""} -->\n\n${doc.content}`)
    .join("\n\n---\n\n");
  const content = `<!-- Exported from TestCase MS for ${testCase.tcId}, which verifies:\n${verifies}\n-->\n\n${body}\n`;

  const only = docs.size === 1 ? [...docs.values()][0]! : null;
  const base = (only?.title ?? `${testCase.tcId} requirements`).replace(/[^A-Za-z0-9._ -]+/g, "-").trim() || "FRD";
  return { fileName: `${base}.md`, content };
}
