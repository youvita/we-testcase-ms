"use client";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { SCROLL_BOX } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PlatformBadge } from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import type { TrashedTestCase } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime } from "@/utils/format";

const plural = (n: number) => `${n} test case${n === 1 ? "" : "s"}`;

/**
 * Deleted test cases, kept until someone restores them or deletes them
 * forever. Nothing leaves here on its own.
 */
export function TrashPanel({
  projectId,
  items,
  canManage,
}: {
  projectId: string;
  items: TrashedTestCase[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const paging = useClientPagination(items);
  const [busy, setBusy] = useState(false);
  /** What "Delete forever" applies to: the selection, or the whole Trash. */
  const [purging, setPurging] = useState<"selected" | "all" | null>(null);

  // Rows that have left the Trash since (restored by a teammate) drop out.
  const chosen = items.filter((item) => selected.has(item.id));
  const allChosen = items.length > 0 && chosen.length === items.length;

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function restore(ids: string[]) {
    setBusy(true);
    try {
      const { restored } = await api.post<{ restored: number }>(
        `/api/projects/${projectId}/trash/restore`,
        { ids },
      );
      toast.success(`Restored ${plural(restored)}`);
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function purge() {
    const body = purging === "all" ? {} : { ids: chosen.map((item) => item.id) };
    try {
      const { deleted } = await api.delete<{ deleted: number }>(
        `/api/projects/${projectId}/trash`,
        body,
      );
      toast.success(`Deleted ${plural(deleted)} forever`);
      setSelected(new Set());
      setPurging(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Trash2}
        title="The Trash is empty"
        description="Deleted test cases come here, with their history, until someone restores them or deletes them forever."
      />
    );
  }

  const purgeCount = purging === "all" ? items.length : chosen.length;
  const purgeResults =
    purging === "all"
      ? items.reduce((sum, item) => sum + item.executions, 0)
      : chosen.reduce((sum, item) => sum + item.executions, 0);

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-muted-foreground">
            {chosen.length > 0 ? `${chosen.length} selected` : plural(items.length)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || chosen.length === 0}
            onClick={() => void restore(chosen.map((item) => item.id))}
          >
            <RotateCcw className="mr-2 size-4" />
            Restore
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={busy || chosen.length === 0}
            onClick={() => setPurging("selected")}
          >
            <Trash2 className="mr-2 size-4" />
            Delete forever
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setPurging("all")}
          >
            Empty Trash
          </Button>
        </div>
      )}

      <Card className="divide-y overflow-hidden">
        {canManage && (
          <label className="flex items-center gap-3 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <Checkbox
              checked={allChosen ? true : chosen.length > 0 ? "indeterminate" : false}
              onCheckedChange={(checked) =>
                setSelected(checked === true ? new Set(items.map((item) => item.id)) : new Set())
              }
              aria-label="Select all"
            />
            Select all
          </label>
        )}
        <div className={cn("divide-y overflow-y-auto", SCROLL_BOX)}>
        {paging.pageItems.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            {canManage && (
              <Checkbox
                checked={selected.has(item.id)}
                onCheckedChange={(checked) => toggle(item.id, checked === true)}
                aria-label={`Select ${item.tcId}`}
              />
            )}
            <StatusBadge status={item.status} label={item.tcId} className="font-mono" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.moduleName}
                {item.subModule ? ` › ${item.subModule}` : ""}
                {" · "}
                {item.executions} result{item.executions === 1 ? "" : "s"}
                {" · "}
                Deleted {formatDateTime(item.deletedAt)}
                {item.deletedByName ? ` by ${item.deletedByName}` : ""}
              </p>
            </div>
            <PlatformBadge platform={item.platform} />
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void restore([item.id])}
              >
                <RotateCcw className="mr-2 size-4" />
                Restore
              </Button>
            )}
          </div>
        ))}
        </div>
      </Card>

      {items.length > 0 && (
        <PaginationControls
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          totalPages={paging.totalPages}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
        />
      )}


      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => !open && setPurging(null)}
        title={purging === "all" ? "Empty the Trash?" : `Delete ${plural(purgeCount)} forever?`}
        description={`${plural(purgeCount)} and ${purgeResults} recorded result${purgeResults === 1 ? "" : "s"}, with comments, attachments and scripts, will be gone for good. This cannot be undone.`}
        confirmLabel={purging === "all" ? "Empty Trash" : "Delete forever"}
        onConfirm={purge}
      />
    </div>
  );
}
