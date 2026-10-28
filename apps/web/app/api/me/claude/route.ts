import { ok, readJson, route } from "@/lib/api";
import { claudeConnectSchema } from "@/lib/validations";
import {
  connectClaude,
  disconnectClaude,
  getConnectionStatus,
} from "@/services/claude-connection.service";

/** The signed-in person's own Claude subscription. Nobody else's is reachable. */

export const GET = route({}, async (_request, { user }) =>
  ok(await getConnectionStatus(user.id)),
);

/** Checking the token makes one small Claude call, so this can take a few seconds. */
export const POST = route({}, async (request, { user }) => {
  const { token } = claudeConnectSchema.parse(await readJson(request));
  return ok(await connectClaude(user.id, token));
});

export const DELETE = route({}, async (_request, { user }) =>
  ok(await disconnectClaude(user.id)),
);
