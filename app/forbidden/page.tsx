import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/constants";

export const metadata = { title: "Not permitted" };

export default async function ForbiddenPage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-5 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldX className="size-6" aria-hidden />
        </span>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold">You do not have access</h1>
          <p className="text-sm text-muted-foreground">
            {user ? (
              <>
                Your account has the {ROLE_LABELS[user.role]} role —{" "}
                {ROLE_DESCRIPTIONS[user.role].toLowerCase()}. Ask an
                administrator if you need broader access.
              </>
            ) : (
              "Sign in to continue."
            )}
          </p>
        </div>

        <Button asChild>
          <Link href={user ? "/dashboard" : "/login"}>
            {user ? "Back to dashboard" : "Sign in"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
