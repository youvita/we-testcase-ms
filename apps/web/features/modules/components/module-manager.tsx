"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { api, errorMessage } from "@/utils/api-client";

export type ModuleRow = {
  id: string;
  name: string;
  description: string | null;
  testCaseCount: number;
};

/**
 * Create/rename/delete the modules inside a project.
 *
 * Deleting a module cascades to its test cases, so the confirmation states the
 * exact count that will be lost.
 */
export function ModuleManager({
  projectId,
  modules,
  canManage,
}: {
  projectId: string;
  modules: ModuleRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ModuleRow | null>(null);
  const [deleting, setDeleting] = useState<ModuleRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setFormOpen(true);
  }

  function openEdit(mod: ModuleRow) {
    setEditing(mod);
    setName(mod.name);
    setDescription(mod.description ?? "");
    setFormOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Module name is required");
      return;
    }

    setSaving(true);
    try {
      const payload = { name: trimmed, description, position: 0 };

      if (editing) {
        await api.patch(`/api/modules/${editing.id}`, payload);
        toast.success("Module updated");
      } else {
        await api.post(`/api/projects/${projectId}/modules`, payload);
        toast.success("Module created");
      }

      setFormOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/modules/${deleting.id}`);
      toast.success(`Deleted "${deleting.name}"`);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Modules</CardTitle>
          <CardDescription>
            Group test cases by feature. Importing a sheet creates any missing
            modules automatically.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            Add
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {modules.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No modules yet"
            description={
              canManage
                ? "Add modules such as Login, Transfer or Payment — or just import an Excel file and let the module column create them."
                : "This project has no modules yet."
            }
            action={
              canManage ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-2 size-4" />
                  Add module
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {modules.map((mod) => (
              <li
                key={mod.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/projects/${projectId}/test-cases?moduleId=${mod.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {mod.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {mod.testCaseCount} test case
                    {mod.testCaseCount === 1 ? "" : "s"}
                    {mod.description ? ` · ${mod.description}` : ""}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(mod)}
                      aria-label={`Edit ${mod.name}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(mod)}
                      aria-label={`Delete ${mod.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit module" : "New module"}</DialogTitle>
            <DialogDescription>
              Module names must be unique within the project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="module-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="module-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Login"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="module-description">Description</Label>
              <Textarea
                id="module-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editing ? "Save changes" : "Create module"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description={
          (deleting?.testCaseCount ?? 0) > 0 ? (
            <>
              This also deletes{" "}
              <strong>{deleting?.testCaseCount} test cases</strong> and their
              execution history. This cannot be undone.
            </>
          ) : (
            "This module has no test cases. It will be removed."
          )
        }
        confirmLabel="Delete module"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
