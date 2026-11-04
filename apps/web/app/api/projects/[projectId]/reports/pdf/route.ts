import { route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { getProject } from "@/services/project.service";
import {
  buildPdfReport,
  reportEnvironmentParam,
  reportFileSlug,
} from "@/services/report.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** PDF summary report. Readable by every role, including Developers. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);

  const environment = reportEnvironmentParam(request);
  const project = await getProject(projectId);
  const buffer = await buildPdfReport(projectId, environment);
  const filename = `${reportFileSlug(project.name)}${environment ? `-${reportFileSlug(environment)}` : ""}-summary-report.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
