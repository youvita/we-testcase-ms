import { aiChatSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { startChat } from "@/services/ai-chat.service";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Ask the requirements chat a question. Answers as a stream of JSON lines: the
 * headers go out at once and the reply shows as it is written, so unlike the
 * AI jobs this needs no polling and the tunnel's 100-second limit on a
 * response does not apply. An error after the first byte arrives as an
 * `error` line.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const input = aiChatSchema.parse(await readJson(request));
    return startChat(projectId, input, user);
  },
);
