import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Cheap edge gate: bounce anonymous traffic away from app pages and signed-in
 * traffic away from the auth pages.
 *
 * This only checks that a session cookie is *present* — it deliberately does no
 * database work, so it must not be treated as authorization. Every page and API
 * route re-validates the session and the user's role server-side via
 * `requireUser`/`requireRole` (lib/session.ts) or `route()` (lib/api.ts).
 */
const AUTH_ROUTES = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isAuthRoute) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where the user was heading so login can send them back.
    if (pathname !== "/") loginUrl.searchParams.set("redirect", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Page routes only. `/api/*` is deliberately excluded: an unauthenticated
     * fetch must get a JSON 401 from `route()`, not an HTML login redirect.
     * Next internals and static assets are excluded for cost.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
