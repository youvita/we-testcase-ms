import { PrismaClient } from "@prisma/client";

/**
 * Test cases in the Trash (`deletedAt` set) are left out of every testCase
 * query, so no list, count, run, report or export can show one by mistake.
 *
 * A query that names `deletedAt` in its `where` is left alone: the Trash asks
 * for `deletedAt: { not: null }`, and code that must see every case — a TC ID
 * stays taken while its case is in the Trash — spreads `includingTrash`.
 *
 * Only direct testCase queries are covered. A case reached through a relation
 * (`module._count.testCases`, `execution.testCase`, raw SQL) needs its own
 * `deletedAt: null` where it matters.
 */
const SCOPED_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

/** Spread into a testCase `where` to include cases in the Trash. */
export const includingTrash = { deletedAt: undefined } as const;

function createClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  }).$extends({
    name: "test-case-trash",
    query: {
      testCase: {
        $allOperations({ operation, args, query }) {
          if (SCOPED_OPERATIONS.has(operation)) {
            const scoped = args as { where?: Record<string, unknown> };
            if (!scoped.where || !("deletedAt" in scoped.where)) {
              scoped.where = { ...scoped.where, deletedAt: null };
            }
          }
          return query(args);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof createClient>;

/** What `prisma.$transaction(async (tx) => …)` hands its callback. */
export type Tx = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

// Reuse a single client across hot reloads in development, otherwise every
// recompile opens a new connection pool and exhausts Postgres. Its own key:
// a client cached by older code, without the Trash filter, must not be reused.
const globalForPrisma = globalThis as unknown as {
  prismaWithTrash: Db | undefined;
};

export const prisma = globalForPrisma.prismaWithTrash ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaWithTrash = prisma;
}
