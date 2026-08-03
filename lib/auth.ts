import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/constants";

/**
 * Origins allowed to call the auth endpoints.
 *
 * Better Auth seeds this from `baseURL` and rejects any other `Origin` with a
 * 403, so a deployment whose real host is not listed cannot sign in at all.
 * Vercel's own variables are included because preview deployments get a fresh
 * hostname every time and could never be configured by hand.
 */
const trustedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
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
   * `getBaseURL` treats an explicit value as final, so a hardcoded fallback
   * would pin every deployment to http://localhost:3000 — and with it the
   * trusted-origin list, which is what makes sign-in fail anywhere else.
   * Undefined lets Better Auth fall back to BETTER_AUTH_URL and then to the
   * incoming request's own origin.
   */
  baseURL: process.env.BETTER_AUTH_URL,
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
