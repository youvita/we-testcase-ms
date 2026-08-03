import { FlaskConical } from "lucide-react";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens where it would just push the form down. */}
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/10">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <span className="text-base font-semibold">TestCase MS</span>
        </div>

        <div className="max-w-md space-y-4">
          <h2 className="text-2xl font-semibold leading-snug">
            Stop updating Excel files during testing.
          </h2>
          <p className="text-sm leading-relaxed text-white/70">
            Import the test case templates your team already uses, execute them
            online, and give developers a live view of what is failing — without
            anyone emailing a spreadsheet again.
          </p>
          <ul className="space-y-2 text-sm text-white/70">
            <li>• Excel import that keeps your existing columns</li>
            <li>• Real-time execution progress per module</li>
            <li>• Read-only developer access to failed cases</li>
            <li>• Excel and PDF reports on demand</li>
          </ul>
        </div>

        <p className="text-xs text-white/40">
          Phase 1 — test case management, not bug tracking.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
