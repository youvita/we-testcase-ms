import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { fixStatusSchema } from "@/lib/validations";
import { setFixStatus } from "@/services/test-case.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Move a case's triage state along.
 *
 * Both roles reach this endpoint but not the same values: developers own
 * investigating / fix ready / won't fix / not a bug, QA owns retesting. The
 * service decides — see `canSetFixStatus` and `canMarkRetesting`.
 */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    const { fixStatus, note } = fixStatusSchema.parse(await readJson(request));
    return ok(
      await setFixStatus(
        testCaseId,
        { id: user.id, role: user.role },
        fixStatus,
        note,
      ),
    );
  },
);
