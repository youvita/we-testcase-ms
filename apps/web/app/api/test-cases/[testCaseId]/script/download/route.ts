import { route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { exportCaseScript } from "@/services/script-export.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const runtime = "nodejs";

/** The case's script as a runnable Playwright .spec.ts file. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  const environmentId = new URL(request.url).searchParams.get("environmentId") ?? undefined;
  const file = await exportCaseScript(testCaseId, environmentId);
  return new Response(file.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
