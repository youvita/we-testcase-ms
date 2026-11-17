import { FlaskConical } from "lucide-react";

/**
 * Sign in and sign up: one card in the middle of the screen, the name above
 * it. (It was a split screen — a brand panel on the left and the form in the
 * middle of the right half — which left the form off to one side.)
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-sidebar px-4 py-10">
      {/* A soft light from above, so the dark is not flat. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(56rem 28rem at 50% -8%, rgb(255 255 255 / 0.09), transparent 65%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center text-white">
          <span className="flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-lg font-semibold tracking-tight">WeTestCase</p>
            <p className="text-sm text-white/60">
              Plan, run and track your test cases in one place.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-background p-6 text-foreground shadow-2xl ring-1 ring-black/5 sm:p-8">
          {children}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Test case management for QA, developers and product owners.
        </p>
      </div>
    </div>
  );
}
