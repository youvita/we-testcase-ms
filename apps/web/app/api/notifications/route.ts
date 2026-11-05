import { ok, route } from "@/lib/api";
import { listNotifications } from "@/services/clarification.service";

/** The signed-in person's latest notifications and how many are unread. */
export const GET = route({}, async (_request, { user }) => ok(await listNotifications(user.id)));
