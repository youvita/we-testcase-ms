import { badRequest, route } from "@/lib/api";
import {
  EXCEL_REPORT_SCOPES,
  type ExcelReportScope,
} from "@/lib/constants";
import { getProject } from "@/services/project.service";
import {
  buildExcelReport,
  excelReportFilenameSuffix,
  reportFileSlug,
} from "@/services/report.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** Excel report. Readable by every role, including Developers. */
export const GET = route<Ctx>({}, async (request, { params }) => {
  const { projectId } = await params;

  const requested = new URL(request.url).searchParams.get("scope") ?? "summary";
  if (!(EXCEL_REPORT_SCOPES as readonly string[]).includes(requested)) {
    throw badRequest('scope must be "summary", "cases", or "failed"');
  }
  const scope = requested as ExcelReportScope;

  const project = await getProject(projectId);
  const buffer = await buildExcelReport(projectId, scope);
  const filename = `${reportFileSlug(project.name)}-${excelReportFilenameSuffix(scope)}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
