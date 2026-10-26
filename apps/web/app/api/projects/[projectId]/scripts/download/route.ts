import { route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { exportProjectScripts } from "@/services/script-export.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/**
 * Automation scripts as a Playwright project (.zip): the cases in `ids`
 * (comma-separated), or every automated case in the project.
 */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const file = await exportProjectScripts(projectId, {
    testCaseIds: ids,
    environmentId: url.searchParams.get("environmentId") ?? undefined,
  });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
});
