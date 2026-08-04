"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ExcelReportScope } from "@/lib/constants";
import { downloadFile, errorMessage } from "@/utils/api-client";

type ExportFormat = "excel" | "pdf";

const EXPORT_HINTS: Record<ExportFormat, Partial<Record<ExcelReportScope, string>> & { default: string }> = {
  pdf: { default: "Download PDF summary report" },
  excel: {
    default: "Download Excel report",
    summary: "Download Summary sheet",
    cases: "Download Summary and all test cases",
    failed: "Download Summary and failed cases",
  },
};

/**
 * Report download button.
 *
 * Goes through `downloadFile` rather than a plain anchor so a failed export
 * surfaces as a toast instead of navigating the user to a raw JSON error.
 *
 * Project overview uses PDF summary; test-case and failed pages use Excel.
 */
export function ExportMenu({
  projectId,
  format = "excel",
  excelScope = "summary",
}: {
  projectId: string;
  format?: ExportFormat;
  excelScope?: ExcelReportScope;
}) {
  const [pending, setPending] = useState(false);

  const hint =
    format === "pdf"
      ? EXPORT_HINTS.pdf.default
      : (EXPORT_HINTS.excel[excelScope] ?? EXPORT_HINTS.excel.default);

  async function handleExport() {
    setPending(true);
    try {
      const url =
        format === "pdf"
          ? `/api/projects/${projectId}/reports/pdf`
          : `/api/projects/${projectId}/reports/excel?scope=${excelScope}`;
      await downloadFile(url);
      toast.success(
        format === "pdf" ? "PDF report downloaded" : "Excel report downloaded",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      disabled={pending}
      title={hint}
      onClick={() => void handleExport()}
    >
      {pending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Download className="mr-2 size-4" />
      )}
      Export
    </Button>
  );
}
