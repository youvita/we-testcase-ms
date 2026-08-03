import {
  FolderKanban,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ROLES, type Role } from "@/lib/constants";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles allowed to see the link. Omitted means everyone signed in. */
  roles?: readonly Role[];
  /** Match nested routes as active (e.g. /projects/abc under /projects). */
  matchNested?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    matchNested: true,
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: Users,
    roles: [ROLES.ADMIN],
    matchNested: true,
  },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.matchNested && pathname.startsWith(`${item.href}/`));
}
