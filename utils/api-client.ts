import type { ApiResult } from "@/lib/api";

/** Error thrown by `apiFetch` carrying the server's status and field errors. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Typed fetch against this app's API routes.
 *
 * Unwraps the `{ ok, data }` envelope and turns any failure into an ApiError, so
 * callers can `try/catch` instead of checking shapes at every call site.
 */
export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      // FormData must set its own multipart boundary — only add JSON headers
      // when we are actually sending JSON.
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  let payload: ApiResult<T> | null = null;
  try {
    payload = (await response.json()) as ApiResult<T>;
  } catch {
    // Non-JSON response (a proxy error page, for instance).
    throw new ApiError(
      response.ok
        ? "The server returned an unreadable response"
        : `Request failed with status ${response.status}`,
      response.status,
    );
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const failure = payload && payload.ok === false ? payload : null;
    throw new ApiError(
      failure?.error ?? `Request failed with status ${response.status}`,
      response.status,
      failure?.fieldErrors,
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(url: string) => apiFetch<T>(url),
  post: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  patch: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  /** `body` is for collection deletes (e.g. "delete these ids"). */
  delete: <T>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method: "DELETE",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Trigger a browser download for a report endpoint.
 *
 * Uses fetch rather than a plain link so an error response surfaces as a toast
 * instead of the browser navigating to a JSON error page.
 */
export async function downloadFile(url: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    let message = `Download failed with status ${response.status}`;
    try {
      const body = (await response.json()) as ApiResult<never>;
      if (body.ok === false) message = body.error;
    } catch {
      /* keep the status message */
    }
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();

  // Prefer the server's filename from Content-Disposition.
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? "download";

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
