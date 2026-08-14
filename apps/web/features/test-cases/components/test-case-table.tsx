"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ClipboardList,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { FixStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationControls } from "@/components/shared/pagination-controls";
import {
  PlatformBadge,
  PriorityBadge,
  TestTypeBadge,
} from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { FIX_STATUS_SHORT_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useQueryParams } from "@/hooks/use-query-params";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";
import type { Paginated, TestCaseListItem } from "@/types";

import {
  TestCaseFormDialog,
  type ModuleOption,
} from "./test-case-form-dialog";

type SortKey = "tcId" | "testType" | "priority" | "module" | "updatedAt";

/** Matches the timeline while keeping closing decisions visible but neutral. */
const FIX_STATUS_TEXT: Record<Exclude<FixStatus, "NONE">, string> = {
  INVESTIGATING: "text-status-blocked",
  FIXED: "text-primary",
  RETESTING: "text-blue-600 dark:text-blue-400",
  WONT_FIX: "text-muted-foreground",
  NOT_A_BUG: "text-muted-foreground",
};

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "tcId", label: "TC ID", className: "w-[130px]" },
  { key: "module", label: "Module", className: "w-[140px]" },
];

/**
 * Which rows are ticked, tagged with the row set they were ticked in.
 *
 * Selection is deliberately scoped to the rows on screen. Paging, filtering or
 * re-sorting yields a different row set, and "12 selected" would be a lie if
 * some of those rows were no longer visible — worse, "Delete selected" would
 * then destroy records the user cannot see.
 */
type Selection = { signature: string; ids: Set<string> };

/** Stable identity so the derived empty case does not re-render consumers. */
const NO_IDS: ReadonlySet<string> = new Set<string>();

export function TestCaseTable({
  projectId,
  page,
  modules,
  canManage,
}: {
  projectId: string;
  page: Paginated<TestCaseListItem>;
  modules: ModuleOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { get, setParams, isPending } = useQueryParams();
  const [editing, setEditing] = useState<TestCaseListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<TestCaseListItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const sort = (get("sort", "tcId") || "tcId") as SortKey;
  const order = get("order", "asc") === "desc" ? "desc" : "asc";

  // Comparing the row signature while rendering — rather than clearing the
  // selection from an effect — means the checkboxes never paint one stale frame
  // showing rows from the previous page as ticked.
  const signature = page.items.map((item) => item.id).join(",");
  const [selection, setSelection] = useState<Selection>({
    signature,
    ids: new Set(),
  });
  const selectedIds =
    selection.signature === signature ? selection.ids : NO_IDS;

  const selectedCases = page.items.filter((item) => selectedIds.has(item.id));
  const allSelected =
    page.items.length > 0 && selectedCases.length === page.items.length;

  function setSelected(ids: Set<string>) {
    setSelection({ signature, ids });
  }

  function toggleRow(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function handleBulkDelete() {
    const ids = selectedCases.map((item) => item.id);
    if (ids.length === 0) return;

    try {
      const result = await api.delete<{ deleted: number; missing: number }>(
        `/api/projects/${projectId}/test-cases`,
        { ids },
      );

      toast.success(
        `Deleted ${result.deleted} test case${result.deleted === 1 ? "" : "s"}`,
        result.missing > 0
          ? {
              description: `${result.missing} were already gone — the list was out of date.`,
            }
          : undefined,
      );

      setSelected(new Set());
      setBulkDeleteOpen(false);

      // Clearing the last page of results would otherwise strand the user on an
      // empty page, so step back instead of just refreshing in place.
      if (ids.length === page.items.length && page.page > 1) {
        setParams({ page: page.page - 1 });
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  function toggleSort(key: SortKey) {
    // Same column flips direction; a new column starts ascending.
    setParams({
      sort: key,
      order: sort === key && order === "asc" ? "desc" : "asc",
    });
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sort !== column) {
      return <ChevronsUpDown className="ml-1.5 size-3.5 opacity-40" />;
    }
    return order === "asc" ? (
      <ArrowUp className="ml-1.5 size-3.5" />
    ) : (
      <ArrowDown className="ml-1.5 size-3.5" />
    );
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/test-cases/${deleting.id}`);
      toast.success(`Deleted ${deleting.tcId}`);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  if (page.total === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No test cases found"
        description={
          canManage
            ? "Import an Excel file or add a test case manually. If you expected results here, try clearing the filters."
            : "No test cases match the current filters."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {canManage && selectedCases.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
          <span className="text-sm font-medium">
            {selectedCases.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="mr-2 size-4" />
            Delete selected
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage && (
                <TableHead className="w-[44px]">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : selectedCases.length > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true
                          ? new Set(page.items.map((item) => item.id))
                          : new Set(),
                      )
                    }
                    aria-label="Select all test cases on this page"
                  />
                </TableHead>
              )}

              {COLUMNS.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className="inline-flex items-center font-medium hover:text-foreground"
                  >
                    {column.label}
                    <SortIcon column={column.key} />
                  </button>
                </TableHead>
              ))}

              <TableHead>Test Case</TableHead>

              <TableHead className="w-[110px]">
                <button
                  type="button"
                  onClick={() => toggleSort("testType")}
                  className="inline-flex items-center font-medium hover:text-foreground"
                >
                  Test Type
                  <SortIcon column="testType" />
                </button>
              </TableHead>

              <TableHead className="w-[100px]">
                <button
                  type="button"
                  onClick={() => toggleSort("priority")}
                  className="inline-flex items-center font-medium hover:text-foreground"
                >
                  Priority
                  <SortIcon column="priority" />
                </button>
              </TableHead>

              <TableHead className="w-[100px]">Platform</TableHead>

              <TableHead className="w-[210px]">Status</TableHead>

              <TableHead className="w-[140px]">
                <button
                  type="button"
                  onClick={() => toggleSort("updatedAt")}
                  className="inline-flex items-center font-medium hover:text-foreground"
                >
                  Last Updated
                  <SortIcon column="updatedAt" />
                </button>
              </TableHead>

              <TableHead className="w-[52px]" />
            </TableRow>
          </TableHeader>

          <TableBody className={isPending ? "opacity-60 transition-opacity" : ""}>
            {page.items.map((testCase) => (
              // Whole row navigates, matching the project list. The cells that
              // hold their own controls stop the click from bubbling.
              <TableRow
                key={testCase.id}
                className="cursor-pointer"
                data-state={selectedIds.has(testCase.id) ? "selected" : undefined}
                onClick={() =>
                  router.push(
                    `/projects/${projectId}/test-cases/${testCase.id}`,
                  )
                }
              >
                {canManage && (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(testCase.id)}
                      onCheckedChange={(checked) =>
                        toggleRow(testCase.id, checked === true)
                      }
                      aria-label={`Select ${testCase.tcId}`}
                    />
                  </TableCell>
                )}

                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/projects/${projectId}/test-cases/${testCase.id}`}
                  >
                    {testCase.tcId}
                  </Link>
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {testCase.module.name}
                </TableCell>

                <TableCell>
                  <Link
                    href={`/projects/${projectId}/test-cases/${testCase.id}`}
                    className="font-medium"
                  >
                    {testCase.title}
                  </Link>
                </TableCell>

                <TableCell>
                  <TestTypeBadge testType={testCase.testType} />
                </TableCell>

                <TableCell>
                  <PriorityBadge priority={testCase.priority} />
                </TableCell>

                <TableCell>
                  <PlatformBadge platform={testCase.platform} />
                </TableCell>

                <TableCell>
                  {/* The result, then where the fix has got to. Two facts from
                      two people, so they are separated rather than merged into
                      one pill. */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <StatusBadge status={testCase.status} />
                    {testCase.fixStatus !== "NONE" && (
                      <>
                        <span className="text-muted-foreground" aria-hidden>
                          •
                        </span>
                        <span
                          className={cn(
                            "whitespace-nowrap text-xs font-medium",
                            FIX_STATUS_TEXT[testCase.fixStatus],
                          )}
                        >
                          {FIX_STATUS_SHORT_LABELS[testCase.fixStatus]}
                        </span>
                      </>
                    )}
                  </div>
                </TableCell>

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatRelative(testCase.lastExecutedAt ?? testCase.updatedAt)}
                </TableCell>

                <TableCell onClick={(event) => event.stopPropagation()}>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Actions for ${testCase.tcId}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(testCase);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="mr-2 size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleting(testCase)}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PaginationControls
        page={page.page}
        pageSize={page.pageSize}
        total={page.total}
        totalPages={page.totalPages}
        disabled={isPending}
        onPageChange={(next) => setParams({ page: next })}
        onPageSizeChange={(size) => setParams({ pageSize: size, page: 1 })}
      />

      {canManage && (
        <TestCaseFormDialog
          projectId={projectId}
          modules={modules}
          testCaseId={editing?.id}
          open={formOpen}
          onOpenChange={(next) => {
            setFormOpen(next);
            if (!next) setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete ${deleting?.tcId}?`}
        description="This also deletes its execution history and attachments. This cannot be undone."
        confirmLabel="Delete test case"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedCases.length} test case${selectedCases.length === 1 ? "" : "s"}?`}
        description={
          <div className="space-y-2">
            <p>
              This also deletes their execution history and attachments. This
              cannot be undone.
            </p>
            {/* Spelling out the IDs makes an accidental select-all obvious
                before the click, not after. */}
            <p className="font-mono text-xs">
              {selectedCases
                .slice(0, 10)
                .map((item) => item.tcId)
                .join(", ")}
              {selectedCases.length > 10 &&
                ` and ${selectedCases.length - 10} more`}
            </p>
          </div>
        }
        confirmLabel={`Delete ${selectedCases.length} test case${selectedCases.length === 1 ? "" : "s"}`}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
