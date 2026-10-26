import { route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { exportCaseFrd } from "@/services/frd-export.service";

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
