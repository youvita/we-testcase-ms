/**
 * Telegram notifications.
 *
 * One bot posting to one group: the team's. The app writes there when a
 * discussion needs someone who is not looking at the app — a new comment on a
 * test case, a question put to the product owner — because nobody sits on a
 * test case page waiting for one to arrive.
 *
 * Both settings unset means notifications are off and every call here is a
 * no-op, which is the normal state for a local checkout. A deployment that
 * loses the setting goes quiet rather than failing.
 */

const SEND_TIMEOUT_MS = 8_000;

/** Telegram rejects anything longer. */
const MAX_MESSAGE_CHARS = 4096;

function settings() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export function isTelegramConfigured(): boolean {
  return settings() !== null;
}

/**
 * A link back to the page, when this deployment has a fixed address.
 *
 * On the free Quick Tunnel the hostname changes every restart, so
 * NEXT_PUBLIC_APP_URL is empty there and the message simply carries no link —
 * better than one that 404s a week later.
 */
export function appLink(path: string): string | null {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!origin) return null;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim().replace(/\/$/, "");
  return `${origin}${base}${path}`;
}

/**
 * Post to the group. Never throws: a notification is a courtesy, and Telegram
 * being down must not turn someone's comment into a failed request. Callers
 * run this after the response has gone out, so there is nobody left to tell
 * and the log is the only record.
 *
 * Sent as plain text on purpose — no parse_mode, so a stray underscore or
 * bracket in a comment cannot make Telegram reject the whole message.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  const config = settings();
  if (!config) return false;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: text.slice(0, MAX_MESSAGE_CHARS),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      // Telegram's body says why ("chat not found", "bot was kicked"), which
      // is the only way to tell a misconfiguration from a passing blip.
      const reason = await response.text().catch(() => "");
      console.error(`[telegram] ${response.status} ${reason.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[telegram] could not send: ${reason}`);
    return false;
  }
}
