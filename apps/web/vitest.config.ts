import path from "node:path";

import { defineConfig } from "vitest/config";

const alias = {
  "@wetestcase/dto": path.resolve(__dirname, "../../packages/dto/src/index.ts"),
  "@": path.resolve(__dirname),
};

/**
 * Two kinds of test:
 *
 * - `unit` — `*.test.ts`, no database. Fast; runs anywhere.
 * - `db` — `*.db.test.ts`, against a real Postgres named by TEST_DATABASE_URL.
 *   The services lean on Postgres itself (transactions, the natural_sort
 *   collation, unique indexes), so these are not mocked. Files run one at a
 *   time because each test empties the tables first.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["**/*.db.test.ts", "**/node_modules/**", ".next/**"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["**/*.db.test.ts"],
          exclude: ["**/node_modules/**", ".next/**"],
          globalSetup: ["./test/db-global-setup.ts"],
          setupFiles: ["./test/db-env.ts"],
          // One process for every file: fileParallelism inside a project is
          // not honoured, and two files truncating at once deadlock.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
