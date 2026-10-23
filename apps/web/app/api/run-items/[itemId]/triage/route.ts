import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRunItemAccess } from "@/lib/project-access";
import { startTriage } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ itemId: string }> };

/** Ask Claude why this result failed. Returns the job to poll. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { itemId } = await params;
    await assertRunItemAccess(itemId, user);
    return ok(await startTriage(itemId, user), 202);
  },
);
