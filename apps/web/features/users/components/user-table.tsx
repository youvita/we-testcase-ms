"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { RoleBadge } from "@/components/shared/priority-badge";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_VALUES, ROLES, type Role } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PublicUser } from "@/types";
import { api, errorMessage } from "@/utils/api-client";
import { formatDate, initials } from "@/utils/format";

import { UserFormDialog } from "./user-form-dialog";


function StatusPill({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        isActive
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-emerald-500" : "bg-muted-foreground/60",
        )}
        aria-hidden
      />
      {isActive ? "Active" : "Disabled"}
    </span>
  );
}

export function UserTable({
  users,
  currentUserId,
}: {
  users: PublicUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [deleting, setDeleting] = useState<PublicUser | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // The whole list is already loaded server-side, so filtering here avoids a
  // round trip per keystroke.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term),
    );
  }, [users, search]);

  async function toggleActive(user: PublicUser) {
    setPendingId(user.id);
    try {
      await api.patch<PublicUser>(`/api/users/${user.id}`, {
        isActive: !user.isActive,
      });
      toast.success(
        user.isActive ? `${user.name} was disabled` : `${user.name} was enabled`,
      );
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete(user: PublicUser) {
    try {
      await api.delete<{ deleted: boolean }>(`/api/users/${user.id}`);
      toast.success(`${user.name} was deleted`);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      // Rethrow so ConfirmDialog stays open and the admin can retry or cancel.
      throw error;
    }
  }

  if (users.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No users yet"
        description="Add the first account to give your team access to this workspace."
      />
    );
  }

  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name or email…"
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No matching users"
          description={`Nothing matched “${search.trim()}”. Try a different name or email.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((user) => {
                const isSelf = user.id === currentUserId;
                const isPending = pendingId === user.id;

                return (
                  <TableRow key={user.id}>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          {user.image && (
                            <AvatarImage src={user.image} alt="" />
                          )}
                          <AvatarFallback className="text-xs">
                            {initials(user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {user.name}
                            {isSelf && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      <StatusPill isActive={user.isActive} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            disabled={isPending}
                            aria-label={`Actions for ${user.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel>Manage</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => setEditing(user)}>
                            <Pencil className="size-4" aria-hidden />
                            Edit
                          </DropdownMenuItem>

                          {isSelf ? (
                            <DropdownMenuItem
                              disabled
                              // Radix keeps disabled items in the tree, so the
                              // reason is visible rather than the action simply
                              // missing.
                              onSelect={(event) => event.preventDefault()}
                            >
                              <UserX className="size-4" aria-hidden />
                              Disable — not your own account
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => void toggleActive(user)}
                            >
                              {user.isActive ? (
                                <UserX className="size-4" aria-hidden />
                              ) : (
                                <UserCheck className="size-4" aria-hidden />
                              )}
                              {user.isActive ? "Disable" : "Enable"}
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {isSelf ? (
                            <DropdownMenuItem
                              disabled
                              onSelect={(event) => event.preventDefault()}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              Delete — not your own account
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setDeleting(user)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <UserFormDialog
          mode="edit"
          user={editing}
          currentUserId={currentUserId}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
          title={`Delete ${deleting.name}?`}
          description="This permanently removes the account. Users with test history cannot be deleted — disable them instead."
          confirmLabel="Delete user"
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </div>
  );
}
