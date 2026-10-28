"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RunEnvironmentDto, RunScope, TestRunDto } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import type { SubModuleOption } from "@/types";

import { WatchLiveFields, type LiveChoice } from "./live-view";

const NO_SIGN_IN = "none";

/**
 * Queue a run. With `testCaseIds` it runs exactly those cases ("Run this
 * case", "Run selected"); otherwise QA picks a scope — every case, the failing
 * ones, or a group of modules such as Login and Customer — or parts of them,
 * such as Customer › Create.
 */
export function NewRunDialog({
  projectId,
  environments,
  modules = [],
  subModules = [],
  signInCases = [],
  testCaseIds,
  open,
  onOpenChange,
}: {
  projectId: string;
  environments: RunEnvironmentDto[];
  modules?: { id: string; name: string }[];
  /** Offered under their module, to run part of it. */
  subModules?: SubModuleOption[];
  /** Automated Web cases that can sign in before each case. */
  signInCases?: { id: string; tcId: string; title: string }[];
  testCaseIds?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [scope, setScope] = useState<RunScope>(testCaseIds ? "cases" : "all");
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  /** Parts of modules not chosen whole, as `${moduleId}\n${name}`. */
  const [subKeys, setSubKeys] = useState<string[]>([]);
  const chosenSubModules = subKeys
    .map((key) => {
      const [moduleId, name] = key.split("\n") as [string, string];
      return { moduleId, name };
    })
    .filter((sub) => !moduleIds.includes(sub.moduleId));
  const nothingChosen = moduleIds.length === 0 && chosenSubModules.length === 0;
  const [signIn, setSignIn] = useState(NO_SIGN_IN);
  const [inOrder, setInOrder] = useState(false);
  const [recordResults, setRecordResults] = useState(true);
  const [live, setLive] = useState<LiveChoice>({ liveView: false, speed: "slow" });
  const [busy, setBusy] = useState(false);
  const signInCase = signInCases.find((c) => c.id === signIn);
  const signInLabel = signInCase ? `With ${signInCase.tcId} — ${signInCase.title}` : undefined;

  // An environment deleted while the dialog was closed must not stay selected.
  const selectedEnv = environments.some((e) => e.id === environmentId)
    ? environmentId
    : (environments[0]?.id ?? "");

  async function handleStart() {
    setBusy(true);
    try {
      const run = await api.post<TestRunDto>(`/api/projects/${projectId}/test-runs`, {
        environmentId: selectedEnv,
        scope: testCaseIds ? "cases" : scope,
        moduleIds: scope === "module" ? moduleIds : undefined,
        subModules: scope === "module" ? chosenSubModules : undefined,
        testCaseIds,
        recordResults,
        setupTestCaseId: signIn === NO_SIGN_IN ? null : signIn,
        inOrder,
        liveView: live.liveView,
        speed: live.liveView ? live.speed : "normal",
      });
      toast.success(`Run #${run.number} queued — ${run.total} case${run.total === 1 ? "" : "s"}`);
      onOpenChange(false);
      router.push(`/projects/${projectId}/automation/runs/${run.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {!testCaseIds
              ? "New run"
              : testCaseIds.length === 1
                ? "Run this case"
                : `Run ${testCaseIds.length} selected cases`}
          </DialogTitle>
          <DialogDescription>
            The runner executes the scripts with Playwright and reports each
            result with a screenshot and a trace.
          </DialogDescription>
        </DialogHeader>

        {environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an environment first, under Automation → Environments.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={selectedEnv} onValueChange={setEnvironmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {testCaseIds && testCaseIds.length > 1 && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Only the selected cases that have a Web or API script run; the rest are left out.
              </p>
            )}

            {!testCaseIds && (
              <div className="space-y-2">
                <Label>Cases</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as RunScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every automated case</SelectItem>
                    <SelectItem value="failed">Automated cases that are failing</SelectItem>
                    {modules.length > 0 && <SelectItem value="module">Chosen modules</SelectItem>}
                  </SelectContent>
                </Select>
                {scope === "module" && (
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {modules.map((mod) => {
                      const whole = moduleIds.includes(mod.id);
                      return (
                        <div key={mod.id} className="space-y-1">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={whole}
                              onCheckedChange={(checked) =>
                                setModuleIds((ids) =>
                                  checked ? [...ids, mod.id] : ids.filter((id) => id !== mod.id),
                                )
                              }
                            />
                            {mod.name}
                          </label>
                          {subModules
                            .filter((sub) => sub.moduleId === mod.id)
                            .map((sub) => {
                              const key = `${mod.id}\n${sub.name}`;
                              return (
                                <label
                                  key={key}
                                  className="ml-6 flex items-center gap-2 text-sm text-muted-foreground"
                                >
                                  <Checkbox
                                    // The whole module includes every part of it.
                                    checked={whole || subKeys.includes(key)}
                                    disabled={whole}
                                    onCheckedChange={(checked) =>
                                      setSubKeys((keys) =>
                                        checked ? [...keys, key] : keys.filter((k) => k !== key),
                                      )
                                    }
                                  />
                                  {sub.name}
                                </label>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {signInCases.length > 0 && (
              <div className="space-y-2">
                <Label>Sign in first</Label>
                <Select value={signIn} onValueChange={setSignIn}>
                  <SelectTrigger title={signInLabel}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SIGN_IN}>No — each script signs in itself</SelectItem>
                    {signInCases.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        With {c.tcId} — {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Its script runs at the start of every Web case, so cases like
                  &ldquo;create a new customer&rdquo; need no login steps of their own.
                </p>
              </div>
            )}

            {(!testCaseIds || testCaseIds.length > 1) && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={inOrder}
                  onCheckedChange={(checked) => setInOrder(checked === true)}
                />
                <span>
                  Run one at a time, in order
                  <span className="block text-xs text-muted-foreground">
                    For cases that build on each other — create a customer, then
                    find it. Off, cases run two at a time, independently.
                  </span>
                </span>
              </label>
            )}

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={recordResults}
                onCheckedChange={(checked) => setRecordResults(checked === true)}
              />
              <span>
                Record results on the test cases
                <span className="block text-xs text-muted-foreground">
                  Passes and failures become executions, like a manual run. Turn
                  off to try scripts without touching results.
                </span>
              </span>
            </label>

            <WatchLiveFields value={live} onChange={setLive} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !selectedEnv || (scope === "module" && !testCaseIds && nothingChosen)}
            onClick={() => void handleStart()}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
