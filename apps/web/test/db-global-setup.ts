import { execFileSync } from "node:child_process";
import path from "node:path";

import { testDatabaseUrl } from "./test-database-url";

/** Bring the test database up to the current schema before any file runs. */
export default function setup() {
  const url = testDatabaseUrl();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "inherit",
  });
}
