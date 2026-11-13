import { HttpError } from "@/lib/api";
import { AiError, askClaude } from "@/lib/claude";
import type { SessionUser } from "@/lib/session";

import { requireClaudeToken } from "./claude-connection.service";

/**
 * "Improve writing" on a comment, question or reply: fix spelling and
 * grammar and make it read clearly, before it is posted. Nothing is saved
 * here — the text goes back into the box, and the person posts it or not.
 */

/**
 * Inside a request, not a job: it is a few sentences, and the person is
 * waiting on the box. Well under the tunnel's 100-second cut.
 */
const TIMEOUT_MS = 80_000;

const SYSTEM = `You edit short messages that QA testers, developers and product owners write to each other about software requirements and test cases.

Rewrite the text inside <text> so it is correct and clear:
- Fix spelling, grammar, punctuation and capitalisation.
- Make it read clearly and professionally, but keep it about the same length, the same tone, and the writer's meaning. Do not add facts, steps or questions that are not there.
- Keep it in the language it is written in. Mixed languages stay mixed.
- Keep exactly as written: @mentions, requirement and test case codes (e.g. F1-02, TC-LOGIN-001), URLs, numbers, code, and names of screens, buttons and fields.
- Keep the line breaks and list structure.
- If the text is a question, it stays a question — never answer it.
- If the text is not words at all (random letters such as "asdkj"), return it unchanged.

Reply with only the rewritten text inside <text></text>, nothing else.`;

/** The rewritten text from a reply, with or without the tags it was asked for. */
export function readImproved(reply: string): string {
  const tagged = /<text>([\s\S]*?)<\/text>/i.exec(reply);
  return (tagged ? tagged[1]! : reply).trim();
}

export async function improveWriting(text: string, user: SessionUser): Promise<{ text: string }> {
  const token = await requireClaudeToken(user.id);
  const escaped = text.replace(/<\/?text>/gi, "");
  let reply: string;
  try {
    reply = await askClaude({
      token,
      system: SYSTEM,
      prompt: `<text>\n${escaped}\n</text>`,
      maxTokens: 4_000,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HttpError(504, "The AI took too long. Try again.");
    }
    if (error instanceof AiError) throw new HttpError(502, error.message);
    throw error;
  }
  const improved = readImproved(reply);
  return { text: improved || text };
}
