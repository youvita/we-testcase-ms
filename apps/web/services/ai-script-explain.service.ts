import type { ScriptExplainInput } from "@wetestcase/dto";

import { HttpError, notFound } from "@/lib/api";
import { AiError, askClaude } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";

import { requireClaudeToken } from "./claude-connection.service";

/**
 * "Explain with AI" on a test case's script: what the code — or the lines
 * picked out — does, in plain words for a tester, and follow-up questions on
 * it. Nothing is stored and the script is never changed here; a change goes
 * through "Keep trying" or "Rewrite with AI", which run what they write.
 */

/** Inside a request: the person is waiting, and the tunnel cuts at 100 s. */
const TIMEOUT_MS = 85_000;

const SYSTEM = `You explain Playwright test scripts to QA testers, product owners and developers. Many readers do not write code, so explain in plain words.

The runner wraps the script in a Playwright test: \`page\`, \`request\`, \`browser\`, \`expect\` and \`vars\` are in scope. \`vars.NAME\` is a variable set per environment on the project's Environments page (e.g. URLs, accounts, passwords); when one is unset the step using it cannot work.

How to answer:
- Answer the question asked. For "explain", say what the code does step by step, tied to the test case's steps where it matches ("Step 2 — signs in as the rejected tenant's user…"). Refer to code by line number ("line 74").
- Say what each check (\`expect\`) proves, and what it means when it fails.
- Point out anything that looks wrong or fragile: guesses at labels or buttons (regexes like /confirm|continue|verify/), \`.catch(() => false)\` that hides a missing element, steps that are skipped silently, variables it needs.
- Be short: a few sentences or a short list. No headings. Use \`backticks\` for code and names.
- If asked to change the code, show only the changed lines in a short snippet and say where they go; the person decides.
- Answer in the language the question is written in.
- Never invent what the application looks like: if you cannot know from the script and the test case, say so and what to check.`;

export async function explainScript(
  testCaseId: string,
  user: SessionUser,
  input: ScriptExplainInput,
): Promise<{ answer: string }> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { tcId: true, title: true, preconditions: true, steps: true, expectedResult: true, platform: true },
  });
  if (!testCase) throw notFound("Test case");
  const token = await requireClaudeToken(user.id);

  const numbered = input.code
    .split("\n")
    .map((line, index) => `${String(index + 1).padStart(3)} | ${line}`)
    .join("\n");
  const lineCount = input.code.split("\n").length;
  const picked =
    input.lines && input.lines.from <= lineCount
      ? `The person picked out lines ${input.lines.from}–${Math.min(input.lines.to, lineCount)}; the question is about those lines, read the rest for context.`
      : "The question is about the whole script.";
  const history = input.messages
    .slice(0, -1)
    .map((message) => `<${message.role}>\n${message.text}\n</${message.role}>`)
    .join("\n");

  const prompt = [
    `<test_case>\n${testCase.tcId} — ${testCase.title} (${testCase.platform})`,
    testCase.preconditions ? `Preconditions:\n${testCase.preconditions}` : "",
    testCase.steps ? `Steps:\n${testCase.steps}` : "",
    testCase.expectedResult ? `Expected result:\n${testCase.expectedResult}` : "",
    "</test_case>",
    `<script>\n${numbered}\n</script>`,
    picked,
    history ? `<conversation_so_far>\n${history}\n</conversation_so_far>` : "",
    `<question>\n${input.messages.at(-1)!.text}\n</question>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let reply: string;
  try {
    reply = await askClaude({ token, system: SYSTEM, prompt, maxTokens: 4_000, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HttpError(504, "The AI took too long. Try again, or pick fewer lines.");
    }
    if (error instanceof AiError) throw new HttpError(502, error.message);
    throw error;
  }
  return { answer: reply.trim() };
}
