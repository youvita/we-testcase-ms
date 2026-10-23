"use client";

import { useState } from "react";
import Link from "next/link";
import { FileUp, Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Platform } from "@/types";

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
  platforms,
}: {
  projectId: string;
  modules: ModuleOption[];
  platforms: Platform[];
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      {platforms.includes("WEB") && (
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}/requirements?explore=1`}>
            <Sparkles className="mr-2 size-4" />
            Suggest with AI
          </Link>
        </Button>
      )}

      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <FileUp className="mr-2 size-4" />
        Import Excel
      </Button>

      {/* Enabled even with no modules: the dialog creates the first one itself,
          so a new project is not a dead end here. */}
      <Button onClick={() => setFormOpen(true)}>
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
        platforms={platforms}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
    </>
  );
}
