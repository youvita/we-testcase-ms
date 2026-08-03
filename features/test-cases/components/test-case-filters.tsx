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
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
} from "@/lib/constants";
import { useQueryParams } from "@/hooks/use-query-params";

export type ModuleOption = { id: string; name: string };

/**
 * Filter bar for the test case list.
 *
 * State lives in the URL so the server component refetches, and a filtered view
 * is shareable and survives a reload.
 */
export function TestCaseFilters({ modules }: { modules: ModuleOption[] }) {
  const { get, setParams, isPending } = useQueryParams();

  const search = get("search");
  const moduleId = get("moduleId", "ALL");
  const testType = get("testType", "ALL");
  const priority = get("priority", "ALL");
  const status = get("status", "ALL");
  const fixStatus = get("fixStatus", "ALL");

  const hasFilters =
    Boolean(search) ||
    moduleId !== "ALL" ||
    testType !== "ALL" ||
    priority !== "ALL" ||
    status !== "ALL" ||
    fixStatus !== "ALL";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <SearchInput
        value={search}
        onChange={(value) => setParams({ search: value })}
        placeholder="Search TC ID, title or steps…"
        // Matches the OR in buildWhere() — keep the two in step.
        tooltip="Matches the TC ID, the title and the steps. Case-insensitive, and any part of the text counts."
        // A fixed width, not `max-w-*`: with width auto the flex item shrinks
        // to the input's intrinsic size and clips the placeholder.
        className="w-full lg:w-[22rem]"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
        <Select
          value={moduleId}
          onValueChange={(value) => setParams({ moduleId: value })}
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
              testType: null,
              priority: null,
              status: null,
              fixStatus: null,
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
