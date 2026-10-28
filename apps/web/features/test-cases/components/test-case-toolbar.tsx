"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import {
  ExploreAppDialog,
  type SignInCase,
} from "@/features/requirements/components/explore-app-dialog";
import type { StartAi } from "@/features/requirements/components/requirements-workspace";
import type { AiJobDto, ExploreAppResult, RunEnvironmentDto } from "@wetestcase/dto";
import { ApiError, errorMessage } from "@/utils/api-client";
import type { Platform, SubModuleOption } from "@/types";

import { ImportDialog } from "./import-dialog";
import {
  TestCaseFormDialog,
  type ModuleOption,
} from "./test-case-form-dialog";

/**
 * "Explore the app", "Import" and "New test case" for the test case list
 * header.
 *
 * Owns the dialogs so the page itself can stay a server component. Exploring
 * runs here, without leaving the list; when Claude has suggestions, they open
 * in Review drafts.
 */
export function TestCaseToolbar({
  projectId,
  modules,
  subModules,
  platforms,
  environments,
  signInCases,
}: {
  projectId: string;
  modules: ModuleOption[];
  subModules: SubModuleOption[];
  platforms: Platform[];
  environments: RunEnvironmentDto[];
  signInCases: SignInCase[];
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const router = useRouter();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const [exploreJob, setExploreJob] = useAiJob(null, (job) => {
    const drafted = (job.result as ExploreAppResult | null)?.drafted ?? 0;
    if (job.status !== "SUCCEEDED") {
      toast.error(job.error ?? "Exploring the app failed");
    } else if (drafted === 0) {
      toast.message(job.summary ?? "The AI found nothing new to suggest");
    } else {
      toast.success(job.summary ?? "Suggestions are ready");
      router.push(`/projects/${projectId}/requirements`);
    }
  });
  const exploring = isJobActive(exploreJob);

  const startAi: StartAi = useCallback(async (start) => {
    try {
      setExploreJob(await start());
      toast.message("The AI is exploring the app — stay here; the suggestions open when they are ready.");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        retryRef.current = () => void startAi(start);
        setConnectOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
      return false;
    }
  }, [setExploreJob]);

  return (
    <>
      {platforms.includes("WEB") && (
        <Button variant="outline" disabled={exploring} onClick={() => setExploreOpen(true)}>
          {exploring ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 size-4" />
          )}
          {exploring
            ? `Exploring the app${exploreJob && exploreJob.progressTotal > 0 ? ` ${exploreJob.progressDone}/${exploreJob.progressTotal}` : "…"}`
            : "Explore the app"}
        </Button>
      )}

      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <FileUp className="mr-2 size-4" />
        Import Excel
      </Button>

      {/* Enabled even with no modules: the dialog creates the first one itself,
          so a new project is not a dead end here. */}
      <Button onClick={() => setFormOpen(true)}>
        <Plus className="mr-2 size-4" />
        New test case
      </Button>

      <ImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
      />

      <ExploreAppDialog
        projectId={projectId}
        environments={environments}
        signInCases={signInCases}
        open={exploreOpen}
        onOpenChange={setExploreOpen}
        startAi={startAi}
      />

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

      <TestCaseFormDialog
        projectId={projectId}
        modules={modules}
        subModules={subModules}
        platforms={platforms}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </>
  );
}
