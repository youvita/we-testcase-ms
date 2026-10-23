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

/**
 * Queue a run. With `testCaseIds` it runs exactly those cases (the "Run this
 * case" button); otherwise QA picks a scope.
 */
export function NewRunDialog({
  projectId,
  environments,
  modules = [],
  testCaseIds,
  open,
  onOpenChange,
}: {
  projectId: string;
  environments: RunEnvironmentDto[];
  modules?: { id: string; name: string }[];
  testCaseIds?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [scope, setScope] = useState<RunScope>(testCaseIds ? "cases" : "all");
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? "");
  const [recordResults, setRecordResults] = useState(true);
  const [busy, setBusy] = useState(false);

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
        moduleId: scope === "module" ? moduleId : undefined,
        testCaseIds,
        recordResults,
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
          <DialogTitle>{testCaseIds ? "Run this case" : "New run"}</DialogTitle>
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
                    {modules.length > 0 && <SelectItem value="module">One module</SelectItem>}
                  </SelectContent>
                </Select>
                {scope === "module" && (
                  <Select value={moduleId} onValueChange={setModuleId}>
                    <SelectTrigger aria-label="Module">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modules.map((mod) => (
                        <SelectItem key={mod.id} value={mod.id}>
                          {mod.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !selectedEnv} onClick={() => void handleStart()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
