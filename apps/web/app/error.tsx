"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Global error boundary. Most failures reaching here are database connectivity
 * problems, so the copy points at the most likely cause.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error:", error);
  }, [error]);

  const looksLikeDbIssue =
    /database|prisma|connect|ECONNREFUSED|DATABASE_URL/i.test(error.message);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-lg space-y-5 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" aria-hidden />
        </span>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            {looksLikeDbIssue
              ? "The app could not reach the database. Check that PostgreSQL is running and that DATABASE_URL is correct, then try again."
              : (error.message ||
                "An unexpected error occurred while rendering this page.")}
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          )}
        </div>

        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
