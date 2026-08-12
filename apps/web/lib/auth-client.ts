"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Never pin auth to a build-time public URL unless the env is a real absolute
 * HTTPS (or http) origin. Baking `http://localhost:3000` into the Docker image
 * made trycloudflare.com pages POST credentials to the user's laptop (broken).
 *
 * Empty / unset → Better Auth uses `window.location.origin` (login/register
 * work on free tunnels and any host).
 *
 * With Next.js basePath (/cases), the client must call /cases/api/auth while the
 * server still sees /api/auth (Next strips basePath from the request URL).
 */
function publicAppOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return undefined;
  // Ignore accidental localhost bake-ins that break public reverse proxies.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(raw)) {
    return undefined;
  }
  return raw.replace(/\/$/, "");
}

function authBasePath(): string {
  const prefix = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
  return `${prefix}/api/auth`;
}

export const authClient = createAuthClient({
  baseURL: publicAppOrigin(),
  basePath: authBasePath(),
});

export const { signIn, signUp, signOut, useSession, changePassword, updateUser } =
  authClient;
