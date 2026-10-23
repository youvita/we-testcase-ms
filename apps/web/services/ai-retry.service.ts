import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/session";
import { exploreAppSchema, generateTestCasesSchema } from "@/lib/validations";
import type { AiJobDto } from "@wetestcase/dto";

import { startExploration } from "./ai-explore.service";
import { startExtraction, startGeneration } from "./ai-requirements.service";

/**
 * Start a failed job over with what it was asked to do, so a lapsed
 * subscription or a restart does not mean filling in the form again.
 *
 * The request goes through the same start function as the first time: the
 * documents, requirements and environment it names are checked again, and
 * the new job runs on the subscription of whoever asks.
 */
export async function retryJob(jobId: string, user: SessionUser): Promise<AiJobDto> {
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, input: true, docId: true, projectId: true },
  });
  if (!job) throw notFound("Job");
  if (job.status !== "FAILED") throw badRequest("Only a failed job can be tried again.");

  switch (job.kind) {
    case "EXTRACT_REQUIREMENTS":
      if (!job.docId) throw badRequest("The document this job read no longer exists.");
      return startExtraction(job.docId, user);
    case "GENERATE_TEST_CASES":
      return startGeneration(job.projectId, user, generateTestCasesSchema.parse(job.input));
    case "EXPLORE_APP":
      return startExploration(job.projectId, user, exploreAppSchema.parse(job.input));
    default:
      throw badRequest("Start this one again from where it was started.");
  }
}
