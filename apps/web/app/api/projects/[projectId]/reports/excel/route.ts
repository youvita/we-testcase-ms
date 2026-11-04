import { badRequest, route } from "@/lib/api";
import {
  EXCEL_REPORT_SCOPES,
  PLATFORMS,
  type ExcelReportScope,
  type Platform,
} from "@/lib/constants";
import { assertProjectAccess } from "@/lib/project-access";
import { getProject } from "@/services/project.service";
import {
  buildExcelReport,
  excelReportFilenameSuffix,
  listFilterFromQuery,
  reportEnvironmentParam,
  reportFileSlug,
} from "@/services/report.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** Excel report. Readable by every role, including Developers. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);

  const requested = new URL(request.url).searchParams.get("scope") ?? "summary";
  if (!(EXCEL_REPORT_SCOPES as readonly string[]).includes(requested)) {
    throw badRequest('scope must be "summary", "cases", or "failed"');
  }
  const scope = requested as ExcelReportScope;

  const platformParam = new URL(request.url).searchParams.get("platform");
  let platforms: Platform[] | undefined;
  if (platformParam) {
    const tokens = platformParam.split(",").map((token) => token.trim());
    if (!tokens.every((token) => (PLATFORMS as readonly string[]).includes(token))) {
      throw badRequest(
        `platform must be a comma-separated list of ${PLATFORMS.map((p) => `"${p}"`).join(", ")}`,
      );
    }
    platforms = tokens as Platform[];
  }

  const environment = reportEnvironmentParam(request);
  const project = await getProject(projectId);
  // The test case list exports what it shows: its filters, platform included,
  // narrow the whole report. Elsewhere `platform` only picks rows, as before.
  const listFilter =
    scope === "cases"
      ? await listFilterFromQuery(projectId, new URL(request.url).searchParams)
      : null;
  const buffer = await buildExcelReport(projectId, scope, {
    platforms: listFilter ? undefined : platforms,
    environment,
    filter: listFilter?.filter,
    filterLabels: listFilter?.labels,
  });
  const filename = `${reportFileSlug(project.name)}${environment ? `-${reportFileSlug(environment)}` : ""}-${excelReportFilenameSuffix(scope)}.xlsx`;

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
