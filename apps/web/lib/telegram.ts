/**
 * The Telegram bot. Each person connects their own Telegram from Your account
 * (see telegram-link.service) and gets their notifications as private
 * messages from the bot — nothing goes to a group.
 *
 * Set TELEGRAM_BOT_TOKEN (from @BotFather). Without it, nothing is sent and
 * Connect Telegram is not offered.
 *
 * A message is a courtesy beside the in-app notification, never a step the
 * app waits on: sending happens after the work is saved, in the background,
 * and a failure is logged and dropped.
 */

import { withBasePath } from "@/lib/base-path";
import { publicUrlOrNull, rememberedPublicOrigin } from "@/lib/public-origin";

const SEND_TIMEOUT_MS = 10_000;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

/** Text for Telegram's HTML mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A link into the app: from its fixed public address when one is set, or —
 * on a free tunnel, whose address changes — the address people's requests
 * last came in on, under the app's base path.
 */
export function appUrl(path: string): string | null {
  const fixed = publicUrlOrNull(process.env.NEXT_PUBLIC_APP_URL) ?? publicUrlOrNull(process.env.BETTER_AUTH_URL);
  if (fixed) return `${fixed}${path}`;
  const seen = rememberedPublicOrigin();
  return seen ? `${seen}${withBasePath(path)}` : null;
}

/** One call to the Bot API. Throws on a network failure; returns Telegram's answer. */
export async function telegramApi<T>(
  method: string,
  body: Record<string, unknown> = {},
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<{ ok: boolean; result?: T; error_code?: number; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }))) as {
    ok: boolean;
    result?: T;
    error_code?: number;
    description?: string;
  };
}

/**
 * Send one private message (Telegram HTML) to someone's chat with the bot.
 * "blocked": they blocked the bot or deleted the chat — it can no longer
 * reach them, and their connection should be dropped.
 */
export async function sendTelegramTo(chatId: string, html: string): Promise<"sent" | "blocked" | "failed"> {
  if (!isTelegramConfigured()) return "failed";
  try {
    const answer = await telegramApi("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    if (answer.ok) return "sent";
    console.warn(`[telegram] sendMessage failed: ${answer.error_code ?? ""} ${answer.description ?? ""}`);
    return answer.error_code === 403 ? "blocked" : "failed";
  } catch (error) {
    console.warn("[telegram] sendMessage failed:", error instanceof Error ? error.message : error);
    return "failed";
  }
}

let botName: Promise<string | null> | null = null;

/** The bot's @username, for its t.me link. Asked once, then remembered. */
export function telegramBotUsername(): Promise<string | null> {
  botName ??= telegramApi<{ username?: string }>("getMe")
    .then((answer) => answer.result?.username ?? null)
    .catch(() => null)
    .then((name) => {
      if (!name) botName = null; // try again next time
      return name;
    });
  return botName;
}
