"use client";

import { createAuthClient } from "better-auth/react";

/**
 * No localhost fallback: `NEXT_PUBLIC_*` is inlined at build time, so a missing
 * value would ship a bundle that posts credentials to http://localhost:3000
 * from a deployed site. Left undefined, the client uses `window.location.origin`
 * — correct on localhost, production and every preview URL alike.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || undefined,
});

export const { signIn, signUp, signOut, useSession, changePassword, updateUser } =
  authClient;
