"use client";

import { useEffect, useState } from "react";
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
import { api, errorMessage } from "@/utils/api-client";
import type { SubModuleOption, TestCaseListItem } from "@/types";

/** Put the selected cases in one sub-module, or take them out of any. */
export function SubModuleDialog({
  projectId,
  cases,
  subModules,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  cases: TestCaseListItem[];
  subModules: SubModuleOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState<"set" | "clear" | null>(null);

  // Start from the name they share, if they already share one.
  useEffect(() => {
    if (!open) return;
    const names = new Set(cases.map((item) => item.subModule ?? ""));
    setName(names.size === 1 ? [...names][0]! : "");
  }, [open, cases]);

  const moduleIds = new Set(cases.map((item) => item.moduleId));
  const suggestions = [
    ...new Set(subModules.filter((sub) => moduleIds.has(sub.moduleId)).map((sub) => sub.name)),
  ];
  const count = `${cases.length} test case${cases.length === 1 ? "" : "s"}`;

  async function save(subModule: string) {
    setSaving(subModule ? "set" : "clear");
    try {
      await api.patch(`/api/projects/${projectId}/test-cases`, {
        ids: cases.map((item) => item.id),
        subModule,
      });
      toast.success(subModule ? `Moved ${count} to "${subModule}"` : `Removed the sub-module from ${count}`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set sub-module</DialogTitle>
          <DialogDescription>
            Groups {count} inside {moduleIds.size === 1 ? "their module" : "each one's own module"}, e.g. Create or Delete.
          </DialogDescription>
        </DialogHeader>

        <form
          id="sub-module-form"
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void save(name.trim());
          }}
        >
          <Label htmlFor="bulk-sub-module">Sub-module</Label>
          <Input
            id="bulk-sub-module"
            value={name}
            maxLength={120}
            list="bulk-sub-module-suggestions"
            autoComplete="off"
            placeholder="Create"
            onChange={(event) => setName(event.target.value)}
          />
          <datalist id="bulk-sub-module-suggestions">
            {suggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </form>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={saving !== null || cases.every((item) => !item.subModule)}
            onClick={() => void save("")}
          >
            {saving === "clear" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Remove sub-module
          </Button>
          <Button type="submit" form="sub-module-form" disabled={saving !== null || !name.trim()}>
            {saving === "set" && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
