"use client";

import { useState } from "react";
import { Compass, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AI_MODELS,
  AI_MODEL_LABELS,
  type AiJobDto,
  type AiModel,
  type GenerationDepth,
  type RunEnvironmentDto,
} from "@wetestcase/dto";
import { api } from "@/utils/api-client";

import type { StartAi } from "./requirements-workspace";
import { NoEnvironmentHint } from "@/features/environments/components/no-environment-hint";

export type SignInCase = { id: string; tcId: string; title: string };

const NO_SIGN_IN = "none";

/**
 * Suggest test cases by looking at the app itself. The runner opens the
 * pages — after signing in with an automated case, for pages behind login —
 * and Claude suggests cases from what it sees.
 */
export function ExploreAppDialog({
  projectId,
  environments,
  signInCases,
  open,
  onOpenChange,
  startAi,
}: {
  projectId: string;
  environments: RunEnvironmentDto[];
  signInCases: SignInCase[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAi: StartAi;
}) {
  const webEnvironments = environments.filter((env) => env.webBaseUrl);
  const [environmentId, setEnvironmentId] = useState(webEnvironments[0]?.id ?? "");
  // Null until edited: until then the box shows the environment's start page.
  const [pathsEdited, setPathsEdited] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(NO_SIGN_IN);
  const [depth, setDepth] = useState<GenerationDepth>("essential");
  const [model, setModel] = useState<AiModel>("sonnet");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const signInCase = signInCases.find((c) => c.id === signIn);
  const signInLabel = signInCase ? `With ${signInCase.tcId} — ${signInCase.title}` : undefined;

  const selectedEnv = webEnvironments.some((e) => e.id === environmentId)
    ? environmentId
    : (webEnvironments[0]?.id ?? "");
  const paths =
    pathsEdited ?? webEnvironments.find((e) => e.id === selectedEnv)?.startPath ?? "/";
  const pathList = paths
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  async function start() {
    setBusy(true);
    try {
      const started = await startAi(() =>
        api.post<AiJobDto>(`/api/projects/${projectId}/explore`, {
          environmentId: selectedEnv,
          paths: pathList,
          setupTestCaseId: signIn === NO_SIGN_IN ? null : signIn,
          depth,
          model,
          instructions,
        }),
      );
      if (started) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Explore the app</DialogTitle>
          <DialogDescription>
            The runner opens these pages in a real browser and the AI suggests
            test cases from what is on them — no document needed. Suggestions
            wait in Review drafts for you to accept.
          </DialogDescription>
        </DialogHeader>

        {webEnvironments.length === 0 ? (
          <NoEnvironmentHint projectId={projectId}> with a Web base URL</NoEnvironmentHint>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={selectedEnv} onValueChange={setEnvironmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {webEnvironments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name} — {env.webBaseUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="explore-paths">Pages to look at</Label>
              <Textarea
                id="explore-paths"
                rows={3}
                value={paths}
                onChange={(e) => setPathsEdited(e.target.value)}
                placeholder={"/kh/login\n/kh/register"}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                One path per line, after the base URL — up to five.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Sign in first</Label>
              <Select value={signIn} onValueChange={setSignIn}>
                <SelectTrigger title={signInLabel}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SIGN_IN}>No — the pages are public</SelectItem>
                  {signInCases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      Run {c.tcId} first — {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                For pages behind login, pick an automated case that signs in;
                its script runs before the pages are opened.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <Label>How many</Label>
                <Select value={depth} onValueChange={(v) => setDepth(v as GenerationDepth)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="essential">Main checks</SelectItem>
                    <SelectItem value="thorough">Full coverage</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {depth === "essential"
                    ? "About 4–8 cases per page: the main flows and the most important errors. Best to start with."
                    : "Every field's validation, limits, states and navigation. Many more drafts to review."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>AI model</Label>
                <Select value={model} onValueChange={(value) => setModel(value as AiModel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {AI_MODEL_LABELS[option].label} — {AI_MODEL_LABELS[option].hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="explore-notes">Focus (optional)</Label>
                <Textarea
                  id="explore-notes"
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Focus on field validation."
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !selectedEnv || pathList.length === 0 || pathList.length > 5}
            onClick={() => void start()}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Compass className="mr-2 size-4" />}
            Explore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
