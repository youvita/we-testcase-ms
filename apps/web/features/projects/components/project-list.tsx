"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectStatusBadge } from "@/components/shared/priority-badge";
import {
  StatusMeter,
  StatusMeterLegend,
} from "@/components/shared/progress-meter";
import { SearchInput } from "@/components/shared/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatDate } from "@/utils/format";
import type { Project, ProjectWithStats } from "@/types";

import {
  ProjectFormDialog,
  type MemberOption,
  type QaOwnerOption,
} from "./project-form-dialog";

type ProjectView = "card" | "list";

/**
 * Project grid with search and status filtering.
 *
 * Filtering happens client-side: the project list is small (tens of rows, not
 * thousands) and already fully loaded by the server component, so a round trip
 * per keystroke would be wasted work.
 */
export function ProjectList({
  projects,
  qaOwners,
  memberCandidates,
  environments,
  canManage,
  canDelete,
}: {
  projects: ProjectWithStats[];
  qaOwners: QaOwnerOption[];
  memberCandidates: MemberOption[];
  environments: string[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [view, setView] = useState<ProjectView>("card");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectWithStats | undefined>();
  const [deleting, setDeleting] = useState<ProjectWithStats | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return projects.filter((project) => {
      if (statusFilter !== "ALL" && project.status !== statusFilter) {
        return false;
      }
      if (!term) return true;

      return (
        project.name.toLowerCase().includes(term) ||
        (project.description ?? "").toLowerCase().includes(term) ||
        (project.version ?? "").toLowerCase().includes(term)
      );
    });
  }, [projects, search, statusFilter]);

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/projects/${deleting.id}`);
      toast.success(`Deleted "${deleting.name}"`);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error; // keeps the confirm dialog open
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects…"
          tooltip="Matches the project name, description and version."
          className="w-full sm:w-72"
        />

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-[170px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PROJECT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {PROJECT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <ViewToggle value={view} onChange={setView} />

        {canManage && (
          <Button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 size-4" />
            New project
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={
            projects.length === 0 ? "No projects yet" : "No matching projects"
          }
          description={
            projects.length === 0
              ? canManage
                ? "Create a project, add its modules, then import your Excel test cases."
                : "No projects have been shared with you yet."
              : "Try a different search term or clear the status filter."
          }
          action={
            projects.length === 0 && canManage ? (
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 size-4" />
                New project
              </Button>
            ) : undefined
          }
        />
      ) : view === "card" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <Card
              key={project.id}
              className="group relative flex flex-col transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    {/*
                      Stretched link: the ::after overlay makes the whole card
                      the hit area while keeping a single anchor per card, so
                      the accessible name stays the project name. `truncate`
                      sits on the inner span — its `overflow: hidden` would
                      clip the overlay if it were on the anchor itself.
                    */}
                    <Link
                      href={`/projects/${project.id}`}
                      className="block font-semibold after:absolute after:inset-0 after:content-['']"
                    >
                      <span className="block truncate">{project.name}</span>
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ProjectStatusBadge status={project.status} />
                      {project.version && <span>v{project.version}</span>}
                      {project.environment && <span>{project.environment}</span>}
                    </div>
                  </div>

                  {canManage && (
                    <ProjectActions
                      project={project}
                      canDelete={canDelete}
                      onEdit={() => {
                        setEditing(project);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeleting(project)}
                    />
                  )}
                </div>

                {project.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                )}

                <div className="mt-auto space-y-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">
                      {project.stats.executed} of {project.stats.total} executed
                    </span>
                    <span className="font-semibold tabular-nums">
                      {project.stats.executionRate}%
                    </span>
                  </div>
                  <StatusMeter stats={project.stats} />
                  <StatusMeterLegend stats={project.stats} />
                </div>

                <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span className="truncate">
                    QA: {project.qaOwner?.name ?? "Unassigned"}
                  </span>
                  <span className="shrink-0">
                    {project.moduleCount} module
                    {project.moduleCount === 1 ? "" : "s"}
                  </span>
                </div>

                {(project.startDate || project.endDate) && (
                  <p className="text-xs text-muted-foreground">
                    {formatDate(project.startDate)} – {formatDate(project.endDate)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="w-[240px]">Progress</TableHead>
                <TableHead className="hidden md:table-cell">QA owner</TableHead>
                <TableHead className="hidden lg:table-cell text-right">
                  Modules
                </TableHead>
                <TableHead className="hidden xl:table-cell">Timeline</TableHead>
                {canManage && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => (
                // Whole-row hit area, like the cards have. A stretched link
                // can't do it here: `position: relative` on a <tr> is not a
                // reliable containing block, so the overlay escapes the row
                // and covers the table. The name link stays a real anchor for
                // keyboard and middle-click.
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <TableCell>
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/projects/${project.id}`}
                        className="block truncate font-medium"
                      >
                        {project.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <ProjectStatusBadge status={project.status} />
                        {project.version && <span>v{project.version}</span>}
                        {project.environment && (
                          <span>{project.environment}</span>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          {project.stats.executed} of {project.stats.total}{" "}
                          executed
                        </span>
                        <span className="font-semibold tabular-nums">
                          {project.stats.executionRate}%
                        </span>
                      </div>
                      <StatusMeter stats={project.stats} />
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {project.qaOwner?.name ?? "Unassigned"}
                  </TableCell>

                  <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums text-muted-foreground">
                    {project.moduleCount}
                  </TableCell>

                  <TableCell className="hidden xl:table-cell whitespace-nowrap text-xs text-muted-foreground">
                    {project.startDate || project.endDate
                      ? `${formatDate(project.startDate)} – ${formatDate(project.endDate)}`
                      : "—"}
                  </TableCell>

                  {canManage && (
                    <TableCell
                      className="text-right"
                      // Keep menu clicks from triggering the row navigation.
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ProjectActions
                        project={project}
                        canDelete={canDelete}
                        onEdit={() => {
                          setEditing(project);
                          setFormOpen(true);
                        }}
                        onDelete={() => setDeleting(project)}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canManage && (
        <ProjectFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          project={editing}
          qaOwners={qaOwners}
          memberCandidates={memberCandidates}
          environments={environments}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description={
          <>
            This permanently deletes{" "}
            <strong>{deleting?.stats.total ?? 0} test cases</strong>, every
            module, and all recorded execution history and attachments for this
            project. This cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** Segmented card/list switch. Cards are the default view. */
function ViewToggle({
  value,
  onChange,
}: {
  value: ProjectView;
  onChange: (next: ProjectView) => void;
}) {
  const options = [
    { view: "card" as const, icon: LayoutGrid, label: "Card view" },
    { view: "list" as const, icon: List, label: "List view" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
      {options.map(({ view, icon: Icon, label }) => (
        <Button
          key={view}
          type="button"
          variant="ghost"
          size="icon"
          // aria-pressed rather than a radiogroup: this only changes how the
          // same data is rendered, so it reads as a toggle, not a choice.
          aria-pressed={value === view}
          aria-label={label}
          title={label}
          className={cn(
            "size-8",
            value === view && "bg-accent text-accent-foreground shadow-sm",
          )}
          onClick={() => onChange(view)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}

/** Edit/delete menu, shared by both views. */
function ProjectActions({
  project,
  canDelete,
  onEdit,
  onDelete,
}: {
  project: ProjectWithStats;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // z-10 keeps this above the card's stretched link overlay, otherwise
          // opening the menu would navigate instead.
          className="relative z-10 size-8 shrink-0"
          aria-label={`Actions for ${project.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
          >
            <Trash2 className="mr-2 size-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
