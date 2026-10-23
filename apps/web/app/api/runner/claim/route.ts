import { NextResponse } from "next/server";

import { ok } from "@/lib/api";
import { runnerRoute } from "@/lib/runner-auth";
import { claimNextRun } from "@/services/test-run.service";

/**
 * The runner asks for work. 204 when the queue is empty; otherwise the run,
 * its environment (secrets included — this route answers only the runner)
 * and the scripts to execute.
 */
export const POST = runnerRoute(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { runner?: unknown };
  const runner = typeof body.runner === "string" ? body.runner.slice(0, 80) : "runner";
  const job = await claimNextRun(runner);
  if (!job) return new NextResponse(null, { status: 204 });
  return ok(job);
});
