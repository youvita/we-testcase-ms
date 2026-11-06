import { z } from "zod";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { restoreTestCases } from "@/services/test-case.service";

type Ctx = { params: Promise<{ projectId: string }> };

const restoreSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

/** Bring test cases back from the Trash. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { ids } = restoreSchema.parse(await readJson(request));
    return ok(await restoreTestCases(projectId, ids));
  },
);
