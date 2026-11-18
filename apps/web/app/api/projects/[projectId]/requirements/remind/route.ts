import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { verifyReminderSchema } from "@/lib/validations";
import { lastVerifyReminder, remindToVerify } from "@/services/verify-reminder.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** The latest reminder: who sent it, and when — the dialog says so. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await lastVerifyReminder(projectId));
});

/** Remind the PO to verify requirements. At most one an hour per project. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const input = verifyReminderSchema.parse(await readJson(request));
    return ok(await remindToVerify(projectId, { id: user.id, name: user.name }, input));
  },
);
