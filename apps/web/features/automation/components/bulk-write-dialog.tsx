"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import type { Platform, RunEnvironmentDto, ScriptBatchResult } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

export type BulkWriteCase = { id: string; tcId: string; platform: Platform; hasScript: boolean };

/**
 * Write scripts for several cases with Claude, one after another. A script
 * that passes against the environment can be saved straight away; anything
 * else waits on its case for review.
 */
export function BulkWriteDialog({
  projectId,
  cases,
  environments,
  open,
  onOpenChange,
  onStarted,
}: {
  projectId: string;
  cases: BulkWriteCase[];
  environments: RunEnvironmentDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (result: ScriptBatchResult) => void;
}) {
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  // Blank: the environment's own start page.
  const [startPath, setStartPath] = useState("");
  const [instructions, setInstructions] = useState("");
  const [skipScripted, setSkipScripted] = useState(true);
  const [autoSave, setAutoSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  const selectedEnv = environments.some((e) => e.id === environmentId)
    ? environmentId
    : (environments[0]?.id ?? "");
  const selectedEnvironment = environments.find((e) => e.id === selectedEnv);
  const envStart = selectedEnvironment?.startPath ?? "/";
  const automatable = cases.filter((c) => c.platform === "WEB" || c.platform === "API");
  const mobile = cases.length - automatable.length;
  const scripted = automatable.filter((c) => c.hasScript).length;
  const toWrite = skipScripted ? automatable.length - scripted : automatable.length;

  async function start() {
    setBusy(true);
    try {
      const result = await api.post<ScriptBatchResult>(`/api/projects/${projectId}/scripts/write`, {
        testCaseIds: cases.map((c) => c.id),
        environmentId: selectedEnv,
        startPath: startPath.trim() || undefined,
        instructions,
        skipScripted,
        autoSave,
      });
      onOpenChange(false);
      onStarted(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        retryRef.current = () => void start();
        setConnectOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Write scripts with Claude</DialogTitle>
            <DialogDescription>
              Claude writes each case&apos;s script against the environment — trying
              it and fixing it, as for a single case — one case after another.
            </DialogDescription>
          </DialogHeader>

          {environments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add an environment first, under Automation → Environments.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="font-medium">{toWrite}</span> of {cases.length} selected case
                {cases.length === 1 ? "" : "s"} will be written
                {mobile > 0 && ` · ${mobile} iOS/Android skipped`}
                {skipScripted && scripted > 0 && ` · ${scripted} already scripted, skipped`}
                {toWrite > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    About {Math.max(1, Math.round(toWrite * 1.5))}–{toWrite * 3} minutes. You can keep working;
                    progress shows above the test case list.
                  </span>
                )}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="space-y-2">
                  <Label htmlFor="bulk-start">Start page (optional)</Label>
                  <Input
                    id="bulk-start"
                    value={startPath}
                    onChange={(e) => setStartPath(e.target.value)}
                    placeholder={envStart}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Blank uses {selectedEnvironment?.name ?? "the environment"}&apos;s ({envStart}).
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bulk-notes">Notes for every case (optional)</Label>
                <Textarea
                  id="bulk-notes"
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Sign in with vars.LOGIN_ID and vars.LOGIN_PASSWORD first."
                />
              </div>

              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={skipScripted} onCheckedChange={(v) => setSkipScripted(v === true)} />
                <span>
                  Skip cases that already have a script
                  <span className="block text-xs text-muted-foreground">Off, Claude rewrites them too.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={autoSave} onCheckedChange={(v) => setAutoSave(v === true)} />
                <span>
                  Save scripts that pass
                  <span className="block text-xs text-muted-foreground">
                    A script that passed against {environments.find((e) => e.id === selectedEnv)?.name ?? "the environment"} is
                    saved on its case. Anything else — still failing, a likely product bug, or needing
                    information — waits on the case for you to review.
                  </span>
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !selectedEnv || toWrite === 0} onClick={() => void start()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
              Write {toWrite} script{toWrite === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaudeConnectionDialog
        open={connectOpen}
        onOpenChange={(next) => {
          setConnectOpen(next);
          if (!next) retryRef.current = null;
        }}
        onConnected={() => {
          const retry = retryRef.current;
          retryRef.current = null;
          retry?.();
        }}
      />
    </>
  );
}
