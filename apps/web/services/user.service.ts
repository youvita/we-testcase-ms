import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/api";
import { ROLES, toRole } from "@/lib/constants";
import type { UserCreateInput, UserUpdateInput } from "@/lib/validations";
import type { PublicUser } from "@/types";

const publicSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

type UserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
};

/** Narrow the database row's String role to the Role union. */
function toPublicUser(row: UserRow): PublicUser {
  return { ...row, role: toRole(row.role) };
}

export async function listUsers(search?: string): Promise<PublicUser[]> {
  const term = search?.trim();
  const rows = await prisma.user.findMany({
    where: term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: publicSelect,
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(toPublicUser);
}

export async function getUser(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicSelect,
  });
  if (!user) throw notFound("User");
  return toPublicUser(user);
}

/**
 * Create a user as an Admin.
 *
 * Goes through Better Auth's sign-up API so the password is hashed with the
 * same algorithm the login flow verifies against — never write an Account row
 * directly. The role is applied afterwards because `role` is `input: false` in
 * the auth config (clients must not be able to choose their own role).
 */
export async function createUser(input: UserCreateInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw conflict("A user with this email already exists");

  const result = await auth.api.signUpEmail({
    body: { name: input.name.trim(), email, password: input.password },
  });
  if (!result?.user?.id) {
    throw badRequest("Could not create the account");
  }

  const created = await prisma.user.update({
    where: { id: result.user.id },
    data: { role: input.role },
    select: publicSelect,
  });
  return toPublicUser(created);
}

export async function updateUser(
  userId: string,
  input: UserUpdateInput,
  actingUserId: string,
): Promise<PublicUser> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) throw notFound("User");

  // Guard rails: an admin must not be able to lock themselves out, and the last
  // remaining admin must not be demoted or disabled.
  const isSelf = userId === actingUserId;
  const losingAdmin =
    target.role === ROLES.ADMIN &&
    ((input.role !== undefined && input.role !== ROLES.ADMIN) ||
      input.isActive === false);

  if (isSelf && input.isActive === false) {
    throw badRequest("You cannot disable your own account");
  }
  if (isSelf && input.role !== undefined && input.role !== ROLES.ADMIN) {
    throw badRequest("You cannot remove your own Admin role");
  }
  if (losingAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { role: ROLES.ADMIN, isActive: true, NOT: { id: userId } },
    });
    if (otherAdmins === 0) {
      throw badRequest("At least one active Admin must remain");
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: publicSelect,
  });
  return toPublicUser(updated);
}

/**
 * Delete a user.
 *
 * Refused when the user owns execution history, because those rows are the
 * audit trail — disable the account instead.
 */
export async function deleteUser(userId: string, actingUserId: string) {
  if (userId === actingUserId) {
    throw badRequest("You cannot delete your own account");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      _count: { select: { executions: true, createdProjects: true } },
    },
  });
  if (!target) throw notFound("User");

  if (target._count.executions > 0 || target._count.createdProjects > 0) {
    throw conflict(
      "This user has test history and cannot be deleted. Disable the account instead.",
    );
  }

  if (target.role === ROLES.ADMIN) {
    const otherAdmins = await prisma.user.count({
      where: { role: ROLES.ADMIN, isActive: true, NOT: { id: userId } },
    });
    if (otherAdmins === 0) {
      throw badRequest("At least one active Admin must remain");
    }
  }

  await prisma.user.delete({ where: { id: userId } });
}

export async function getUserStats() {
  const grouped = await prisma.user.groupBy({
    by: ["role"],
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((g) => [g.role, g._count._all]));
}
