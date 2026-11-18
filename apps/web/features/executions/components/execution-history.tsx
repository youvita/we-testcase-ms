"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ClipboardCopy, History, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCardHeader } from "@/components/shared/collapsible-card-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, initials } from "@/utils/format";
import { bugReportText, type BugReportInput } from "@/utils/bug-report";
import type { ExecutionWithDetails } from "@/types";

import { AttachmentGallery } from "./attachment-gallery";
import { useExecutionEditor } from "./execution-editor-context";

/**
 * Execution log, newest first.
 *
 * This is the audit trail developers rely on, so it renders every recorded
 * attempt rather than collapsing to the latest one.
 *
 * Clicking an entry you recorded loads it into the Record result card, which
 * doubles as the editor — one form for both jobs, so the fields and their
 * validation cannot drift apart. The tester and the timestamp are not editable
 * there: they say who ran the test and when, which a correction does not
 * change. Every correction is stamped and shown as "edited".
 */
export function ExecutionHistory({
  projectId,
  executions,
  currentUserId,
  canModerate = false,
  bugReportCase,
  developerResponded = false,
}: {
  /** Needed to link automated results to their run. */
  projectId?: string;
  /** The case, for "Copy bug report" on a failed or blocked result. */
  bugReportCase?: BugReportInput["testCase"];
  executions: ExecutionWithDetails[];
  currentUserId?: string;
  canModerate?: boolean;
  /**
   * A developer has answered the latest result (investigating, fixed, …):
   * it stays, since they are working from it.
   */
  developerResponded?: boolean;
}) {
  // Null on pages with no Record result card (the developer's read-only view),
  // which is exactly when entries should not be clickable.
  const editor = useExecutionEditor();
  // Closed by default, like Script & Claude; the header says how many results.
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CollapsibleCardHeader
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        title={
          <>
            <History className="size-4" />
            Execution history
          </>
        }
        description={
          executions.length === 0
            ? "No results recorded yet."
            : `${executions.length} recorded result${executions.length === 1 ? "" : "s"}, newest first.`
        }
      />

      {expanded && (
        <CardContent>
          {executions.length === 0 ? (
            <EmptyState
              icon={History}
              title="Not executed yet"
              description="Once a result is recorded it appears here with the tester, timestamp and any screenshots or video."
            />
          ) : (
            <ol className="space-y-4">
              {executions.map((execution, index) => (
                <ExecutionEntry
                  key={execution.id}
                  projectId={projectId}
                  execution={execution}
                  bugReportCase={bugReportCase}
                  isLatest={index === 0}
                  editable={
                    Boolean(editor) &&
                    (canModerate || execution.tester.id === currentUserId)
                  }
                  onEdit={() => editor?.startEditing(execution)}
                  locked={index === 0 && developerResponded}
                />
              ))}
            </ol>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ExecutionEntry({
  projectId,
  execution,
  bugReportCase,
  isLatest,
  editable,
  onEdit,
  locked,
}: {
  projectId?: string;
  execution: ExecutionWithDetails;
  bugReportCase?: BugReportInput["testCase"];
  isLatest: boolean;
  editable: boolean;
  onEdit: () => void;
  /** Not deletable: a developer is working from it. */
  locked: boolean;
}) {
  const router = useRouter();
  const editor = useExecutionEditor();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/api/executions/${execution.id}`);
      // It may be open in the Record result card.
      if (editor?.editing?.id === execution.id) editor.close();
      toast.success("Result deleted");
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  function startEditing() {
    // A click that ends a text selection is someone copying the result, not
    // asking to change it.
    if (window.getSelection()?.toString()) return;
    onEdit();
  }

  const reportable =
    bugReportCase && (execution.status === "FAILED" || execution.status === "BLOCKED");

  async function copyBugReport() {
    if (!bugReportCase) return;
    const text = bugReportText({
      testCase: bugReportCase,
      execution: { environmentName: execution.environmentName ?? null, actualResult: execution.actualResult },
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Bug report copied", { description: "Paste it into the tracker or chat." });
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  return (
    <li
      className={
        editable
          ? "group relative cursor-pointer rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
          : "relative rounded-lg border p-4"
      }
      onClick={editable ? startEditing : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-7">
            {execution.tester.image && (
              <AvatarImage src={execution.tester.image} alt="" />
            )}
            <AvatarFallback className="text-xs">
              {initials(execution.tester.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {execution.tester.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(execution.executedAt)}
              {execution.environmentName && (
                <span title="Tested on">{` \u00b7 ${execution.environmentName}`}</span>
              )}
              {execution.editedAt && (
                // Flagged rather than silent: a reader is entitled to know this
                // is not what was first recorded.
                <span title={`Edited ${formatDateTime(execution.editedAt)}`}>
                  {" \u00b7 edited"}
                </span>
              )}
              {execution.runItem && (
                <>
                  {" \u00b7 "}
                  {projectId ? (
                    <Link
                      href={`/projects/${projectId}/automation/runs/${execution.runItem.run.id}?item=${execution.runItem.id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Bot className="size-3" />
                      Automated · Run #{execution.runItem.run.code ?? execution.runItem.run.number}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Bot className="size-3" />
                      Automated · Run #{execution.runItem.run.code ?? execution.runItem.run.number}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLatest && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Latest
            </span>
          )}
          <StatusBadge status={execution.status} />
          {(reportable || editable) && (
            // One menu for what can be done with a result; the click stays
            // off the entry, which opens it for editing.
            <div onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Result actions"
                    title="Edit, copy bug report or delete"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                  >
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {editable && (
                    <DropdownMenuItem onSelect={() => onEdit()}>
                      <Pencil className="mr-2 size-4" />
                      Edit result
                    </DropdownMenuItem>
                  )}
                  {reportable && (
                    <DropdownMenuItem onSelect={() => void copyBugReport()}>
                      <ClipboardCopy className="mr-2 size-4" />
                      Copy bug report
                    </DropdownMenuItem>
                  )}
                  {editable && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={locked || deleting}
                        onSelect={() => setConfirmOpen(true)}
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      >
                        <Trash2 className="mr-2 size-4" />
                        <span className="flex flex-col">
                          Delete result
                          {locked && (
                            <span className="text-xs font-normal text-muted-foreground">
                              A developer is working from it
                            </span>
                          )}
                        </span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {execution.actualResult && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Actual result
          </p>
          <p className="preserve-lines text-sm">{execution.actualResult}</p>
        </div>
      )}

      {execution.comment && (
        <div className="mt-3 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comment
          </p>
          <p className="preserve-lines text-sm text-muted-foreground">
            {execution.comment}
          </p>
        </div>
      )}

      {execution.attachments.length > 0 && (
        <div
          className="mt-3 space-y-1.5"
          // The gallery opens a lightbox; that click is not an edit.
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Attachments
          </p>
          <AttachmentGallery attachments={execution.attachments} />
        </div>
      )}

      {/* Clicks in the dialog are not clicks on the entry. */}
      <div onClick={(event) => event.stopPropagation()}>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete this result?"
          description={
            <>
              The {execution.status.toLowerCase().replace("_", " ")} result from{" "}
              {formatDateTime(execution.executedAt)}
              {execution.attachments.length > 0 &&
                `, with its ${execution.attachments.length} attachment${execution.attachments.length === 1 ? "" : "s"}`}
              , is removed for good.{" "}
              {isLatest
                ? "The case will then show its previous result."
                : "It is not the latest result, so the case's status does not change."}
            </>
          }
          confirmLabel="Delete result"
          destructive
          onConfirm={handleDelete}
        />
      </div>
    </li>
  );
}
