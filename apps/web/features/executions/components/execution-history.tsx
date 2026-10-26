"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, History, Pencil } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCardHeader } from "@/components/shared/collapsible-card-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime, initials } from "@/utils/format";
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
}: {
  /** Needed to link automated results to their run. */
  projectId?: string;
  executions: ExecutionWithDetails[];
  currentUserId?: string;
  canModerate?: boolean;
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
                  isLatest={index === 0}
                  editable={
                    Boolean(editor) &&
                    (canModerate || execution.tester.id === currentUserId)
                  }
                  onEdit={() => editor?.startEditing(execution)}
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
  isLatest,
  editable,
  onEdit,
}: {
  projectId?: string;
  execution: ExecutionWithDetails;
  isLatest: boolean;
  editable: boolean;
  onEdit: () => void;
}) {
  function startEditing() {
    // A click that ends a text selection is someone copying the result, not
    // asking to change it.
    if (window.getSelection()?.toString()) return;
    onEdit();
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
                      href={`/projects/${projectId}/automation/runs/${execution.runItem.run.id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Bot className="size-3" />
                      Automated · Run #{execution.runItem.run.number}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Bot className="size-3" />
                      Automated · Run #{execution.runItem.run.number}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editable && (
            <Pencil
              className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
          {isLatest && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Latest
            </span>
          )}
          <StatusBadge status={execution.status} />
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
    </li>
  );
}
