"use client";

import { useState } from "react";
import { Copy, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/features/reports/components/export-menu";
import type { Platform, SubModuleOption } from "@/types";

import { CopyToProjectDialog } from "./copy-to-project-dialog";
import { ImportDialog } from "./import-dialog";
import {
  TestCaseFormDialog,
  type ModuleOption,
} from "./test-case-form-dialog";

/**
 * "Excel" (export and import), "Copy to project" and "New test case" for
 * the test case list header. Exploring the app with AI lives on the
 * Requirements page, where its suggestions are reviewed.
 *
 * Owns the dialogs so the page itself can stay a server component.
 */
export function TestCaseToolbar({
  projectId,
  modules,
  subModules,
  platforms,
}: {
  projectId: string;
  modules: ModuleOption[];
  subModules: SubModuleOption[];
  platforms: Platform[];
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <span data-tour="cases-excel" className="inline-flex">
        <ExportMenu
          projectId={projectId}
          excelScope="cases"
          platforms={platforms}
          withListFilters
          onImport={() => setImportOpen(true)}
        />
      </span>

      <Button variant="outline" onClick={() => setCopyOpen(true)} data-tour="cases-copy">
        <Copy className="mr-2 size-4" />
        Copy to project
      </Button>

      {/* Enabled even with no modules: the dialog creates the first one itself,
          so a new project is not a dead end here. */}
      <Button onClick={() => setFormOpen(true)} data-tour="cases-new">
        <Plus className="mr-2 size-4" />
        New test case
      </Button>

      <ImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
      />

      <CopyToProjectDialog
        projectId={projectId}
        modules={modules}
        open={copyOpen}
        onOpenChange={setCopyOpen}
      />

      <TestCaseFormDialog
        projectId={projectId}
        modules={modules}
        subModules={subModules}
        platforms={platforms}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </>
  );
}
