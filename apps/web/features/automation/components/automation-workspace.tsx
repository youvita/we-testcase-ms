"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import type { RunEnvironmentDto, TestRunDto } from "@wetestcase/dto";
import { formatRelative } from "@/utils/format";

import { EnvironmentsPanel } from "./environments-panel";
import { NewRunDialog } from "./new-run-dialog";
import { RunStatusBadge, formatDuration, isRunActive } from "./run-status-badge";

const POLL_MS = 3000;

export function AutomationWorkspace({
  projectId,
  runs,
  environments,
  modules,
  automatedCount,
  signInCases,
  canManage,
  runnerConfigured,
}: {
  projectId: string;
  runs: TestRunDto[];
  environments: RunEnvironmentDto[];
  modules: { id: string; name: string }[];
  automatedCount: number;
  signInCases: { id: string; tcId: string; title: string }[];
  canManage: boolean;
  runnerConfigured: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(environments.length === 0 ? "environments" : "runs");
  const [newRunOpen, setNewRunOpen] = useState(false);

  // While anything is queued or running, refresh the server data so counts
  // and statuses move without a reload.
  const anyActive = runs.some((run) => isRunActive(run.status));
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, router]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="environments">Environments ({environments.length})</TabsTrigger>
        </TabsList>
        {canManage && (
          <Button
            disabled={automatedCount === 0 || environments.length === 0}
            onClick={() => setNewRunOpen(true)}
          >
            <Play className="mr-2 size-4" />
            New run
          </Button>
        )}
      </div>

      {!runnerConfigured && (
        <p className="mt-4 rounded-md border border-status-blocked/30 bg-status-blocked/10 px-3 py-2 text-sm">
          Automation is not switched on for this server: <code className="font-mono">RUNNER_TOKEN</code>{" "}
          is not set, so runs will wait in the queue. An admin needs to set it and start the runner.
        </p>
      )}

      <TabsContent value="runs" className="mt-4">
        {runs.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No runs yet"
            description={
              automatedCount === 0
                ? "Open a Web or API test case and write its Playwright script under Automation. Cases with a script can then be run here."
                : `${automatedCount} case${automatedCount === 1 ? " has" : "s have"} a script. Add an environment and start a run.`
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Run</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Started by</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} className="cursor-pointer" onClick={() => router.push(`/projects/${projectId}/automation/runs/${run.id}`)}>
                    <TableCell className="font-medium">
                      <Link href={`/projects/${projectId}/automation/runs/${run.id}`} onClick={(e) => e.stopPropagation()}>
                        #{run.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="text-status-passed">{run.passed} passed</span>
                      {run.failed > 0 && <span className="text-status-failed"> · {run.failed} failed</span>}
                      {run.errored > 0 && <span className="text-status-blocked"> · {run.errored} error</span>}
                      <span className="text-muted-foreground"> / {run.total}</span>
                    </TableCell>
                    <TableCell className="text-sm">{run.environmentName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {run.createdBy.name} · {formatRelative(run.createdAt)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {run.startedAt && run.finishedAt
                        ? formatDuration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="environments" className="mt-4">
        <EnvironmentsPanel projectId={projectId} environments={environments} canManage={canManage} />
      </TabsContent>

      <NewRunDialog
        projectId={projectId}
        environments={environments}
        modules={modules}
        signInCases={signInCases}
        open={newRunOpen}
        onOpenChange={setNewRunOpen}
      />
    </Tabs>
  );
}
