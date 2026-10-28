import { ok, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { listPendingDrafts } from "@/services/test-case-draft.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listPendingDrafts(projectId));
});
