"use client";

import { useState } from "react";

import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

/**
 * Paging over a list that is already in memory, for PaginationControls.
 *
 * `resetKey` is whatever the list is filtered by: when it changes the view
 * goes back to page 1. The page is also clamped to the last one, so reviewing
 * away the final rows of a page never leaves the user on an empty one.
 */
export function useClientPagination<T>(items: T[], resetKey = "") {
  const [state, setState] = useState({ page: 1, pageSize: DEFAULT_PAGE_SIZE, resetKey });

  if (state.resetKey !== resetKey) {
    setState({ ...state, page: 1, resetKey });
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(state.page, totalPages);
  const start = (page - 1) * state.pageSize;

  return {
    pageItems: items.slice(start, start + state.pageSize),
    page,
    pageSize: state.pageSize,
    total,
    totalPages,
    setPage: (next: number) => setState((current) => ({ ...current, page: next })),
    setPageSize: (next: number) => setState((current) => ({ ...current, page: 1, pageSize: next })),
  };
}
