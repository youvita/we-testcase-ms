"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PROJECT_ENVIRONMENTS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  type Role,
} from "@/lib/constants";
import { projectSchema, type ProjectInput } from "@/lib/validations";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { toDateInputValue } from "@/utils/format";
import type { Project, ProjectPerson } from "@/types";

export type QaOwnerOption = { id: string; name: string; email: string };
export type MemberOption = QaOwnerOption & { role: Role | string };

const NO_OWNER = "none";
const NO_ENVIRONMENT = "none";
/** Switches the Environment field from the preset list to a free-text input. */
const OTHER_ENVIRONMENT = "__other__";

/**
 * Create/edit dialog for a project. Controlled by the caller so it can be
 * opened from a page header button or a row action.
 */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  qaOwners,
  memberCandidates = [],
  environments = [...PROJECT_ENVIRONMENTS],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted for create. */
  project?: Project & { members?: ProjectPerson[] };
  qaOwners: QaOwnerOption[];
  /** Everyone who can be put in charge. */
  memberCandidates?: MemberOption[];
  /** Presets plus environments other projects already use. */
  environments?: string[];
}) {
  const router = useRouter();
  const isEdit = Boolean(project);
  /** True while the Environment field is a free-text input. */
  const [customEnvironment, setCustomEnvironment] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      description: "",
      version: "",
      environment: "",
      status: "PLANNING",
      qaOwnerId: NO_OWNER,
      memberIds: [],
      startDate: "",
      endDate: "",
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  // Re-seed the form each time the dialog opens so a cancelled edit does not
  // leak values into the next open.
  useEffect(() => {
    if (!open) return;

    reset({
      name: project?.name ?? "",
      description: project?.description ?? "",
      version: project?.version ?? "",
      environment: project?.environment ?? "",
      status: project?.status ?? "PLANNING",
      qaOwnerId: project?.qaOwnerId ?? NO_OWNER,
      memberIds: project?.members?.map((member) => member.id) ?? [],
      startDate: toDateInputValue(project?.startDate),
      endDate: toDateInputValue(project?.endDate),
    });

    // An environment saved before it became a preset — or typed as a one-off on
    // a project nobody else shares — opens as text rather than silently
    // resetting to a value the project does not have.
    const current = project?.environment?.trim();
    setCustomEnvironment(Boolean(current) && !environments.includes(current!));
    setMembersOpen(false);
  }, [open, project, reset, environments]);

  async function onSubmit(values: ProjectInput) {
    try {
      if (isEdit && project) {
        await api.patch(`/api/projects/${project.id}`, values);
        toast.success("Project updated");
      } else {
        await api.post("/api/projects", values);
        toast.success("Project created");
      }

      onOpenChange(false);
      router.refresh();
    } catch (error) {
      // Surface server-side field errors on the matching inputs.
      if (error instanceof ApiError && error.fieldErrors) {
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const message = messages[0];
          if (message) {
            setError(field as keyof ProjectInput, { message });
          }
        }
      }
      toast.error(errorMessage(error));
    }
  }

  const status = watch("status");
  const qaOwnerId = watch("qaOwnerId");
  const environment = watch("environment");
  const memberIds = watch("memberIds") ?? [];

  const selectedMembers = memberCandidates.filter((candidate) =>
    memberIds.includes(candidate.id),
  );

  function toggleMember(id: string) {
    const next = memberIds.includes(id)
      ? memberIds.filter((memberId) => memberId !== id)
      : [...memberIds, id];
    setValue("memberIds", next, { shouldDirty: true });
  }

  function handleEnvironmentChange(value: string) {
    if (value === OTHER_ENVIRONMENT) {
      setCustomEnvironment(true);
      setValue("environment", "", { shouldDirty: true });
      return;
    }
    setCustomEnvironment(false);
    setValue("environment", value === NO_ENVIRONMENT ? "" : value, {
      shouldDirty: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the project details. Test cases and results are not affected."
              : "Create a project, then add modules and import your Excel test cases."}
          </DialogDescription>
        </DialogHeader>

        <form
          id="project-form"
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="name">
              Project name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Mobile Banking Regression"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="What this test cycle covers…"
              {...register("description")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input id="version" placeholder="1.4.2" {...register("version")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="environment">Environment</Label>
              {customEnvironment ? (
                <div className="flex gap-2">
                  <Input
                    id="environment"
                    placeholder="e.g. DEV, Staging"
                    autoFocus
                    aria-invalid={Boolean(errors.environment)}
                    {...register("environment")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    // Back to the list, and clear the half-typed name with it.
                    onClick={() => handleEnvironmentChange(NO_ENVIRONMENT)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select
                  value={environment ? environment : NO_ENVIRONMENT}
                  onValueChange={handleEnvironmentChange}
                >
                  <SelectTrigger id="environment">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ENVIRONMENT}>Not set</SelectItem>
                    {environments.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                    <SelectItem
                      value={OTHER_ENVIRONMENT}
                      className="text-primary"
                    >
                      Other…
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {errors.environment && (
                <p className="text-xs text-destructive">
                  {errors.environment.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status ?? "PLANNING"}
                onValueChange={(value) =>
                  setValue("status", value as ProjectInput["status"], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PROJECT_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qaOwnerId">QA owner</Label>
              <Select
                value={qaOwnerId ?? NO_OWNER}
                onValueChange={(value) =>
                  setValue("qaOwnerId", value, { shouldDirty: true })
                }
              >
                <SelectTrigger id="qaOwnerId">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                  {qaOwners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Unassigned is a valid choice.
              </p>
            </div>
          </div>

          {memberCandidates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="memberIds">In charge</Label>
              <Popover open={membersOpen} onOpenChange={setMembersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="memberIds"
                    type="button"
                    variant="outline"
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {selectedMembers.length === 0
                        ? "Nobody yet"
                        : `${selectedMembers.length} ${
                            selectedMembers.length === 1 ? "person" : "people"
                          }`}
                    </span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="max-h-72 w-[--radix-popover-trigger-width] overflow-y-auto p-1"
                  align="start"
                >
                  {memberCandidates.map((candidate) => {
                    const checked = memberIds.includes(candidate.id);
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => toggleMember(candidate.id)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          // The row handles the click; the box only shows state.
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {candidate.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {candidate.email}
                          </span>
                        </span>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {ROLE_LABELS[candidate.role as Role] ??
                            candidate.role}
                        </Badge>
                        {checked && (
                          <Check className="size-4 shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>

              {selectedMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedMembers.map((member) => (
                    <Badge
                      key={member.id}
                      variant="secondary"
                      className="gap-1 pr-1"
                    >
                      {member.name}
                      <button
                        type="button"
                        onClick={() => toggleMember(member.id)}
                        aria-label={`Remove ${member.name}`}
                        className="rounded-sm hover:bg-background/60"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Only these people, the QA owner and admins can open this project.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" type="date" {...register("startDate")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input id="endDate" type="date" {...register("endDate")} />
              {errors.endDate && (
                <p className="text-xs text-destructive">
                  {errors.endDate.message}
                </p>
              )}
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" form="project-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
