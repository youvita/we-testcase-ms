"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { ROLE_LABELS, toRole } from "@/lib/constants";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, initials } from "@/utils/format";
import type { CommentWithAuthor } from "@/types";

/**
 * QA ↔ developer discussion on a test case.
 *
 * Separate from the execution history above it: that log is immutable and only
 * QA writes to it, whereas this is a conversation anyone signed in may join.
 * Keeping them visually distinct is what stops a developer's "fixed in 1.4.3"
 * from reading like a test result.
 */
export function CommentThread({
  testCaseId,
  comments,
  currentUserId,
  canComment,
  canModerate,
}: {
  testCaseId: string;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handlePost() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setPosting(true);
    try {
      await api.post(`/api/test-cases/${testCaseId}/comments`, {
        body: trimmed,
      });
      setBody("");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await api.delete(`/api/comments/${commentId}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Discussion</CardTitle>
        <CardDescription>
          {comments.length === 0
            ? "Ask a question or report a fix — QA and developers both post here."
            : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {comments.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Use this to hand a failure back and forth without editing the test result."
          />
        ) : (
          <ol className="space-y-3">
            {comments.map((comment) => {
              const withdrawn = Boolean(comment.deletedAt);
              return (
                <li key={comment.id} className="flex items-start gap-3">
                  <Avatar className="size-7 shrink-0">
                    {comment.author.image && (
                      <AvatarImage src={comment.author.image} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {initials(comment.author.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">
                        {comment.author.name}
                      </span>
                      {/* The role is what tells QA whether a reply is coming from
                        engineering, so it is worth the space. */}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {ROLE_LABELS[toRole(comment.author.role)]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(comment.createdAt)}
                      </span>
                    </div>
                    {withdrawn ? (
                      // A tombstone, not a gap: replies below this one still need
                      // something to point at.
                      <p className="text-sm italic text-muted-foreground">
                        This comment was deleted
                        {comment.deletedAt
                          ? ` · ${formatDateTime(comment.deletedAt)}`
                          : ""}
                      </p>
                    ) : (
                      <p className="preserve-lines text-sm">{comment.body}</p>
                    )}
                  </div>

                  {!withdrawn &&
                    (canModerate || comment.author.id === currentUserId) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deletingId === comment.id}
                        onClick={() => handleDelete(comment.id)}
                        aria-label={`Delete comment by ${comment.author.name}`}
                      >
                        {deletingId === comment.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    )}
                </li>
              );
            })}
          </ol>
        )}

        {canComment && (
          <div className="space-y-2 border-t pt-4">
            <Textarea
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Build number, root cause, what you changed, what QA should check…"
              aria-label="Write a comment"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handlePost}
                disabled={posting || !body.trim()}
              >
                {posting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Post comment
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
