import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError, toErrorResponse, unauthorized } from "@/lib/api";

/**
 * Authentication for the runner service's calls (/api/runner/*).
 *
 * The runner is a machine, not a person, so it has no session: it sends
 * `Authorization: Bearer <RUNNER_TOKEN>`, the same secret both sides are
 * configured with. Unset on the app means automation is off and every runner
 * call is refused.
 */

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isRunnerRequest(request: Request): boolean {
  const expected = process.env.RUNNER_TOKEN?.trim();
  if (!expected) {
    throw new HttpError(503, "Automation is not set up on this server (RUNNER_TOKEN).");
  }
  const sent = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Hashing first makes the comparison constant-time whatever the lengths.
  return timingSafeEqual(digest(sent), digest(expected));
}

export function runnerRoute<C = unknown>(
  handler: (request: Request, context: C) => Promise<Response>,
) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      if (!isRunnerRequest(request)) throw unauthorized("Invalid runner token");
      return await handler(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function isAutomationConfigured() {
  return Boolean(process.env.RUNNER_TOKEN?.trim());
}
