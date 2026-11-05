import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";

/** What the PO still has to confirm about a case, set apart from its own text. */
export function OpenQuestions({
  text,
  className,
  action,
}: {
  text: string;
  className?: string;
  /** Beside the heading: "Ask the PO", where asking is possible. */
  action?: ReactNode;
}) {
  return (
    <div className={cn("rounded-md border border-status-blocked/30 bg-status-blocked/5 px-3 py-2 text-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-blocked">
          <CircleHelp className="size-3.5" aria-hidden />
          Open questions — ask the product owner
        </p>
        {action}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </div>
  );
}
