/**
 * Posting to the team's Telegram group, through a bot.
 *
 * Set TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (the group,
 * which the bot has been added to). Without both, nothing is sent.
 *
 * A message is a courtesy beside the in-app notification, never a step the
 * app waits on: sending happens after the work is saved, in the background,
 * and a failure is logged and dropped.
 */

const SEND_TIMEOUT_MS = 10_000;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

/** Text for Telegram's HTML mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A link into the app, from the address it is served at. */
export function appUrl(path: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL)?.trim().replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}

/** Send one message (Telegram HTML) to the group. Resolves whatever happens. */
export async function sendTelegram(html: string): Promise<void> {
  if (!isTelegramConfigured()) return;
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID!.trim(),
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[telegram] sendMessage failed: ${response.status} ${await response.text().catch(() => "")}`);
    }
  } catch (error) {
    console.warn("[telegram] sendMessage failed:", error instanceof Error ? error.message : error);
  }
}
