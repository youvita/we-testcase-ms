import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { frdGenerateSchema } from "@/lib/validations";
import { exportCaseFrd } from "@/services/frd-export.service";
import { generateCaseFrd } from "@/services/frd-generate.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const runtime = "nodejs";

/** The FRD/PRD text this case's requirements come from, as Markdown. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  const file = await exportCaseFrd(testCaseId);
  return new Response(file.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The name is already limited to safe characters.
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/**
 * Write an FRD for a case that has none — quick (laid out from the case) or
 * by the AI (a job to follow) — saved to Requirements → Documents and linked.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const body = frdGenerateSchema.parse(await readJson(request));
    return ok(await generateCaseFrd(testCaseId, user, body), 202);
  },
);
