import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { CreateUserButton } from "@/features/users/components/user-form-dialog";
import { UserTable } from "@/features/users/components/user-table";
import { ROLE_VALUES, ROLES, type Role } from "@/lib/constants";
import { requireRole } from "@/lib/session";
import { listUsers } from "@/services/user.service";

export const metadata: Metadata = { title: "Users" };

/** Plural role labels for the summary row; "QA" is already a plural-safe label. */
const ROLE_COUNT_LABELS: Record<Role, (count: number) => string> = {
  ADMIN: (count) => `${count} ${count === 1 ? "Admin" : "Admins"}`,
  QA: (count) => `${count} QA`,
  DEVELOPER: (count) => `${count} ${count === 1 ? "Developer" : "Developers"}`,
};

export default async function AdminUsersPage() {
  const admin = await requireRole(ROLES.ADMIN);
  const users = await listUsers();

  // Derived from the list we already have — no extra service call.
  // `PublicUser.role` is already narrowed to Role by the service.
  const counts: Record<Role, number> = { ADMIN: 0, QA: 0, DEVELOPER: 0 };
  for (const user of users) {
    counts[user.role] += 1;
  }
  const summary = ROLE_VALUES.filter((role) => counts[role] > 0)
    .map((role) => ROLE_COUNT_LABELS[role](counts[role]))
    .join(" · ");

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Users" }]} />

      <PageHeader
        title="Users"
        description="Create accounts, change roles and disable access for your team."
        actions={<CreateUserButton />}
      >
        <p className="text-sm text-muted-foreground">
          {users.length === 0
            ? "No accounts yet."
            : `${users.length} ${users.length === 1 ? "account" : "accounts"} — ${summary}`}
        </p>
      </PageHeader>

      <UserTable users={users} currentUserId={admin.id} />
    </div>
  );
}
