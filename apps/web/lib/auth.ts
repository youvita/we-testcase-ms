import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/constants";

/**
 * Origins allowed to call auth (sign-in / sign-up).
 *
 * Better Auth rejects mismatched Origin with 403. Free Cloudflare tunnels use
 * a random `https://*.trycloudflare.com` host that is empty in env, so we always
 * allow that pattern plus localhost. Optional fixed hosts still come from env.
 *
 * Better Auth also reads comma-separated BETTER_AUTH_TRUSTED_ORIGINS.
 */
const trustedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.BETTER_AUTH_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  // Free Quick Tunnel (URL changes every tunnel restart)
  "https://*.trycloudflare.com",
  process.env.VERCEL_PROJECT_PRODUCTION_URL &&
    `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  process.env.VERCEL_BRANCH_URL && `https://${process.env.VERCEL_BRANCH_URL}`,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  appName: "TestCase MS",
  secret: process.env.BETTER_AUTH_SECRET,

  /**
   * Left undefined when unset rather than defaulting to localhost.
   *
   * Undefined lets Better Auth use the request's own origin (correct for free
   * tunnels and for local dev). Set BETTER_AUTH_URL to a fixed public https
   * origin when you have a stable domain.
   */
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  // Next.js strips app basePath from the inbound request URL, so the server
  // auth mount stays at /api/auth. The browser client uses /cases/api/auth.
  basePath: "/api/auth",
  trustedOrigins,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Phase 1 has no mail transport; accounts are usable immediately and an
    // Admin manages who exists. Turn this on once SMTP is wired up.
    requireEmailVerification: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the cookie at most once a day
  },

  // Scope cookies to /cases when sharing one Cloudflare host with SecureScan.
  advanced: {
    defaultCookieAttributes: {
      path: process.env.BASE_PATH?.replace(/\/$/, "") || "/",
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: ROLES.QA,
        // Critical: `input: false` stops a client from choosing its own role
        // during sign-up. Roles are assigned by an Admin only.
        input: false,
      },
      isActive: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },

  // NOTE: id generation is intentionally left to Better Auth. The auth tables
  // in schema.prisma declare `id String @id` with no database default, so
  // disabling `advanced.database.generateId` here would make every insert fail.

  // Must stay last: lets server actions and route handlers set auth cookies.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
