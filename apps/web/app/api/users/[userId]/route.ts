import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { userUpdateSchema } from "@/lib/validations";
import { deleteUser, updateUser } from "@/services/user.service";

type Ctx = { params: Promise<{ userId: string }> };

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN] },
  async (request, { params, user }) => {
    const { userId } = await params;
    const body = userUpdateSchema.parse(await readJson(request));
    return ok(await updateUser(userId, body, user.id));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN] },
  async (_request, { params, user }) => {
    const { userId } = await params;
    await deleteUser(userId, user.id);
    return ok({ deleted: true });
  },
);
