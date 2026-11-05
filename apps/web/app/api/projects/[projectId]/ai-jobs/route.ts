import type { AiJobKind } from "@prisma/client";

import { ok, route } from "@/lib/api";
import { AI_JOB_KINDS } from "@wetestcase/dto";
import { assertProjectAccess } from "@/lib/project-access";
import { listJobs } from "@/services/ai-job.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Most a single request may ask for, for the full history view. */
const MAX_LIMIT = 100;

/**
 * `?kind=…` (repeatable) narrows the list to those kinds of job; `?limit=`
 * asks for more than the latest 10, up to 100.
 */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const search = new URL(request.url).searchParams;
  const kinds = search
    .getAll("kind")
    .filter((kind): kind is AiJobKind => (AI_JOB_KINDS as readonly string[]).includes(kind));
  const requested = Number(search.get("limit"));
  const limit =
    Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : undefined;
  return ok(await listJobs(projectId, { kinds: kinds.length ? kinds : undefined, limit }));
});
