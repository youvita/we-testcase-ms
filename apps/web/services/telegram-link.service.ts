import { randomBytes } from "node:crypto";

import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { escapeHtml, isTelegramConfigured, sendTelegramTo, telegramApi, telegramBotUsername } from "@/lib/telegram";

/**
 * Connecting someone's own Telegram, so notifications reach them there.
 *
 * Telegram lets a bot message a person only after they have opened it and
 * pressed Start. So "Connect Telegram" hands out a one-time link —
 * t.me/<bot>?start=<code> — and pressing Start sends the bot "/start <code>".
 * The app reads that from the bot's updates (getUpdates: no webhook, so no
 * fixed public address is needed) and ties the code's owner to that chat.
 */

/** How long a "Connect Telegram" link works. */
const LINK_TTL_MS = 15 * 60 * 1000;

export type TelegramStatus = {
  /** The server has a bot: Connect Telegram can be offered. */
  available: boolean;
  connected: boolean;
  /** Their Telegram @username, or their name there when they have none. */
  account: string | null;
};

export async function telegramStatus(userId: string): Promise<TelegramStatus> {
  if (!isTelegramConfigured()) return { available: false, connected: false, account: null };
  // A link handed out and not used yet: maybe they just pressed Start.
  const pending = await prisma.user.findFirst({
    where: { id: userId, telegramChatId: null, telegramLinkCode: { not: null } },
    select: { id: true },
  });
  if (pending) await readBotUpdates();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { telegramChatId: true, telegramUsername: true, telegramName: true },
  });
  return {
    available: true,
    connected: Boolean(user.telegramChatId),
    account: user.telegramChatId ? (user.telegramUsername ? `@${user.telegramUsername}` : user.telegramName) : null,
  };
}

/** A fresh one-time link to the bot; opening it and pressing Start connects them. */
export async function telegramConnectLink(userId: string): Promise<{ url: string }> {
  if (!isTelegramConfigured()) throw new HttpError(503, "Telegram is not set up on this server (TELEGRAM_BOT_TOKEN).");
  const bot = await telegramBotUsername();
  if (!bot) throw new HttpError(502, "Could not reach the Telegram bot. Try again in a moment.");
  // Letters and digits only: Telegram's start parameter allows no more.
  const code = randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  await prisma.user.update({
    where: { id: userId },
    data: { telegramLinkCode: code, telegramLinkExpiry: new Date(Date.now() + LINK_TTL_MS) },
  });
  return { url: `https://t.me/${bot}?start=${code}` };
}

export async function disconnectTelegram(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      telegramChatId: null,
      telegramUsername: null,
      telegramName: null,
      telegramLinkedAt: null,
      telegramLinkCode: null,
      telegramLinkExpiry: null,
    },
  });
}

type Update = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
};

/** The next update to ask for: everything before it has been handled. */
let nextUpdate = 0;
/** One read at a time — two would hand the same updates out twice. */
let reading: Promise<void> | null = null;

/** Handle what people sent the bot since the last read. */
export function readBotUpdates(): Promise<void> {
  reading ??= (async () => {
    try {
      const answer = await telegramApi<Update[]>(
        "getUpdates",
        { offset: nextUpdate, timeout: 0, allowed_updates: ["message"] },
        10_000,
      );
      if (!answer.ok) {
        // A webhook set on the bot makes getUpdates refuse (409).
        console.warn(`[telegram] getUpdates failed: ${answer.error_code ?? ""} ${answer.description ?? ""}`);
        return;
      }
      for (const update of answer.result ?? []) {
        nextUpdate = Math.max(nextUpdate, update.update_id + 1);
        await handleUpdate(update).catch((error) =>
          console.warn("[telegram] could not handle an update:", error instanceof Error ? error.message : error),
        );
      }
    } catch (error) {
      console.warn("[telegram] getUpdates failed:", error instanceof Error ? error.message : error);
    } finally {
      reading = null;
    }
  })();
  return reading;
}

/** "/start <code>" in a private chat: connect the code's owner to it. */
export async function handleUpdate(update: Update): Promise<void> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return;
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?/.exec(message.text.trim());
  if (!start) return;
  const chatId = String(message.chat.id);
  const code = start[1];

  const user = code
    ? await prisma.user.findFirst({
        where: { telegramLinkCode: code, telegramLinkExpiry: { gt: new Date() }, isActive: true },
        select: { id: true, name: true },
      })
    : null;
  if (!user) {
    await sendTelegramTo(
      chatId,
      code
        ? "This link has expired or was already used. In WeTestCase, open <b>Your account</b> and choose <b>Connect Telegram</b> again."
        : "To get your WeTestCase notifications here, open <b>Your account</b> in WeTestCase and choose <b>Connect Telegram</b>.",
    );
    return;
  }

  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null;
  await prisma.$transaction([
    // One person per Telegram: connecting it to another account moves it.
    prisma.user.updateMany({
      where: { telegramChatId: chatId, NOT: { id: user.id } },
      data: { telegramChatId: null, telegramUsername: null, telegramName: null, telegramLinkedAt: null },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: chatId,
        telegramUsername: message.from?.username ?? null,
        telegramName: name,
        telegramLinkedAt: new Date(),
        telegramLinkCode: null,
        telegramLinkExpiry: null,
      },
    }),
  ]);
  await sendTelegramTo(
    chatId,
    `✅ Connected to WeTestCase as <b>${escapeHtml(user.name)}</b>. Your notifications will arrive here.`,
  );
}

/** Someone blocked the bot or deleted the chat: it can no longer reach them. */
export async function dropTelegram(chatId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { telegramChatId: chatId },
    data: { telegramChatId: null, telegramLinkedAt: null },
  });
}
