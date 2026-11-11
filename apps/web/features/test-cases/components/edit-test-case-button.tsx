"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Platform, SubModuleOption } from "@/types";

import { TestCaseFormDialog, type ModuleOption } from "./test-case-form-dialog";

/** Edit the case from its own page, with the same form as the list's. */
export function EditTestCaseButton({
  projectId,
  testCaseId,
  modules,
  subModules,
  platforms,
}: {
  projectId: string;
  testCaseId: string;
  modules: ModuleOption[];
  subModules: SubModuleOption[];
  platforms: Platform[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 size-4" />
        Edit
      </Button>
      <TestCaseFormDialog
        projectId={projectId}
        modules={modules}
        subModules={subModules}
        platforms={platforms}
        testCaseId={testCaseId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
