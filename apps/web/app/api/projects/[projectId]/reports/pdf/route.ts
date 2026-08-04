import { route } from "@/lib/api";
import { getProject } from "@/services/project.service";
import { buildPdfReport, reportFileSlug } from "@/services/report.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** PDF summary report. Readable by every role, including Developers. */
export const GET = route<Ctx>({}, async (_request, { params }) => {
  const { projectId } = await params;

  const project = await getProject(projectId);
  const buffer = await buildPdfReport(projectId);
  const filename = `${reportFileSlug(project.name)}-summary-report.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
