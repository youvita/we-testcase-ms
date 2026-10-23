import type { AiJobKind } from "@prisma/client";

import { ok, route } from "@/lib/api";
import { AI_JOB_KINDS } from "@wetestcase/dto";
import { assertProjectAccess } from "@/lib/project-access";
import { listJobs } from "@/services/ai-job.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** `?kind=…` (repeatable) narrows the list to those kinds of job. */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const kinds = new URL(request.url).searchParams
    .getAll("kind")
    .filter((kind): kind is AiJobKind => (AI_JOB_KINDS as readonly string[]).includes(kind));
  return ok(await listJobs(projectId, { kinds: kinds.length ? kinds : undefined }));
});
