"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Role } from "@/lib/constants";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/constants";

import { isNavItemActive, navItemsForRole } from "./nav-config";

/**
 * Primary navigation. Rendered inside the fixed desktop sidebar and inside the
 * mobile sheet, so it takes `onNavigate` to let the sheet close itself.
 */
export function SidebarNav({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(role);

  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar text-sidebar-foreground">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-4 pt-5 text-white"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/10">
          <FlaskConical className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">
            TestCase MS
          </span>
          <span className="block truncate text-xs text-sidebar-foreground/60">
            Test management
          </span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-2" aria-label="Main">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-white",
              )}
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-4">
        <p className="text-xs font-medium text-sidebar-foreground/80">
          Signed in as {ROLE_LABELS[role]}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-sidebar-foreground/50">
          {ROLE_DESCRIPTIONS[role]}
        </p>
      </div>
    </div>
  );
}
