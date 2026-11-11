"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Info, Loader2, Plus, X } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  type Role,
} from "@/lib/constants";
import { EnvironmentDialog } from "@/features/environments/components/environments-panel";
import { projectSchema, type ProjectInput } from "@/lib/validations";
import type { RunEnvironmentOutput } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { toDateInputValue } from "@/utils/format";
import type { Project, ProjectEnvironmentOption, ProjectPerson } from "@/types";

export type ProductOwnerOption = { id: string; name: string; email: string };
export type MemberOption = ProductOwnerOption & { role: Role | string };

const NO_ENVIRONMENT = "none";
/** Opens the environment dialog; never a value the form keeps. */
const ADD_ENVIRONMENT = "__add__";
/** A not-yet-created environment of a new project, by name. */
const DRAFT = "draft:";

/**
 * Create/edit dialog for a project. Controlled by the caller so it can be
 * opened from a page header button or a row action.
 */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  productOwners,
  memberCandidates = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted for create. */
  project?: Project & {
    members?: ProjectPerson[];
    /** The run environments it can default to. */
    runEnvironments?: ProjectEnvironmentOption[];
  };
  productOwners: ProductOwnerOption[];
  /** Everyone who can be put in charge. */
  memberCandidates?: MemberOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(project);
  const [membersOpen, setMembersOpen] = useState(false);
  const [addingEnvironment, setAddingEnvironment] = useState(false);
  /** New project: environments to create with it, and which is default. */
  const [drafts, setDrafts] = useState<RunEnvironmentOutput[]>([]);
  const [draftDefault, setDraftDefault] = useState<string | null>(null);
  /** Existing project: environments added from this form since it opened. */
  const [added, setAdded] = useState<ProjectEnvironmentOption[]>([]);

  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      description: "",
      version: "",
      status: "PLANNING",
      productOwnerId: "",
      memberIds: [],
      platforms: ["WEB"],
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
      // Absent on create: a new project has no environments to choose from.
      defaultEnvironmentId: project
        ? (project.defaultEnvironmentId ?? NO_ENVIRONMENT)
        : undefined,
      status: project?.status ?? "PLANNING",
      productOwnerId: project?.productOwnerId ?? "",
      memberIds: project?.members?.map((member) => member.id) ?? [],
      platforms: project?.platforms ?? ["WEB"],
      startDate: toDateInputValue(project?.startDate),
      endDate: toDateInputValue(project?.endDate),
    });
    setMembersOpen(false);
    setAddingEnvironment(false);
    setDrafts([]);
    setDraftDefault(null);
    setAdded([]);
  }, [open, project, reset]);

  async function onSubmit(values: ProjectInput) {
    try {
      if (isEdit && project) {
        await api.patch(`/api/projects/${project.id}`, values);
        toast.success("Project updated");
      } else {
        await api.post("/api/projects", {
          ...values,
          environments: drafts,
          defaultEnvironmentName: draftDefault,
        });
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
  const productOwnerId = watch("productOwnerId");
  const defaultEnvironmentId = watch("defaultEnvironmentId");

  // A new project picks among its drafts by name; an existing one by id.
  const environmentOptions = isEdit
    ? [...(project?.runEnvironments ?? []), ...added]
        .filter(
          (env, index, all) => all.findIndex((e) => e.id === env.id) === index,
        )
        .map((env) => ({ value: env.id, label: env.name }))
    : drafts.map((draft) => ({ value: DRAFT + draft.name, label: draft.name }));
  const environmentValue = isEdit
    ? (defaultEnvironmentId ?? NO_ENVIRONMENT)
    : draftDefault
      ? DRAFT + draftDefault
      : NO_ENVIRONMENT;

  function handleEnvironmentChange(value: string) {
    if (value === ADD_ENVIRONMENT) {
      setAddingEnvironment(true);
    } else if (isEdit) {
      setValue("defaultEnvironmentId", value, { shouldDirty: true });
    } else {
      setDraftDefault(
        value === NO_ENVIRONMENT ? null : value.slice(DRAFT.length),
      );
    }
  }

  /** An environment added from here is the one meant as the default. */
  function addDraft(input: RunEnvironmentOutput) {
    setDrafts((list) => [...list.filter((d) => d.name !== input.name), input]);
    setDraftDefault(input.name);
  }

  function removeDraft(name: string) {
    setDrafts((list) => list.filter((d) => d.name !== name));
    if (draftDefault === name) setDraftDefault(null);
  }
  const memberIds = watch("memberIds") ?? [];
  const platforms = watch("platforms") ?? [];

  function togglePlatform(platform: (typeof PLATFORMS)[number]) {
    const next = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
    setValue("platforms", next, { shouldDirty: true, shouldValidate: true });
  }

  const selectedMembers = memberCandidates.filter((candidate) =>
    memberIds.includes(candidate.id),
  );

  function toggleMember(id: string) {
    const next = memberIds.includes(id)
      ? memberIds.filter((memberId) => memberId !== id)
      : [...memberIds, id];
    setValue("memberIds", next, { shouldDirty: true });
  }

  return (
    <>
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
                <p className="text-xs text-destructive">
                  {errors.name.message}
                </p>
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

            <div className="space-y-2">
              <Label>
                Platforms <span className="text-destructive">*</span>
              </Label>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Platforms"
              >
                {PLATFORMS.map((platform) => {
                  const on = platforms.includes(platform);
                  return (
                    <Button
                      key={platform}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() => togglePlatform(platform)}
                    >
                      {on && <Check className="mr-1.5 size-3.5" />}
                      {PLATFORM_LABELS[platform]}
                    </Button>
                  );
                })}
              </div>
              {errors.platforms ? (
                <p className="text-xs text-destructive">
                  {errors.platforms.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Where this project is tested. Test case forms, filters and AI
                  drafting offer only these.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel htmlFor="version">Version</FieldLabel>
                <Input
                  id="version"
                  placeholder="1.4.2"
                  {...register("version")}
                />
              </div>

              <div className="space-y-2">
                <FieldLabel
                  htmlFor="defaultEnvironmentId"
                  info="Preselected when running scripts and recording results."
                >
                  Default run environment
                </FieldLabel>
                <Select
                  value={environmentValue}
                  onValueChange={handleEnvironmentChange}
                >
                  <SelectTrigger id="defaultEnvironmentId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ENVIRONMENT}>None</SelectItem>
                    {environmentOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                    <SelectItem
                      value={ADD_ENVIRONMENT}
                      className="text-primary"
                    >
                      <span className="flex items-center gap-1.5">
                        <Plus className="size-3.5" />
                        Add environment…
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {!isEdit && drafts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {drafts.map((draft) => (
                      <Badge
                        key={draft.name}
                        variant="secondary"
                        className="gap-1 pr-1"
                      >
                        {draft.name}
                        <button
                          type="button"
                          className="rounded-sm hover:text-destructive"
                          aria-label={`Remove ${draft.name}`}
                          onClick={() => removeDraft(draft.name)}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {project?.environment && !project.defaultEnvironmentId && (
                  <p className="text-xs text-muted-foreground">
                    Was labelled &ldquo;{project.environment}&rdquo;. Choose or add the run environment it means.
                  </p>
                )}
                {!isEdit && drafts.length > 0 && (
                  <p className="text-xs text-muted-foreground">Created with the project.</p>
                )}
                {errors.defaultEnvironmentId && (
                  <p className="text-xs text-destructive">
                    {errors.defaultEnvironmentId.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel htmlFor="status">Status</FieldLabel>
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
                <FieldLabel
                  htmlFor="productOwnerId"
                  required
                  info="Receives comments posted on this project’s test cases and replies to them. Add QA under In charge."
                >
                  Product owner (PO)
                </FieldLabel>
                <Select
                  value={productOwnerId ?? ""}
                  onValueChange={(value) =>
                    setValue("productOwnerId", value, { shouldDirty: true, shouldValidate: true })
                  }
                >
                  <SelectTrigger id="productOwnerId" aria-invalid={Boolean(errors.productOwnerId)}>
                    <SelectValue placeholder="Choose the product owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {productOwners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {owner.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.productOwnerId && (
                  <p className="text-xs text-destructive">{errors.productOwnerId.message}</p>
                )}
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
                  Only these people and admins can open this project.
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

      <EnvironmentDialog
        projectId={project?.id}
        environment={addingEnvironment ? "new" : null}
        onClose={() => setAddingEnvironment(false)}
        suggestedName={environmentOptions.length === 0 ? "UAT" : "PRO"}
        // A new project has nowhere to save one yet: it is created with it.
        onDraft={isEdit ? undefined : addDraft}
        onCreated={(env) => {
          setAdded((list) => [...list, { id: env.id, name: env.name }]);
          setValue("defaultEnvironmentId", env.id, { shouldDirty: true });
        }}
      />
    </>
  );
}

/**
 * A field's label on a row of fixed height, so fields side by side line up
 * whether or not they carry a red star or an ⓘ note shown on hover.
 */
function FieldLabel({
  htmlFor,
  required = false,
  info,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-5 items-center gap-1.5">
      <Label htmlFor={htmlFor}>
        {children}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {info && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={info}>
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{info}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
