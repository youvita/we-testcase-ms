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
 * Deliberately does *not* call `auth.api.signUpEmail`. Sign-up ends by minting
 * a session for the account it just created, and the `nextCookies()` plugin
 * copies that Set-Cookie onto whatever response is in flight — so adding a user
 * would sign the Admin out of their own browser and in as the person they had
 * just added. Creating a user is administration, not authentication.
 *
 * Instead this repeats what Better Auth's sign-up handler does — hash with the
 * configured hasher, create the user, link a `credential` account — and stops
 * before the session. The password still verifies at login because the hash
 * comes from the same `ctx.password` used there; the Admin's session is
 * untouched. Never write the Account row with a hand-rolled hash.
 *
 * Ids come from Better Auth (`internalAdapter`) because the auth tables declare
 * `id String @id` with no database default — see the note in lib/auth.ts.
 */
export async function createUser(input: UserCreateInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw conflict("A user with this email already exists");

  const ctx = await auth.$context;

  // Hashed before the insert so a hasher failure cannot leave a user behind,
  // which is the order sign-up uses for the same reason.
  const password = await ctx.password.hash(input.password);

  const created = await ctx.internalAdapter.createUser({
    name: input.name.trim(),
    email,
    emailVerified: false,
    // Set here rather than accepted from a sign-up body: `role` is
    // `input: false` in the auth config so clients cannot choose their own.
    role: input.role,
    isActive: true,
  });
  if (!created?.id) throw badRequest("Could not create the account");

  try {
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      accountId: created.id,
      providerId: "credential",
      password,
    });
  } catch (error) {
    // Without the credential row the account can never sign in, yet its email
    // is taken — undo rather than leave an Admin with an unusable user.
    await prisma.user.delete({ where: { id: created.id } }).catch(() => {});
    throw error;
  }

  return getUser(created.id);
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
