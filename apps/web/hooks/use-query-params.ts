"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Read and write list state (filters, sort, page) through the URL.
 *
 * Keeping filters in the URL means the server component re-renders with fresh
 * data, and a filtered view stays shareable and survives a refresh.
 */
export function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const get = useCallback(
    (key: string, fallback = "") => searchParams.get(key) ?? fallback,
    [searchParams],
  );

  /**
   * Merge `updates` into the query string. A value of `null`, `""` or `"ALL"`
   * removes the key so the URL stays clean.
   */
  const setParams = useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (
          value === null ||
          value === undefined ||
          value === "" ||
          value === "ALL"
        ) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }

      // Any change other than paging should return to page 1, otherwise a
      // narrower filter can leave the user stranded on an empty page.
      if (!("page" in updates)) next.delete("page");

      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  return { get, setParams, isPending, searchParams };
}
