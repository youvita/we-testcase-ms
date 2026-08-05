import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/features/auth/components/login-form";
import { redirectIfSignedIn } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Checked here, not in middleware, so a stale cookie lands on the form
  // instead of ping-ponging with /dashboard.
  await redirectIfSignedIn();

  return (
    // Boundary for the form's useSearchParams. The route itself is dynamic —
    // reading the session above rules out static rendering.
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
