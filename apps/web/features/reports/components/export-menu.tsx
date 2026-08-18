"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PLATFORMS, PLATFORM_LABELS, type ExcelReportScope, type Platform } from "@/lib/constants";
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);

  const hint =
    format === "pdf"
      ? EXPORT_HINTS.pdf.default
      : (EXPORT_HINTS.excel[excelScope] ?? EXPORT_HINTS.excel.default);

  // Only the sheets that list test-case rows have anything to filter by
  // platform — the summary sheet has no rows, so it keeps a plain button.
  const canFilterByPlatform =
    format === "excel" && (excelScope === "cases" || excelScope === "failed");

  async function handleExport() {
    setPending(true);
    try {
      const url =
        format === "pdf"
          ? `/api/projects/${projectId}/reports/pdf`
          : `/api/projects/${projectId}/reports/excel?scope=${excelScope}${
              selectedPlatforms.length > 0
                ? `&platform=${selectedPlatforms.join(",")}`
                : ""
            }`;
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

  const button = (
    <Button
      variant="outline"
      disabled={pending}
      title={hint}
      onClick={canFilterByPlatform ? undefined : () => void handleExport()}
    >
      {pending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <Download className="mr-2 size-4" />
      )}
      Export
    </Button>
  );

  if (!canFilterByPlatform) return button;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Filter by platform</DropdownMenuLabel>
        {PLATFORMS.map((platform) => (
          <DropdownMenuCheckboxItem
            key={platform}
            checked={selectedPlatforms.includes(platform)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              setSelectedPlatforms((prev) =>
                checked
                  ? [...prev, platform]
                  : prev.filter((p) => p !== platform),
              )
            }
          >
            {PLATFORM_LABELS[platform]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={() => void handleExport()}
        >
          {pending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          {selectedPlatforms.length > 0
            ? `Download (${selectedPlatforms.length} selected)`
            : "Download all"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
