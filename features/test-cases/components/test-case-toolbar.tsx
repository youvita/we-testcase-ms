"use client";

import { useState } from "react";
import { FileUp, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ImportDialog } from "./import-dialog";
import {
  TestCaseFormDialog,
  type ModuleOption,
} from "./test-case-form-dialog";

/**
 * "Import" and "New test case" actions for the test case list header.
 *
 * Owns both dialogs so the page itself can stay a server component.
 */
export function TestCaseToolbar({
  projectId,
  modules,
}: {
  projectId: string;
  modules: ModuleOption[];
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <FileUp className="mr-2 size-4" />
        Import Excel
      </Button>

      <Button
        onClick={() => setFormOpen(true)}
        disabled={modules.length === 0}
        title={
          modules.length === 0
            ? "Create a module first, or import a sheet with a Module column"
            : undefined
        }
      >
        <Plus className="mr-2 size-4" />
        New test case
      </Button>

      <ImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
      />

      <TestCaseFormDialog
        projectId={projectId}
        modules={modules}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </>
  );
}
