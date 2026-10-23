"use client";

import { useEffect, useRef, useState } from "react";

import type { AiJobDto } from "@wetestcase/dto";
import { api } from "@/utils/api-client";

const POLL_MS = 3000;

export function isJobActive(job: AiJobDto | null | undefined) {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

/**
 * Follow one AI job: poll it while it is queued or running, and call
 * `onFinished` once when it ends.
 */
export function useAiJob(
  initial: AiJobDto | null,
  onFinished?: (job: AiJobDto) => void,
) {
  const [job, setJob] = useState(initial);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  // A new job from the server (or from starting one) replaces the old.
  useEffect(() => setJob(initial), [initial]);

  const active = isJobActive(job);
  const jobId = job?.id;

  useEffect(() => {
    if (!active || !jobId) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.get<AiJobDto>(`/api/ai-jobs/${jobId}`);
        setJob(next);
        if (!isJobActive(next)) finishedRef.current?.(next);
      } catch {
        // Retried on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, jobId]);

  return [job, setJob] as const;
}
