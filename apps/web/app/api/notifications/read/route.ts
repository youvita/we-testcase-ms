import { ok, readJson, route } from "@/lib/api";
import { notificationsReadSchema } from "@/lib/validations";
import { markNotificationsRead } from "@/services/clarification.service";

/** Mark some, or all, of the signed-in person's notifications read. */
export const POST = route({}, async (request, { user }) => {
  const { ids } = notificationsReadSchema.parse(await readJson(request));
  await markNotificationsRead(user.id, ids);
  return ok({ read: true });
});
