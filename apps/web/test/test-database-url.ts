import path from "node:path";

import { loadEnvConfig } from "@next/env";

/**
 * The database the `db` tests run against.
 *
 * Read from the environment or apps/web/.env, the same files Next.js uses.
 *
 * Every test empties the tables, so this refuses anything that does not look
 * like a throwaway database: the name must end in `_test`, or CI must say the
 * whole server is disposable. Pointing it at the dev or production database by
 * mistake fails here, before anything is deleted.
 */
export function testDatabaseUrl(): string {
  loadEnvConfig(path.resolve(__dirname, ".."), false, { info: () => {}, error: console.error });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a database whose name ends in _test, " +
        'e.g. TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5434/wetestcase_test".',
    );
  }

  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test") && process.env.CI !== "true") {
    throw new Error(
      `Refusing to run database tests against "${name}": they delete every row. ` +
        "Use a database whose name ends in _test.",
    );
  }
  return url;
}
