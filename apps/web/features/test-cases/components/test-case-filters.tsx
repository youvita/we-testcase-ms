"use client";

import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/shared/search-input";
import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  FIX_STATUSES,
  FIX_STATUS_SHORT_LABELS,
  PLATFORM_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
} from "@/lib/constants";
import { useQueryParams } from "@/hooks/use-query-params";
import type { Platform, SubModuleOption } from "@/types";
import { TEST_CASE_SOURCE_LABELS, TEST_CASE_SOURCES } from "@wetestcase/dto";

export type ModuleOption = { id: string; name: string };

/** The sub-module filter's value for cases that have none (NO_SUB_MODULE). */
const NO_SUB_MODULE = "-";

/**
 * Filter bar for the test case list.
 *
 * Search, module and status stay in view — what a tester narrows by while
 * working through a list. The rest sit behind "Filters", which counts the
 * ones in use so a hidden filter never quietly empties the list.
 *
 * State lives in the URL so the server component refetches, and a filtered view
 * is shareable and survives a reload.
 */
export function TestCaseFilters({
  modules,
  subModules,
  platforms,
}: {
  modules: ModuleOption[];
  subModules: SubModuleOption[];
  /** The project's platforms. The filter is hidden when there is only one. */
  platforms: Platform[];
}) {
  const { get, setParams, isPending } = useQueryParams();

  const search = get("search");
  const moduleId = get("moduleId", "ALL");
  const subModule = get("subModule", "ALL");
  // Every module's sub-modules until a module is chosen, then just its own.
  const subModuleOptions =
    moduleId === "ALL" ? subModules : subModules.filter((sub) => sub.moduleId === moduleId);
  const moduleName = new Map(modules.map((mod) => [mod.id, mod.name]));
  // An option names its module too: picking one sets both filters.
  const optionValue = (sub: { moduleId: string; name: string }) => `${sub.moduleId}\t${sub.name}`;
  const subModuleValue =
    subModule === "ALL" || subModule === NO_SUB_MODULE || moduleId === "ALL"
      ? subModule
      : optionValue({ moduleId, name: subModule });
  const testType = get("testType", "ALL");
  const priority = get("priority", "ALL");
  const status = get("status", "ALL");
  const fixStatus = get("fixStatus", "ALL");
  const platform = get("platform", "ALL");
  const automated = get("automated", "ALL");
  const source = get("source", "ALL");
  const requirementChanged = get("requirementChanged", "ALL");

  const moreActive = [platform, automated, source, requirementChanged, testType, priority, fixStatus].filter(
    (value) => value !== "ALL",
  ).length;
  const hasFilters =
    Boolean(search) ||
    moduleId !== "ALL" ||
    subModule !== "ALL" ||
    status !== "ALL" ||
    moreActive > 0;

  return (
    <div data-tour="cases-filters" className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <SearchInput
        value={search}
        onChange={(value) => setParams({ search: value })}
        placeholder="Search TC ID, title or steps…"
        // Matches the OR in buildWhere() — keep the two in step.
        tooltip="Matches the TC ID, the title, the sub-module and the steps. Case-insensitive, and any part of the text counts."
        // A fixed width, not `max-w-*`: with width auto the flex item shrinks
        // to the input's intrinsic size and clips the placeholder.
        className="w-full lg:w-[22rem]"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
        <Select
          value={moduleId}
          // Sub-modules belong to a module; a new module starts without one.
          onValueChange={(value) => setParams({ moduleId: value, subModule: null })}
        >
          <SelectTrigger className="lg:w-[170px]" aria-label="Filter by module">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All modules</SelectItem>
            {modules.map((mod) => (
              <SelectItem key={mod.id} value={mod.id}>
                {mod.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Only once a module is chosen: its sub-modules are what narrow it. */}
        {((moduleId !== "ALL" && subModuleOptions.length > 0) || subModule !== "ALL") && (
          <Select
            value={subModuleValue}
            onValueChange={(value) => {
              if (value === "ALL" || value === NO_SUB_MODULE) {
                setParams({ subModule: value === "ALL" ? null : value });
                return;
              }
              const [pickedModule, name] = value.split("\t") as [string, string];
              setParams({ moduleId: pickedModule, subModule: name });
            }}
          >
            <SelectTrigger className="lg:w-[190px]" aria-label="Filter by sub-module">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sub-modules</SelectItem>
              {subModuleOptions.map((sub) => (
                <SelectItem key={optionValue(sub)} value={optionValue(sub)}>
                  {moduleId === "ALL" ? `${moduleName.get(sub.moduleId) ?? "?"} › ${sub.name}` : sub.name} ({sub.count})
                </SelectItem>
              ))}
              {/* A sub-module from a shared link that no case uses any more. */}
              {subModuleValue !== "ALL" &&
                subModuleValue !== NO_SUB_MODULE &&
                !subModuleOptions.some((sub) => optionValue(sub) === subModuleValue) && (
                  <SelectItem value={subModuleValue}>{subModule}</SelectItem>
                )}
              <SelectItem value={NO_SUB_MODULE}>No sub-module</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Select
          value={status}
          onValueChange={(value) => setParams({ status: value })}
        >
          <SelectTrigger className="lg:w-[150px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {EXECUTION_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {EXECUTION_STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="justify-start">
              <SlidersHorizontal className="mr-2 size-4" />
              Filters
              {moreActive > 0 && (
                <span className="ml-2 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                  {moreActive}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            {(platforms.length > 1 || platform !== "ALL") && (
              <div className="space-y-1.5">
                <Label htmlFor="filter-platform">Platform</Label>
                <Select
                  value={platform}
                  onValueChange={(value) => setParams({ platform: value })}
                >
                  <SelectTrigger id="filter-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All platforms</SelectItem>
                    {platforms.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PLATFORM_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="filter-automated">Automation</Label>
              <Select
                value={automated}
                onValueChange={(value) => setParams({ automated: value })}
              >
                <SelectTrigger id="filter-automated">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Manual &amp; automated</SelectItem>
                  <SelectItem value="yes">Automated</SelectItem>
                  <SelectItem value="no">Not automated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-source">Source</Label>
              <Select value={source} onValueChange={(value) => setParams({ source: value })}>
                <SelectTrigger id="filter-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any source</SelectItem>
                  {TEST_CASE_SOURCES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {TEST_CASE_SOURCE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-requirement-changed">Requirements</Label>
              <Select
                value={requirementChanged}
                onValueChange={(value) => setParams({ requirementChanged: value })}
              >
                <SelectTrigger id="filter-requirement-changed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any</SelectItem>
                  <SelectItem value="yes">Requirement changed — may need updating</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-test-type">Test type</Label>
              <Select
                value={testType}
                onValueChange={(value) => setParams({ testType: value })}
              >
                <SelectTrigger id="filter-test-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All test types</SelectItem>
                  {TEST_TYPES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {TEST_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filter-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setParams({ priority: value })}
              >
                <SelectTrigger id="filter-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All priorities</SelectItem>
                  {PRIORITIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PRIORITY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* A second axis, not a variant of status: a case can be Failed
                *and* flagged ready for retest, and "what should I run next?" is
                exactly that combination. */}
            <div className="space-y-1.5">
              <Label htmlFor="filter-fix-status">Developer update</Label>
              <Select
                value={fixStatus}
                onValueChange={(value) => setParams({ fixStatus: value })}
              >
                <SelectTrigger id="filter-fix-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any dev update</SelectItem>
                  <SelectItem value="NONE">No dev update</SelectItem>
                  {FIX_STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {FIX_STATUS_SHORT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            setParams({
              search: null,
              moduleId: null,
              subModule: null,
              testType: null,
              priority: null,
              status: null,
              fixStatus: null,
              platform: null,
              automated: null,
              source: null,
              requirementChanged: null,
            })
          }
        >
          <X className="mr-1.5 size-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
