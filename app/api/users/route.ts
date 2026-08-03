import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { userCreateSchema } from "@/lib/validations";
import { createUser, listUsers } from "@/services/user.service";

export const GET = route(
  { roles: [ROLES.ADMIN] },
  async (request) => {
    const search = new URL(request.url).searchParams.get("search");
    return ok(await listUsers(search ?? undefined));
  },
);

export const POST = route({ roles: [ROLES.ADMIN] }, async (request) => {
  const body = userCreateSchema.parse(await readJson(request));
  return ok(await createUser(body), 201);
});
