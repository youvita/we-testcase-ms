import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRunItemAccess } from "@/lib/project-access";
import { recordDraftFailure } from "@/services/test-run.service";

type Ctx = { params: Promise<{ itemId: string }> };

/**
 * The script was right — the product is wrong: record a draft script's
 * failure on its test case, and trust the script from now on.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { itemId } = await params;
    await assertRunItemAccess(itemId, user);
    return ok(await recordDraftFailure(itemId, user));
  },
);
