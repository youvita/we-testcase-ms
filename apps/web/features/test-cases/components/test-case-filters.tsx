"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
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

export type ModuleOption = { id: string; name: string };

/** The sub-module filter's value for cases that have none (NO_SUB_MODULE). */
const NO_SUB_MODULE = "-";

/**
 * Filter bar for the test case list.
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

  const hasFilters =
    Boolean(search) ||
    moduleId !== "ALL" ||
    subModule !== "ALL" ||
    testType !== "ALL" ||
    priority !== "ALL" ||
    status !== "ALL" ||
    fixStatus !== "ALL" ||
    platform !== "ALL" ||
    automated !== "ALL";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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

        {(subModules.length > 0 || subModule !== "ALL") && (
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

        {(platforms.length > 1 || platform !== "ALL") && (
          <Select
            value={platform}
            onValueChange={(value) => setParams({ platform: value })}
          >
            <SelectTrigger className="lg:w-[150px]" aria-label="Filter by platform">
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
        )}

        <Select
          value={automated}
          onValueChange={(value) => setParams({ automated: value })}
        >
          <SelectTrigger className="lg:w-[150px]" aria-label="Filter by automation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Manual &amp; automated</SelectItem>
            <SelectItem value="yes">Automated</SelectItem>
            <SelectItem value="no">Not automated</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={testType}
          onValueChange={(value) => setParams({ testType: value })}
        >
          <SelectTrigger className="lg:w-[160px]" aria-label="Filter by test type">
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

        <Select
          value={priority}
          onValueChange={(value) => setParams({ priority: value })}
        >
          <SelectTrigger className="lg:w-[150px]" aria-label="Filter by priority">
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

        {/* A second axis, not a variant of the one above: a case can be Failed
            *and* flagged ready for retest, and "what should I run next?" is
            exactly that combination. */}
        <Select
          value={fixStatus}
          onValueChange={(value) => setParams({ fixStatus: value })}
        >
          <SelectTrigger
            className="lg:w-[175px]"
            aria-label="Filter by developer update"
          >
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
