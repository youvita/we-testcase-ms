import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { poQuestionSchema } from "@/lib/validations";
import { askPoQuestion, listPoQuestions } from "@/services/clarification.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Questions about the project's requirements and pending drafts. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listPoQuestions(projectId));
});

/**
 * Ask the PO — one admin, or every admin — about a requirement or a draft.
 * QA asks; admins are the POs who answer.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const input = poQuestionSchema.parse(await readJson(request));
    return ok(await askPoQuestion(projectId, user, input), 201);
  },
);
