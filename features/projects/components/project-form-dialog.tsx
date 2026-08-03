"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/constants";
import { projectSchema, type ProjectInput } from "@/lib/validations";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { toDateInputValue } from "@/utils/format";
import type { Project } from "@/types";

export type QaOwnerOption = { id: string; name: string; email: string };

const NO_OWNER = "none";

/**
 * Create/edit dialog for a project. Controlled by the caller so it can be
 * opened from a page header button or a row action.
 */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  qaOwners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted for create. */
  project?: Project;
  qaOwners: QaOwnerOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(project);

  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      description: "",
      version: "",
      environment: "",
      status: "PLANNING",
      qaOwnerId: NO_OWNER,
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
      startDate: toDateInputValue(project?.startDate),
      endDate: toDateInputValue(project?.endDate),
    });
  }, [open, project, reset]);

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
              <Input
                id="environment"
                placeholder="UAT"
                {...register("environment")}
              />
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
            </div>
          </div>

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
