import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { toRole, type Role } from "@/lib/constants";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  isActive: boolean;
};

/**
 * Read the current session. Wrapped in `cache()` so multiple calls inside one
 * render pass (layout + page + nav) hit the database once.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = session.user as typeof session.user & {
    role?: string | null;
    isActive?: boolean | null;
  };

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: toRole(user.role),
    isActive: user.isActive ?? true,
  };
});

/** Require a signed-in, active user or redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isActive) redirect("/login?error=account-disabled");
  return user;
}

/**
 * Send an already-signed-in visitor away from the auth pages.
 *
 * This decision cannot be made in middleware, which sees only whether a session
 * *cookie* exists. A cookie whose session has been revoked, cleaned up or wiped
 * with the database still looks signed in there — so bouncing on cookie presence
 * sent the visitor to a page that immediately redirected back to /login, and the
 * two ping-ponged until the browser gave up.
 *
 * The condition deliberately mirrors `requireUser`: a disabled account must fall
 * through to the login page rather than be sent to a dashboard that will refuse
 * it and bounce back here.
 */
export async function redirectIfSignedIn(): Promise<void> {
  const user = await getSessionUser();
  if (user?.isActive) redirect("/dashboard");
}

/**
 * Require one of `roles`. Renders the 403 page instead of redirecting so the
 * user understands they are signed in but not permitted.
 */
export async function requireRole(
  ...roles: readonly Role[]
): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}
