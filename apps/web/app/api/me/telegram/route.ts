import { ok, route } from "@/lib/api";
import { disconnectTelegram, telegramConnectLink, telegramStatus } from "@/services/telegram-link.service";

/**
 * The signed-in person's own Telegram. GET: whether it is connected — and,
 * while a Connect link is waiting, whether they have pressed Start since.
 */
export const GET = route({}, async (_request, { user }) => ok(await telegramStatus(user.id)));

/** A fresh one-time link to the bot: open it and press Start to connect. */
export const POST = route({}, async (_request, { user }) => ok(await telegramConnectLink(user.id)));

/** Stop Telegram notifications: forget the chat. */
export const DELETE = route({}, async (_request, { user }) => {
  await disconnectTelegram(user.id);
  return ok({ connected: false });
});
