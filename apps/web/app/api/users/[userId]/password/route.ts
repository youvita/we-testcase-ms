import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { userPasswordResetSchema } from "@/lib/validations";
import { resetUserPassword } from "@/services/user.service";

type Ctx = { params: Promise<{ userId: string }> };

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN] },
  async (request, { params, user }) => {
    const { userId } = await params;
    const body = userPasswordResetSchema.parse(await readJson(request));
    await resetUserPassword(userId, body.password, user.id);
    return ok({ reset: true });
  },
);
