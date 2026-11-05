import { route } from "@/lib/api";
import { assertRequirementDocAccess } from "@/lib/project-access";
import { exportRequirementDoc } from "@/services/requirement.service";

type Ctx = { params: Promise<{ docId: string }> };

export const runtime = "nodejs";

/** The document's text as Markdown — what the AI reads, not the original upload. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { docId } = await params;
  await assertRequirementDocAccess(docId, user);
  const file = await exportRequirementDoc(docId);
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
