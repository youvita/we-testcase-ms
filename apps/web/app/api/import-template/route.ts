import { route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess } from "@/lib/project-access";
import { buildImportTemplate } from "@/services/import.service";
import { assertProjectExists } from "@/services/project.service";

export const runtime = "nodejs";

/**
 * Download an Excel import template.
 *
 * Pass `?projectId=` to include that project's modules in the Module dropdown.
 */
export const GET = route({}, async (request, { user }) => {
  const projectId = new URL(request.url).searchParams.get("projectId");

  let modules: string[] = [];
  if (projectId) {
    await assertProjectExists(projectId);
    // The module list is project data, so it follows the project's access rule.
    await assertProjectAccess(projectId, user);
    const rows = await prisma.module.findMany({
      where: { projectId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { name: true },
    });
    modules = rows.map((row) => row.name);
  }

  const buffer = buildImportTemplate({ modules });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="test-case-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});
