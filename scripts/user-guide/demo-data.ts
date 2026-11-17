/**
 * Extra demo data for the user guide's screenshots: environments, a
 * requirements document with requirements, a draft and a PO question, and a
 * discussion with a fix status on a failed case — the things the seed leaves
 * empty, so their pages would show nothing.
 *
 * Run it only against a test database that has the demo seed
 * (`npx tsx prisma/seed.ts`), never against real data. Safe to run twice:
 * every row has a fixed id and is skipped if it is there.
 *
 *   cd apps/web && DATABASE_URL=… npx tsx ../../scripts/user-guide/demo-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PROJECT = "Weloan365 Mobile Banking";

async function main() {
  const project = await prisma.project.findFirst({ where: { name: PROJECT } });
  if (!project) throw new Error(`No "${PROJECT}" project — run the demo seed first.`);
  const user = async (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const admin = await user("admin@example.com");
  const qa = await user("qa@example.com");
  const dev = await user("dev@example.com");
  const testCase = (tcId: string) =>
    prisma.testCase.findFirstOrThrow({ where: { projectId: project.id, tcId } });

  // Environments, SIT the default.
  for (const env of [
    { id: "guide-env-sit", name: "SIT", webBaseUrl: "https://sit.weloan365.example", apiBaseUrl: "https://api.sit.weloan365.example" },
    { id: "guide-env-uat", name: "UAT", webBaseUrl: "https://uat.weloan365.example", apiBaseUrl: "https://api.uat.weloan365.example" },
  ]) {
    const exists = await prisma.runEnvironment.findFirst({ where: { projectId: project.id, name: env.name } });
    if (!exists) await prisma.runEnvironment.create({ data: { ...env, startPath: "/login", projectId: project.id } });
  }
  const sit = await prisma.runEnvironment.findFirstOrThrow({ where: { projectId: project.id, name: "SIT" } });
  await prisma.project.update({ where: { id: project.id }, data: { defaultEnvironmentId: sit.id } });

  // A requirements document and what was read from it.
  const docId = "guide-doc-prd";
  if (!(await prisma.requirementDoc.findUnique({ where: { id: docId } }))) {
    const content = [
      "Weloan365 Mobile Banking — Product Requirements",
      "1. Sign in: customers sign in with their phone number and a 6-digit PIN. Three wrong PINs lock the account for 30 minutes.",
      "2. Transfers: customers transfer between their own accounts and to other Weloan365 customers, within a daily limit.",
    ].join("\n\n");
    await prisma.requirementDoc.create({
      data: { id: docId, title: "Mobile Banking PRD", kind: "PRD", fileName: "mobile-banking-prd.docx", content, charCount: content.length, projectId: project.id, createdById: admin.id },
    });
    const requirements = [
      { id: "guide-req-1", code: "LOGIN-01", section: "Sign in", title: "Sign in with phone number and PIN", description: "Customers sign in with their registered phone number and a 6-digit PIN.", acceptanceCriteria: "- A correct phone number and PIN opens the dashboard\n- A wrong PIN shows an error and does not sign in", verified: true },
      { id: "guide-req-2", code: "LOGIN-02", section: "Sign in", title: "Lock the account after three wrong PINs", description: "Three wrong PINs in a row lock the account for 30 minutes.", acceptanceCriteria: "- The third wrong PIN locks the account\n- The lock lifts after 30 minutes", verified: true },
      { id: "guide-req-3", code: "TRF-01", section: "Transfers", title: "Transfer within the daily limit", description: "Transfers are refused once the day's total would pass the daily limit.", acceptanceCriteria: "- A transfer within the limit goes through\n- A transfer over the limit is refused with the remaining amount shown", openQuestions: "- Is the daily limit per account or per customer?", verified: false },
    ];
    for (const [position, req] of requirements.entries()) {
      const { verified, ...fields } = req;
      await prisma.requirement.create({
        data: { ...fields, position, docId, projectId: project.id, ...(verified ? { verifiedAt: new Date(), verifiedById: qa.id } : {}) },
      });
    }
    for (const tcId of ["TC-LOGIN-001", "TC-LOGIN-002"]) {
      await prisma.testCaseRequirement.create({ data: { testCaseId: (await testCase(tcId)).id, requirementId: "guide-req-1" } });
    }
    await prisma.testCaseRequirement.create({ data: { testCaseId: (await testCase("TC-LOGIN-003")).id, requirementId: "guide-req-2" } });
    await prisma.testCaseDraft.create({
      data: {
        id: "guide-draft-1", moduleName: "Transfers", title: "A transfer over the daily limit is refused",
        preconditions: "Signed in; the account has a balance above the daily limit.",
        steps: "1. Open Transfer\n2. Enter an amount above the remaining daily limit\n3. Submit",
        expectedResult: "The transfer is refused and the remaining limit is shown.",
        testType: "NEGATIVE", priority: "HIGH", platform: "WEB", requirementIds: ["guide-req-3"], projectId: project.id,
      },
    });
    await prisma.poQuestion.create({
      data: { id: "guide-poq-1", body: "Is the daily transfer limit per account or per customer?", projectId: project.id, requirementId: "guide-req-3", askerId: qa.id, questionToId: admin.id },
    });
  }

  // A failed case with a discussion and a fix in progress.
  const failed = await testCase("TC-TRF-002");
  if (!(await prisma.comment.findUnique({ where: { id: "guide-comment-1" } }))) {
    await prisma.comment.create({
      data: { id: "guide-comment-1", body: "Reproduced on SIT: the transfer goes through even when the balance is too low. Screenshot is on the latest result.", testCaseId: failed.id, authorId: qa.id },
    });
    await prisma.comment.create({
      data: { id: "guide-comment-2", body: "Found it — the balance check only runs in the app. Adding it on the server now.", testCaseId: failed.id, authorId: dev.id, answerToId: "guide-comment-1" },
    });
    await prisma.testCase.update({
      where: { id: failed.id },
      data: { fixStatus: "INVESTIGATING", fixStatusAt: new Date(), fixStatusById: dev.id },
    });
  }

  console.log("Guide demo data ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
