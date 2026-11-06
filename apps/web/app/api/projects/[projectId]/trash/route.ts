import { trashActionSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { listTrash, purgeTestCases } from "@/services/test-case.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** The project's deleted test cases. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listTrash(projectId));
});

/** Delete forever: the cases named in `ids`, or the whole Trash without them. */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { ids } = trashActionSchema.parse(await readJson(request));
    return ok(await purgeTestCases(projectId, ids));
  },
);
