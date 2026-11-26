import { ok, readJson, toErrorResponse, unauthorized } from "@/lib/api";
import { runPromptCreateSchema } from "@wetestcase/dto";
import { authorizeAsk, createPrompt } from "@/services/run-prompt.service";

type Ctx = { params: Promise<{ runId: string }> };

export const runtime = "nodejs";

/**
 * A script's ask("Enter the SMS code"), from the test process. Authorised by
 * the run's own ask token, never the runner's.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { runId } = await params;
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token || !(await authorizeAsk(runId, token))) throw unauthorized("Invalid ask token");
    const input = runPromptCreateSchema.parse(await readJson(request));
    return ok(await createPrompt(runId, input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
