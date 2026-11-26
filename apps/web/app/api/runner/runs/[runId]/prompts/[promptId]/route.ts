import { ok, toErrorResponse, unauthorized } from "@/lib/api";
import { authorizeAsk, takeAnswer } from "@/services/run-prompt.service";

type Ctx = { params: Promise<{ runId: string; promptId: string }> };

export const runtime = "nodejs";

/** The script checking for its answer: waiting, expired, or the value (once). */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { runId, promptId } = await params;
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token || !(await authorizeAsk(runId, token))) throw unauthorized("Invalid ask token");
    return ok(await takeAnswer(runId, promptId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
