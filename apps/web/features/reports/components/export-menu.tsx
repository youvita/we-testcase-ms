"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Download, FileSpreadsheet, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PLATFORMS, PLATFORM_LABELS, type ExcelReportScope, type Platform } from "@/lib/constants";
import { downloadFile, errorMessage } from "@/utils/api-client";

type ExportFormat = "excel" | "pdf";

/** The test case list's filter params — see TestCaseFilters. */
const LIST_FILTER_KEYS = [
  "search",
  "moduleId",
  "subModule",
  "testType",
  "priority",
  "status",
  "fixStatus",
  "platform",
  "automated",
] as const;

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
 *
 * With environments, the menu asks whose results to report: every case's
 * latest anywhere (the default), or its latest on one environment — so a PRO
 * report is not coloured by UAT passes.
 *
 * Given `onImport`, it becomes one "Excel" menu: Export (its choices in a
 * submenu) and Import — the two ways a sheet moves in and out.
 */
export function ExportMenu({
  projectId,
  format = "excel",
  excelScope = "summary",
  platforms = [...PLATFORMS],
  environments = [],
  onImport,
  withListFilters = false,
}: {
  projectId: string;
  format?: ExportFormat;
  excelScope?: ExcelReportScope;
  /** The project's platforms — the only ones worth filtering by. */
  platforms?: Platform[];
  /** Environment names results were recorded on, the default first. */
  environments?: string[];
  /** Adds "Import" and turns the button into an Excel menu. */
  onImport?: () => void;
  /**
   * Export what the test case list shows: its filters, read from the page's
   * URL, decide the rows, and there is nothing else to choose.
   */
  withListFilters?: boolean;
}) {
  const searchParams = useSearchParams();
  const listFilters = withListFilters
    ? LIST_FILTER_KEYS.flatMap((key) => {
        const value = searchParams.get(key);
        return value ? [[key, value] as const] : [];
      })
    : [];
  const [pending, setPending] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  /** "" means every environment. */
  const [environment, setEnvironment] = useState("");

  const hint =
    format === "pdf"
      ? EXPORT_HINTS.pdf.default
      : (EXPORT_HINTS.excel[excelScope] ?? EXPORT_HINTS.excel.default);

  // Only the sheets that list test-case rows have anything to filter by
  // platform — the summary sheet has no rows, so it keeps a plain button.
  // With a single platform there is nothing to choose between.
  const canFilterByPlatform =
    !withListFilters &&
    format === "excel" &&
    (excelScope === "cases" || excelScope === "failed") &&
    platforms.length > 1;
  const canFilterByEnvironment = !withListFilters && environments.length > 0;

  async function handleExport() {
    setPending(true);
    try {
      const query = new URLSearchParams();
      if (format === "excel") query.set("scope", excelScope);
      if (format === "excel" && selectedPlatforms.length > 0) {
        query.set("platform", selectedPlatforms.join(","));
      }
      if (environment) query.set("environment", environment);
      for (const [key, value] of listFilters) query.set(key, value);
      const url = `/api/projects/${projectId}/reports/${format}${query.size ? `?${query}` : ""}`;
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

  const hasChoices = canFilterByPlatform || canFilterByEnvironment;
  const icon = pending ? (
    <Loader2 className="mr-2 size-4 animate-spin" />
  ) : (
    <Download className="mr-2 size-4" />
  );
  // Menu items space their icon themselves (gap-2); a margin would double it.
  const itemIcon = pending ? <Loader2 className="animate-spin" /> : <Download />;

  const exportChoices = (
    <>
      {canFilterByEnvironment && (
        <>
          <DropdownMenuLabel>Results from</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={environment} onValueChange={setEnvironment}>
            <DropdownMenuRadioItem value="" onSelect={(event) => event.preventDefault()}>
              All environments
            </DropdownMenuRadioItem>
            {environments.map((name) => (
              <DropdownMenuRadioItem
                key={name}
                value={name}
                onSelect={(event) => event.preventDefault()}
              >
                {name} only
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {canFilterByPlatform && <DropdownMenuSeparator />}
        </>
      )}
      {canFilterByPlatform && (
        <DropdownMenuLabel>Filter by platform</DropdownMenuLabel>
      )}
      {canFilterByPlatform && platforms.map((platform) => (
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
        {itemIcon}
        {[
          "Download",
          environment && `${environment} results`,
          selectedPlatforms.length > 0 &&
            `${selectedPlatforms.length} platform${selectedPlatforms.length === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </DropdownMenuItem>
    </>
  );

  if (onImport) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-2 size-4" />
            )}
            Excel
            <ChevronDown className="ml-2 size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasChoices ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Download />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">{exportChoices}</DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled={pending} onSelect={() => void handleExport()} title={hint}>
              {itemIcon}
              Export
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onImport}>
            <FileUp />
            Import
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const button = (
    <Button
      variant="outline"
      disabled={pending}
      title={hint}
      onClick={hasChoices ? undefined : () => void handleExport()}
    >
      {icon}
      Export
    </Button>
  );

  if (!hasChoices) return button;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {exportChoices}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
