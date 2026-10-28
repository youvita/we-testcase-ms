import { ROLES } from "@/lib/constants";
import { badRequest, ok, readJson, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { assertTestCaseAccess } from "@/lib/project-access";
import { scriptContinueSchema } from "@/lib/validations";
import { startScriptWriting } from "@/services/ai-scripts.service";
import type { AiModel } from "@wetestcase/dto";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Keep the AI going from where an earlier script-writing job stopped, with
 * a hint from QA — same environment and start page as that job.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const body = scriptContinueSchema.parse(await readJson(request));

    const earlier = await prisma.aiJob.findUnique({
      where: { id: body.jobId },
      select: { input: true },
    });
    const earlierInput = (earlier?.input ?? {}) as {
      environmentId?: string;
      startPath?: string;
      instructions?: string;
      model?: AiModel;
      frdText?: string;
      frdName?: string;
    };
    if (!earlierInput.environmentId) throw badRequest("That job cannot be continued.");

    return ok(
      await startScriptWriting(testCaseId, user, {
        environmentId: earlierInput.environmentId,
        startPath: earlierInput.startPath,
        instructions: earlierInput.instructions,
        // The same model and FRD as the job it picks up from.
        model: earlierInput.model,
        frdText: earlierInput.frdText,
        frdName: earlierInput.frdName,
        liveView: body.liveView,
        speed: body.speed,
        continueFrom: { jobId: body.jobId, hint: body.hint },
      }),
      202,
    );
  },
);
