"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import type {
  AiJobDto,
  Platform,
  RequirementDocDto,
  RequirementDto,
  TestCaseDraftDto,
} from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

import { AiJobList } from "./ai-job-list";
import { DocumentsPanel } from "./documents-panel";
import { DraftsPanel } from "./drafts-panel";
import { RequirementsPanel } from "./requirements-panel";

export type StartAi = (start: () => Promise<AiJobDto>) => Promise<boolean>;

const POLL_MS = 3000;

function isActive(job: AiJobDto) {
  return job.status === "QUEUED" || job.status === "RUNNING";
}

/**
 * Everything on the requirements page below the stats.
 *
 * Owns the two things every panel shares: the AI jobs (polled while any is
 * running, with a refresh of the page's data when one finishes) and the
 * "connect your Claude subscription" detour, which re-runs the action that
 * needed it once the person has connected.
 */
export function RequirementsWorkspace({
  projectId,
  docs,
  requirements,
  drafts,
  jobs: initialJobs,
  platforms,
  canManage,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  requirements: RequirementDto[];
  drafts: TestCaseDraftDto[];
  jobs: AiJobDto[];
  platforms: Platform[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [tab, setTab] = useState(
    docs.length === 0 ? "documents" : drafts.length > 0 ? "drafts" : "requirements",
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  // Server data changed (router.refresh) — take its job list as the new truth.
  useEffect(() => setJobs(initialJobs), [initialJobs]);

  // Read by the poll, which must compare against the latest list without
  // restarting its timer each time the list changes.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const anyActive = jobs.some(isActive);

  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(async () => {
      let next: AiJobDto[];
      try {
        next = await api.get<AiJobDto[]>(
          `/api/projects/${projectId}/ai-jobs?kind=EXTRACT_REQUIREMENTS&kind=GENERATE_TEST_CASES`,
        );
      } catch {
        return; // A missed poll is retried on the next tick.
      }

      const wasActive = new Set(
        jobsRef.current.filter(isActive).map((job) => job.id),
      );
      const finished = next.filter(
        (job) => wasActive.has(job.id) && !isActive(job),
      );
      jobsRef.current = next;
      setJobs(next);

      for (const job of finished) {
        if (job.status === "SUCCEEDED") {
          toast.success(job.summary ?? "Done");
          if (job.kind === "GENERATE_TEST_CASES") setTab("drafts");
          if (job.kind === "EXTRACT_REQUIREMENTS") setTab("requirements");
        } else {
          toast.error(job.error ?? "The AI job failed");
        }
      }
      if (finished.length > 0) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, projectId, router]);

  /**
   * Start an AI job. A missing subscription opens the connect dialog and
   * retries on success, so the person never has to find the button again.
   */
  const startAi: StartAi = useCallback(async (start) => {
    try {
      const job = await start();
      setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)]);
      toast.message("Claude is working on it — you can keep using the page.");
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
  }, []);

  const activeDocIds = new Set(
    jobs.filter((job) => isActive(job) && job.docId).map((job) => job.docId!),
  );
  const generating = jobs.some(
    (job) => isActive(job) && job.kind === "GENERATE_TEST_CASES",
  );

  return (
    <div className="space-y-4">
      <AiJobList jobs={jobs} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requirements">
            Requirements ({requirements.length})
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Review drafts
            {drafts.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {drafts.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents ({docs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements" className="mt-4">
          <RequirementsPanel
            projectId={projectId}
            docs={docs}
            requirements={requirements}
            platforms={platforms}
            canManage={canManage}
            generating={generating}
            startAi={startAi}
            onOpenDocuments={() => setTab("documents")}
          />
        </TabsContent>

        <TabsContent value="drafts" className="mt-4">
          <DraftsPanel
            projectId={projectId}
            drafts={drafts}
            platforms={platforms}
            canManage={canManage}
            onOpenRequirements={() => setTab("requirements")}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocumentsPanel
            projectId={projectId}
            docs={docs}
            canManage={canManage}
            activeDocIds={activeDocIds}
            startAi={startAi}
          />
        </TabsContent>
      </Tabs>

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
