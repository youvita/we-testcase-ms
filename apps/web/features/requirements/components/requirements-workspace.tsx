"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import type {
  AiJobDto,
  Platform,
  PoQuestionDto,
  RunEnvironmentDto,
  RequirementDocDto,
  RequirementDto,
  TestCaseDraftDto,
} from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

import { AiJobList, REQUIREMENT_JOBS_QUERY, isSubscriptionError } from "./ai-job-list";
import { DocumentsPanel } from "./documents-panel";
import { DraftsPanel } from "./drafts-panel";
import { ExploreAppDialog, type SignInCase } from "./explore-app-dialog";
import { RequirementsPanel } from "./requirements-panel";
import type { Focus, PoContext } from "./po-questions";

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
  canVerify = false,
  environments,
  signInCases,
  openExplore = false,
  questions,
  po,
  focus,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  requirements: RequirementDto[];
  drafts: TestCaseDraftDto[];
  jobs: AiJobDto[];
  platforms: Platform[];
  canManage: boolean;
  /** An admin — the PO — who verifies requirements. */
  canVerify?: boolean;
  environments: RunEnvironmentDto[];
  signInCases: SignInCase[];
  /** Arrived with ?explore=1: open "Explore the app" straight away. */
  openExplore?: boolean;
  /** Questions for the PO about requirements and pending drafts. */
  questions: PoQuestionDto[];
  po: PoContext;
  focus?: Focus;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [tab, setTab] = useState(
    focus?.tab ??
      (openExplore || drafts.length > 0 ? "drafts" : docs.length === 0 ? "documents" : "requirements"),
  );
  // A notification opened while already on this page changes only the URL.
  const focusTab = focus?.tab;
  const focusId = focus?.id;
  useEffect(() => {
    if (focusTab) setTab(focusTab);
  }, [focusTab, focusId]);
  const [exploreOpen, setExploreOpen] = useState(openExplore);
  const canExplore = platforms.includes("WEB");
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
        next = await api.get<AiJobDto[]>(`/api/projects/${projectId}/ai-jobs?${REQUIREMENT_JOBS_QUERY}`);
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
          if (job.kind === "GENERATE_TEST_CASES" || job.kind === "EXPLORE_APP") setTab("drafts");
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
      toast.message("The AI is working on it — you can keep using the page.");
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

  /**
   * Start a failed job over. When the subscription was the problem, connect
   * it first — the same request would only be refused again.
   */
  const retryJob = useCallback(
    async (job: AiJobDto) => {
      const start = () => api.post<AiJobDto>(`/api/ai-jobs/${job.id}/retry`);
      if (isSubscriptionError(job.error)) {
        retryRef.current = () => void startAi(start);
        setConnectOpen(true);
        return;
      }
      await startAi(start);
    },
    [startAi],
  );

  const activeDocIds = new Set(
    jobs.filter((job) => isActive(job) && job.docId).map((job) => job.docId!),
  );
  const generating = jobs.some(
    (job) => isActive(job) && job.kind === "GENERATE_TEST_CASES",
  );

  return (
    <div className="space-y-4">
      <AiJobList projectId={projectId} jobs={jobs} onRetry={canManage ? retryJob : undefined} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requirements">
            Requirements ({requirements.filter((req) => req.status === "ACTIVE").length})
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
            canVerify={canVerify}
            generating={generating}
            startAi={startAi}
            onOpenDocuments={() => setTab("documents")}
            questions={questions.filter((question) => question.requirementId)}
            po={po}
            focusId={focus?.tab === "requirements" ? focus.id : undefined}
          />
        </TabsContent>

        <TabsContent value="drafts" className="mt-4">
          <DraftsPanel
            projectId={projectId}
            drafts={drafts}
            platforms={platforms}
            canManage={canManage}
            onExplore={canExplore ? () => setExploreOpen(true) : undefined}
            onOpenRequirements={() => setTab("requirements")}
            questions={questions.filter((question) => question.draftId)}
            po={po}
            focusId={focus?.tab === "drafts" ? focus.id : undefined}
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
    </div>
  );
}
