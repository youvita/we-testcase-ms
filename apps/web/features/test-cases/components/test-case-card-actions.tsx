"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";

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
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import {
  setScriptCardShown,
  useScriptCardShown,
} from "@/features/automation/script-card-visibility";
import { cn } from "@/lib/utils";
import { AI_MODELS, AI_MODEL_LABELS, type AiJobDto, type AiModel } from "@wetestcase/dto";
import { ApiError, api, downloadFile, errorMessage } from "@/utils/api-client";

type Method = "ai" | "quick";

/**
 * The Test case card's own actions: the FRD — downloaded when the case has
 * one, written from the case when it has not — and, for a case not
 * automated yet, Automation, which adds the card to write its script.
 */
export function TestCaseCardActions({
  testCaseId,
  hasFrd,
  showAutomation,
  canManage,
}: {
  testCaseId: string;
  /** Linked to a requirement, so there is a document to download. */
  hasFrd: boolean;
  showAutomation: boolean;
  /** May write an FRD for a case without one. */
  canManage: boolean;
}) {
  const router = useRouter();
  const automationShown = useScriptCardShown();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [method, setMethod] = useState<Method>("ai");
  const [model, setModel] = useState<AiModel>("sonnet");
  const [starting, setStarting] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  async function downloadFrd() {
    try {
      await downloadFile(`/api/test-cases/${testCaseId}/frd`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  /** Once it is saved: hand it over, and let the page show the link. */
  async function ready() {
    await downloadFrd();
    router.refresh();
  }

  const [job, setJob] = useAiJob(null, (finished) => {
    if (finished.status === "SUCCEEDED") {
      toast.success("The FRD is ready — saved to Requirements → Documents");
      void ready();
    } else {
      toast.error(finished.error ?? "The AI could not write the FRD");
    }
  });
  const writing = isJobActive(job);

  async function generate() {
    setStarting(true);
    try {
      const result = await api.post<{ saved: true } | { job: AiJobDto }>(
        `/api/test-cases/${testCaseId}/frd`,
        { method, model: method === "ai" ? model : undefined },
      );
      setGenerateOpen(false);
      if ("job" in result) {
        setJob(result.job);
        toast.message("The AI is writing the FRD — it downloads when ready.");
      } else {
        toast.success("FRD saved to Requirements → Documents");
        await ready();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        setGenerateOpen(false);
        retryRef.current = () => void generate();
        setConnectOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setStarting(false);
    }
  }

  const canGenerate = !hasFrd && canManage;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={writing || (!hasFrd && !canManage)}
        title={
          hasFrd
            ? "Download the FRD this case comes from (.md)"
            : canGenerate
              ? "No FRD yet — write one from this test case"
              : "This case is not linked to a requirement document"
        }
        onClick={() => (hasFrd ? void downloadFrd() : setGenerateOpen(true))}
      >
        {writing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileText className="mr-2 size-4" />}
        {writing ? "Writing FRD…" : "FRD"}
      </Button>

      {/* Adds the Automation card to write a first script; the card's own
          Remove takes it away again, and this comes back. */}
      {showAutomation && !automationShown && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setScriptCardShown(true);
            // Let it render, then bring it into view.
            requestAnimationFrame(() =>
              document
                .getElementById("automation")
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
        >
          <Plus className="mr-2 size-4" />
          Automation
        </Button>
      )}

      <Dialog open={generateOpen} onOpenChange={(next) => !starting && setGenerateOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Write an FRD from this test case</DialogTitle>
            <DialogDescription>
              This case has no FRD yet. One is written from what the case checks, saved to
              Requirements → Documents with this case linked to it, and downloaded.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(
              [
                {
                  value: "ai",
                  icon: Sparkles,
                  label: "Written by AI",
                  hint: "Reads like a real FRD: purpose, rules, fields and validations, messages and open questions. Takes a minute.",
                },
                {
                  value: "quick",
                  icon: Zap,
                  label: "Quick",
                  hint: "The case laid out as a requirement — behaviour, acceptance criteria, open questions. Instant, no AI.",
                },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={method === option.value}
                onClick={() => setMethod(option.value)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/40",
                  method === option.value && "border-primary bg-primary/5",
                )}
              >
                <option.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </button>
            ))}

            {method === "ai" && (
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
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={starting} onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={starting} onClick={() => void generate()}>
              {starting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileText className="mr-2 size-4" />}
              Write FRD
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaudeConnectionDialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) retryRef.current = null;
        }}
        onConnected={() => {
          const retry = retryRef.current;
          retryRef.current = null;
          retry?.();
        }}
      />
    </div>
  );
}
