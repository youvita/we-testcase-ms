import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { getSessionUser, type SessionUser } from "@/lib/session";
import type { Role } from "@/lib/constants";

/**
 * Shared response envelope so every client call can be parsed the same way.
 */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: string;
  /** Field-level messages, keyed by form field name. */
  fieldErrors?: Record<string, string[]>;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>(
    { ok: true, data },
    typeof init === "number" ? { status: init } : init,
  );
}

export function fail(
  error: string,
  status = 400,
  fieldErrors?: Record<string, string[]>,
) {
  return NextResponse.json<ApiFailure>(
    { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) },
    { status },
  );
}

/** Thrown by services/handlers to produce a specific HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") =>
  new HttpError(404, `${what} not found`);
export const forbidden = (message = "You do not have permission to do that") =>
  new HttpError(403, message);
export const unauthorized = (message = "You must be signed in") =>
  new HttpError(401, message);
export const conflict = (message: string) => new HttpError(409, message);
export const badRequest = (message: string) => new HttpError(400, message);

/**
 * Translate any thrown value into a safe JSON response. Prisma and Zod errors
 * get useful messages; anything else is logged and reported generically so
 * internals never leak to the client.
 */
export function toErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return fail(error.message, error.status);
  }

  if (error instanceof ZodError) {
    return fail("Validation failed", 422, error.flatten().fieldErrors as Record<string, string[]>);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.join(", ") : "field";
      return fail(`A record with this ${fields} already exists`, 409);
    }
    if (error.code === "P2025") {
      return fail("Record not found", 404);
    }
    if (error.code === "P2003") {
      return fail("Related record is missing or still in use", 409);
    }
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Error && error.message.includes("Can't reach database"))
  ) {
    console.error("[api] database unavailable:", error);
    return fail(
      "Cannot reach the database. Check DATABASE_URL and that Postgres is running.",
      503,
    );
  }

  console.error("[api] unhandled error:", error);
  return fail("Something went wrong. Please try again.", 500);
}

type Handler<C> = (
  request: Request,
  context: C & { user: SessionUser },
) => Promise<Response>;

/**
 * Wrap a route handler with authentication, role checking and error handling.
 *
 * `route` keeps handlers focused on the happy path — they may throw HttpError
 * (or let Prisma/Zod throw) and still produce a correct response.
 */
export function route<C = unknown>(
  options: { roles?: readonly Role[] },
  handler: Handler<C>,
) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      if (!user.isActive) throw forbidden("Your account has been disabled");

      if (options.roles && !options.roles.includes(user.role)) {
        throw forbidden();
      }

      return await handler(request, { ...(context as C), user });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** Parse a JSON body, converting malformed payloads into a 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}
