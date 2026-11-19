"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Flame,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PlatformBadge } from "@/components/shared/priority-badge";
import { cn } from "@/lib/utils";
import {
  looksLikeSignIn,
  type RunEnvironmentDto,
  type SmokeTestCaseDto,
  type SmokeTestDto,
  type TestRunDto,
} from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

const NO_SIGN_IN = "none";

/**
 * Start a project's smoke test and open its run — from its card here, or the
 * project card, which leaves out the environment: the project's default.
 *
 * When nothing signs in, the server says so (409) and the person is asked
 * before it runs anyway. Render `dialog` wherever this is used.
 */
export function useSmokeTestRun() {
  const router = useRouter();
  const [warning, setWarning] = useState<{
    projectId: string;
    environmentId?: string;
    message: string;
  } | null>(null);

  async function run(
    projectId: string,
    environmentId?: string,
    withoutSignIn = false,
  ) {
    try {
      const started = await api.post<TestRunDto>(
        `/api/projects/${projectId}/smoke-test/run`,
        {
          environmentId,
          withoutSignIn,
        },
      );
      toast.success(
        `Smoke test queued — Run #${started.code}, ${started.total} case${started.total === 1 ? "" : "s"}`,
      );
      router.push(`/projects/${projectId}/automation/runs/${started.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && !withoutSignIn) {
        setWarning({ projectId, environmentId, message: error.message });
      } else {
        toast.error(errorMessage(error));
      }
    }
  }

  const dialog = (
    <ConfirmDialog
      open={warning !== null}
      onOpenChange={(open) => !open && setWarning(null)}
      title="Run without signing in?"
      description={warning?.message}
      confirmLabel="Run anyway"
      destructive={false}
      onConfirm={async () => {
        if (warning) await run(warning.projectId, warning.environmentId, true);
      }}
    />
  );

  return { run, dialog };
}

/**
 * The project's smoke test: the automated cases QA picks, in the order they
 * run. It runs one case at a time, every case even after a failure, against
 * the environment picked here (the default from the project card), and
 * records nothing on the cases.
 */
export function SmokeTestCard({
  projectId,
  smokeTest,
  automatedCases,
  signInCases,
  canManage,
  environments,
}: {
  projectId: string;
  smokeTest: SmokeTestDto;
  /** Every automated Web and API case, to add from. */
  automatedCases: SmokeTestCaseDto[];
  signInCases: { id: string; tcId: string; title: string }[];
  canManage: boolean;
  /** To run against; the default first. */
  environments: RunEnvironmentDto[];
}) {
  const router = useRouter();
  const smokeRun = useSmokeTestRun();
  // Picked for each run, not saved: the project card runs on the default.
  const [environmentId, setEnvironmentId] = useState(
    (environments.find((env) => env.isDefault) ?? environments[0])?.id ?? "",
  );
  const [cases, setCases] = useState(smokeTest.cases);
  const [signIn, setSignIn] = useState(
    smokeTest.signInTestCaseId ?? NO_SIGN_IN,
  );
  const signInCase = signInCases.find((c) => c.id === signIn);
  // None chosen: the run signs in with the first login case in the list.
  const autoSignIn =
    signIn === NO_SIGN_IN
      ? cases.find(
          (c) =>
            c.platform === "WEB" && c.hasScript && looksLikeSignIn(c.title),
        )
      : undefined;
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);

  const dirty =
    cases.map((c) => c.id).join() !== smokeTest.cases.map((c) => c.id).join() ||
    signIn !== (smokeTest.signInTestCaseId ?? NO_SIGN_IN);
  const runnable = cases.filter((c) => c.hasScript).length;

  function moveTo(from: number, to: number) {
    if (from === to || to < 0 || to >= cases.length) return;
    setCases((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  // Dragging by the grip: pointer events rather than HTML drag and drop, so
  // it works with touch too. The held row follows the pointer; the rows it
  // passes slide aside; the order changes only when it is let go, so nothing
  // jumps under the pointer.
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    /** Where it would land if let go now. */
    over: number;
    startY: number;
    dy: number;
    /** The held row's height: how far the rows it passes slide. */
    height: number;
    /** Each row's middle when the drag began. */
    middles: number[];
  } | null>(null);

  function startDrag(id: string, from: number, clientY: number) {
    const rects = cases.map((c) =>
      rowRefs.current.get(c.id)?.getBoundingClientRect(),
    );
    setDrag({
      id,
      from,
      over: from,
      startY: clientY,
      dy: 0,
      height: rects[from]?.height ?? 0,
      middles: rects.map((rect) => (rect ? rect.top + rect.height / 2 : 0)),
    });
  }

  function dragTo(clientY: number) {
    setDrag((current) => {
      if (!current) return current;
      const own = current.middles[current.from]!;
      // Kept within the list: no further than the first or last row.
      const dy = Math.min(
        Math.max(clientY - current.startY, current.middles[0]! - own),
        current.middles.at(-1)! - own,
      );
      // The held row's middle, against the other rows' middles.
      // A row gives way once the held row covers half of it: the held row's
      // leading edge passes that row's middle.
      const top = own + dy - current.height / 2;
      const bottom = own + dy + current.height / 2;
      let over = current.from;
      while (
        over < current.middles.length - 1 &&
        bottom > current.middles[over + 1]!
      )
        over += 1;
      while (over > 0 && top < current.middles[over - 1]!) over -= 1;
      return { ...current, dy, over };
    });
  }

  function endDrag() {
    if (drag) moveTo(drag.from, drag.over);
    setDrag(null);
  }

  /** A row's place as it would be if the held row were let go now. */
  function place(index: number): number {
    if (!drag) return index;
    if (index === drag.from) return drag.over;
    if (drag.from < drag.over && index > drag.from && index <= drag.over)
      return index - 1;
    if (drag.over < drag.from && index >= drag.over && index < drag.from)
      return index + 1;
    return index;
  }

  /** How far a row is moved while another is dragged. */
  function offset(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < drag.over && index > drag.from && index <= drag.over)
      return -drag.height;
    if (drag.over < drag.from && index >= drag.over && index < drag.from)
      return drag.height;
    return 0;
  }

  function discard() {
    setCases(smokeTest.cases);
    setSignIn(smokeTest.signInTestCaseId ?? NO_SIGN_IN);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put<SmokeTestDto>(`/api/projects/${projectId}/smoke-test`, {
        testCaseIds: cases.map((c) => c.id),
        signInTestCaseId: signIn === NO_SIGN_IN ? null : signIn,
      });
      toast.success("Smoke test saved");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    setRunning(true);
    await smokeRun.run(projectId, environmentId || undefined);
    setRunning(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="size-4 text-status-blocked" aria-hidden />
            Smoke test
          </CardTitle>
          <CardDescription>
            The cases that check the basics, in the order they run. One at a
            time, every case even after one fails. Results are not recorded on
            the cases.
          </CardDescription>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-2 size-4" />
              Add cases
            </Button>
            {signInCases.length > 0 && (
              <Select value={signIn} onValueChange={setSignIn}>
                <SelectTrigger
                  className="h-9 w-auto max-w-64 gap-2"
                  aria-label="Sign in once with"
                  title={
                    signInCase
                      ? `Sign in once with ${signInCase.tcId} — ${signInCase.title}`
                      : autoSignIn
                        ? `Signs in once with ${autoSignIn.tcId}, the login case in the list`
                        : "No sign-in case: Web cases start signed out"
                  }
                >
                  {/* Short in the bar: the full title is in the list. */}
                  <SelectValue>
                    <span className="text-muted-foreground">Sign in:</span>{" "}
                    {signInCase
                      ? signInCase.tcId
                      : autoSignIn
                        ? `auto · ${autoSignIn.tcId}`
                        : "none"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SIGN_IN}>
                    {autoSignIn
                      ? `Automatic — ${autoSignIn.tcId}, the login case in the list`
                      : "No sign-in case"}
                  </SelectItem>
                  {signInCases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.tcId} — {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {environments.length > 0 && (
              <Select value={environmentId} onValueChange={setEnvironmentId}>
                <SelectTrigger
                  className="h-9 w-auto min-w-36 gap-2"
                  aria-label="Environment to run against"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                      {env.isDefault && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          default
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              disabled={!environmentId || dirty || running || runnable === 0}
              title={
                !environmentId
                  ? "Add an environment first"
                  : dirty
                    ? "Save your changes first"
                    : runnable === 0
                      ? "Add automated cases first"
                      : undefined
              }
              onClick={() => void run()}
            >
              {running ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              Run smoke test
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {cases.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            No cases yet.
            {canManage &&
              " Add the automated cases that check the basics, then put them in order."}
          </p>
        ) : (
          <ol className="divide-y rounded-md border">
            {cases.map((c, index) => (
              <li
                key={c.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(c.id, node);
                  else rowRefs.current.delete(c.id);
                }}
                style={
                  drag
                    ? { transform: `translateY(${offset(index)}px)` }
                    : undefined
                }
                className={cn(
                  "flex items-center gap-3 bg-card px-3 py-2 text-sm",
                  // The others glide aside; the held one sticks to the pointer.
                  drag &&
                    drag.id !== c.id &&
                    "transition-transform duration-200 ease-out",
                  drag?.id === c.id &&
                    "relative z-10 rounded-md bg-muted shadow-lg",
                )}
              >
                {canManage && (
                  <button
                    type="button"
                    className={cn(
                      "-ml-1 shrink-0 touch-none rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      drag?.id === c.id ? "cursor-grabbing" : "cursor-grab",
                    )}
                    aria-label={`Drag to reorder ${c.tcId}, or use the arrow keys`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      startDrag(c.id, index, e.clientY);
                    }}
                    onPointerMove={(e) =>
                      drag?.id === c.id && dragTo(e.clientY)
                    }
                    onPointerUp={endDrag}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      moveTo(index, index + (e.key === "ArrowUp" ? -1 : 1));
                    }}
                  >
                    <GripVertical className="size-4" />
                  </button>
                )}
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {place(index) + 1}
                </span>
                <span className="shrink-0 font-mono text-xs">{c.tcId}</span>
                <span className="min-w-0 flex-1 truncate" title={c.title}>
                  {c.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.module}
                  </span>
                </span>
                {!c.hasScript && (
                  <span
                    className="shrink-0 text-xs text-status-blocked"
                    title="Skipped until it has a script"
                  >
                    no script
                  </span>
                )}
                <PlatformBadge platform={c.platform} className="shrink-0" />
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-muted-foreground"
                    aria-label={`Remove ${c.tcId} from the smoke test`}
                    onClick={() =>
                      setCases((current) =>
                        current.filter((x) => x.id !== c.id),
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}

        {/* Only when there is something to save. */}
        {canManage && dirty && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={discard}>
              Discard
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        )}
      </CardContent>

      {adding && (
        <AddCasesDialog
          automatedCases={automatedCases.filter(
            (c) => !cases.some((x) => x.id === c.id),
          )}
          onAdd={(picked) => setCases((current) => [...current, ...picked])}
          onClose={() => setAdding(false)}
        />
      )}
      {smokeRun.dialog}
    </Card>
  );
}

/** Pick automated cases to add at the end of the smoke test. */
function AddCasesDialog({
  automatedCases,
  onAdd,
  onClose,
}: {
  automatedCases: SmokeTestCaseDto[];
  onAdd: (cases: SmokeTestCaseDto[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // In the order picked: that is the order they are added in.
  const [picked, setPicked] = useState<string[]>([]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return automatedCases;
    return automatedCases.filter((c) =>
      [c.tcId, c.title, c.module].some((text) =>
        text.toLowerCase().includes(q),
      ),
    );
  }, [automatedCases, query]);

  function toggle(id: string, on: boolean) {
    setPicked((current) =>
      on ? [...current, id] : current.filter((x) => x !== id),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add cases to the smoke test</DialogTitle>
          <DialogDescription>
            Only cases with an automation script are listed. They are added at
            the end, in the order you tick them.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, title or module"
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {automatedCases.length === 0
                ? "Every automated case is already in the smoke test."
                : "No case matches."}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((c) => {
                const order = picked.indexOf(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                      <Checkbox
                        checked={order >= 0}
                        onCheckedChange={(on) => toggle(c.id, on === true)}
                      />
                      <span className="shrink-0 font-mono text-xs">
                        {c.tcId}
                      </span>
                      <span className="min-w-0 flex-1 truncate" title={c.title}>
                        {c.title}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.module}
                        </span>
                      </span>
                      {order >= 0 && (
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 font-mono text-xs text-primary">
                          {order + 1}
                        </span>
                      )}
                      <PlatformBadge
                        platform={c.platform}
                        className="shrink-0"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              const byId = new Map(automatedCases.map((c) => [c.id, c]));
              onAdd(picked.map((id) => byId.get(id)!));
              onClose();
            }}
          >
            Add {picked.length > 0 ? picked.length : ""} case
            {picked.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
