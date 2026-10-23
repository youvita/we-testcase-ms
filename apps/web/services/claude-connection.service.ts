import { prisma } from "@/lib/prisma";
import { badRequest, HttpError } from "@/lib/api";
import { AiError, askClaude, isAiConfigured } from "@/lib/claude";
import { open, seal } from "@/lib/secret-box";
import type { ClaudeConnectionStatus } from "@wetestcase/dto";

/**
 * People's Claude subscriptions.
 *
 * Only subscription tokens are accepted — `claude setup-token` prints them,
 * and they start `sk-ant-oat`. An API key (`sk-ant-api…`) is refused here, as
 * the bridge also refuses it: AI runs on each person's own plan.
 */

const TOKEN_PREFIX = "sk-ant-oat";

export async function getConnectionStatus(
  userId: string,
): Promise<ClaudeConnectionStatus> {
  const row = await prisma.claudeConnection.findUnique({
    where: { userId },
    select: { tokenHint: true, updatedAt: true },
  });
  return {
    aiConfigured: isAiConfigured(),
    connected: Boolean(row),
    tokenHint: row?.tokenHint ?? null,
    connectedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Check the token with one tiny call, then store it.
 *
 * Checked first so a typo or a revoked token is reported here, while the
 * person is looking at the dialog, rather than minutes later as a failed job.
 */
export async function connectClaude(userId: string, rawToken: string) {
  const token = rawToken.trim();
  if (token.startsWith("sk-ant-api")) {
    throw badRequest(
      "That is an API key. Paste the subscription token from `claude setup-token` instead.",
    );
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw badRequest(
      "That does not look like a subscription token — it should start with sk-ant-oat.",
    );
  }

  try {
    await askClaude({
      token,
      model: "haiku",
      maxTokens: 16,
      system: "Reply with the single word OK.",
      prompt: "OK?",
    });
  } catch (error) {
    throw badRequest(
      error instanceof AiError
        ? error.message
        : "Could not check the token with Claude.",
    );
  }

  const data = { tokenEncrypted: seal(token), tokenHint: token.slice(-4) };
  await prisma.claudeConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return getConnectionStatus(userId);
}

export async function disconnectClaude(userId: string) {
  await prisma.claudeConnection.deleteMany({ where: { userId } });
  return getConnectionStatus(userId);
}

/**
 * The token to run a person's AI work on.
 *
 * 412 rather than 400: nothing is wrong with the request, the person has a
 * step to take first, and the UI uses the status to offer the connect dialog.
 */
export async function requireClaudeToken(userId: string): Promise<string> {
  if (!isAiConfigured()) {
    throw new HttpError(503, "AI is not set up on this server (CLAUDE_BRIDGE_URL).");
  }
  const row = await prisma.claudeConnection.findUnique({
    where: { userId },
    select: { tokenEncrypted: true },
  });
  const token = row ? open(row.tokenEncrypted) : null;
  if (!token) {
    throw new HttpError(
      412,
      "Connect your Claude subscription first (account menu → Claude subscription).",
    );
  }
  return token;
}
