import { Ban, Check, CircleHelp } from "lucide-react";
import type { ExecutionStatus, FixStatus } from "@prisma/client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";
import type { ExecutionWithDetails, FixStatusEventWithActor } from "@/types";

type StageState = "done" | "current" | "pending";

/** Who moved a stage along, and when. Absent for stages nobody has reached. */
type Attribution = { by: string; at: Date } | null;

const STAGES = [
  { key: "failed", label: "QA failed" },
  { key: "investigating", label: "Developer investigating" },
  { key: "fixed", label: "Fix ready" },
  { key: "retesting", label: "QA retesting" },
  { key: "passed", label: "Passed" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

/**
 * Green for done, blue for where we are, grey for not yet.
 *
 * Deliberately not the execution-status palette: red/amber there mean a test
 * outcome, and reusing them would suggest "QA failed" is failing right now
 * rather than being a step already behind us.
 */
const MARKER_STYLES: Record<StageState, string> = {
  done: "border-transparent bg-status-passed text-white",
  current: "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pending: "border-dashed border-muted-foreground/40 text-muted-foreground",
};

const LABEL_STYLES: Record<StageState, string> = {
  done: "text-foreground",
  current: "font-semibold text-blue-600 dark:text-blue-400",
  pending: "text-muted-foreground",
};

/**
 * Where a failure has got to, as a five-step pipeline.
 *
 * The steps are derived, not stored: the app tracks the execution status (QA's)
 * and the fix status (the developer's), and the pipeline is what those two mean
 * together. Nothing extra to keep in sync, and no stage a user can leave stale
 * by forgetting to advance it.
 *
 * "QA retesting" is the waiting room after a developer flags a fix: the case
 * still reads Failed, and the next recorded execution resolves it. That
 * execution clears fixStatus, so a failed retest lands the case back at step
 * one — which is the correct story, not a bug.
 */
function resolveStages(
  status: ExecutionStatus,
  fixStatus: FixStatus,
): Record<StageKey, StageState> {
  const passed = status === "PASSED";
  const retesting = fixStatus === "RETESTING";
  // "Fix ready" stays behind us once QA picks the case up.
  const fixReady = fixStatus === "FIXED" || retesting;
  const investigated = fixReady || fixStatus === "INVESTIGATING";

  return {
    // A case only shows this timeline once it has failed, so step one is
    // always behind us.
    failed: "done",
    investigating: passed
      ? "done"
      : investigated
        ? fixReady
          ? "done"
          : "current"
        : "current",
    fixed: passed ? "done" : fixReady ? "done" : "pending",
    retesting: passed ? "done" : fixReady ? "current" : "pending",
    passed: passed ? "done" : "pending",
  };
}

/**
 * Attach "who and when" to the stages that have it.
 *
 * QA's stages come from the execution rows themselves; the developer's come
 * from the triage log. Events from before the current failure belong to a
 * previous round and are ignored, so a re-opened case does not show last
 * week's fix against this week's bug.
 */
function resolveAttribution(
  status: ExecutionStatus,
  fixStatus: FixStatus,
  executions: ExecutionWithDetails[],
  events: FixStatusEventWithActor[],
  currentFix: { by: string | null; at: Date | null },
): Record<StageKey, Attribution> {
  // Both arrays arrive newest-first.
  const failure = executions.find(
    (execution) =>
      execution.status === "FAILED" || execution.status === "BLOCKED",
  );
  const passing = status === "PASSED" ? executions[0] : undefined;

  // A round starts at the failure, or at the last time someone cleared the
  // update — whichever is later. Clearing wipes the slate: the events before it
  // describe a claim that has since been withdrawn.
  const lastClear = events.find(
    (candidate) =>
      candidate.fixStatus === "NONE" &&
      (!failure ||
        candidate.createdAt.getTime() >= failure.executedAt.getTime()),
  );
  const roundStart = Math.max(
    failure?.executedAt.getTime() ?? 0,
    lastClear?.createdAt.getTime() ?? 0,
  );

  const inThisRound = (at: Date) => at.getTime() >= roundStart;

  /**
   * The *first* time this round reached a stage, not the most recent.
   *
   * Withdrawing a retest writes a second "fix ready" event authored by QA;
   * taking the newest match would then credit QA with shipping the developer's
   * fix. Who got there first is the honest answer, and it does not move.
   */
  const firstEvent = (kind: FixStatus): Attribution => {
    // `events` arrives newest-first, so the last match is the earliest.
    const matches = events.filter(
      (candidate) =>
        candidate.fixStatus === kind && inThisRound(candidate.createdAt),
    );
    const event = matches[matches.length - 1];
    if (event) return { by: event.actor.name, at: event.createdAt };

    // Fallback for cases triaged before the event log existed: the row still
    // carries who set the *current* status and when.
    if (fixStatus === kind && currentFix.by && currentFix.at) {
      return { by: currentFix.by, at: currentFix.at };
    }
    return null;
  };

  return {
    failed: failure
      ? { by: failure.tester.name, at: failure.executedAt }
      : null,
    investigating: firstEvent("INVESTIGATING"),
    fixed: firstEvent("FIXED"),
    // Only while the claim actually stands. A withdrawn retest leaves its event
    // in the log, but the stage is back to "waiting for someone" and has no
    // name to put against it.
    retesting:
      fixStatus === "RETESTING" || passing ? firstEvent("RETESTING") : null,
    passed: passing ? { by: passing.tester.name, at: passing.executedAt } : null,
  };
}

export function FixTimeline({
  status,
  fixStatus,
  executions,
  events,
  fixStatusBy,
  fixStatusAt,
  action,
}: {
  status: ExecutionStatus;
  fixStatus: FixStatus;
  executions: ExecutionWithDetails[];
  events: FixStatusEventWithActor[];
  fixStatusBy: { name: string } | null;
  fixStatusAt: Date | null;
  action?: React.ReactNode;
}) {
  const currentFix = {
    by: fixStatusBy?.name ?? null,
    at: fixStatusAt,
  };
  // Two off-ramps that end the pipeline rather than advance it.
  if (fixStatus === "WONT_FIX" || fixStatus === "NOT_A_BUG") {
    const closed = fixStatus === "WONT_FIX";
    const attribution = resolveAttribution(
      status,
      fixStatus,
      executions,
      events,
      currentFix,
    );
    const closure = events.find((event) => event.fixStatus === fixStatus);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress</CardTitle>
          <CardDescription>
            {closed
              ? "Closed without a fix. See the discussion for the reason."
              : "Resolved as Working as Intended. The reported behavior is expected and does not require a product change. Please verify whether the test case should be updated."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol>
            <Stage
              label="QA failed"
              state="done"
              index={0}
              isLast={false}
              attribution={attribution.failed}
            />
            <li className="relative flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 bg-muted text-muted-foreground">
                {closed ? (
                  <Ban className="size-3.5" />
                ) : (
                  <CircleHelp className="size-3.5" />
                )}
              </span>
              <div className="min-w-0 space-y-1 pt-0.5">
                <p className="text-sm font-medium">
                  {closed ? "Won't fix" : "Not a bug"}
                </p>
                {closure ? (
                  <Meta by={closure.actor.name} at={closure.createdAt} />
                ) : (
                  currentFix.by &&
                  currentFix.at && (
                    <Meta by={currentFix.by} at={currentFix.at} />
                  )
                )}

                {/* The reason sits with the decision: closing a case overrules
                    a reported failure, and the next person to read this needs
                    to know on what grounds. */}
                {closure?.note && (
                  <p className="preserve-lines rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground">
                    {closure.note}
                  </p>
                )}
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  const states = resolveStages(status, fixStatus);
  const attribution = resolveAttribution(
    status,
    fixStatus,
    executions,
    events,
    currentFix,
  );
  const current = STAGES.find((stage) => states[stage.key] === "current");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Progress</CardTitle>
        <CardDescription>
          {status === "PASSED"
            ? "Resolved — the retest passed."
            : current
              ? `Waiting on: ${current.label}.`
              : "In progress."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Vertical: the card lives in the narrow column, where five stages
            side by side would wrap into an unreadable zigzag. */}
        <ol>
          {STAGES.map((stage, index) => (
            <Stage
              key={stage.key}
              label={stage.label}
              state={states[stage.key]}
              index={index}
              isLast={index === STAGES.length - 1}
              attribution={attribution[stage.key]}
            />
          ))}
        </ol>

        {action && <div className="pt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}

function Stage({
  label,
  state,
  index,
  isLast,
  attribution,
}: {
  label: string;
  state: StageState;
  index: number;
  isLast: boolean;
  attribution: Attribution;
}) {
  return (
    <li className={cn("relative flex gap-3", !isLast && "pb-5")}>
      {!isLast && (
        // From this marker's centre (size-6 → 12px) to the next one. Green only
        // once this step is behind us, so the line reads as a progress bar.
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0 left-3 top-6 w-px -translate-x-1/2",
            state === "done" ? "bg-status-passed" : "bg-border",
          )}
        />
      )}

      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
          MARKER_STYLES[state],
        )}
      >
        {state === "done" ? <Check className="size-3.5" /> : index + 1}
      </span>

      <div className="min-w-0 space-y-0.5 pt-0.5">
        <p className={cn("text-sm leading-none", LABEL_STYLES[state])}>
          {label}
        </p>
        {/* Never on a stage we have not reached: retracting an update leaves
            its event in the log, and a name under a greyed-out step would
            claim someone is there when nobody is. */}
        {state !== "pending" && attribution && (
          <Meta by={attribution.by} at={attribution.at} />
        )}
      </div>
    </li>
  );
}

function Meta({ by, at }: { by: string; at: Date }) {
  return (
    <div className="text-xs text-muted-foreground">
      <p className="truncate">Handled by · {by}</p>
      <p>Updated · {formatDateTime(at)}</p>
    </div>
  );
}
