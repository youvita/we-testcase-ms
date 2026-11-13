import { improveWritingSchema } from "@wetestcase/dto";

import { ok, readJson, route } from "@/lib/api";
import { improveWriting } from "@/services/ai-writing.service";

/**
 * Fix the spelling and grammar of a comment, question or reply before it is
 * posted. Returns the new text; nothing is stored.
 */
export const POST = route({}, async (request, { user }) => {
  const { text } = improveWritingSchema.parse(await readJson(request));
  return ok(await improveWriting(text, user));
});
