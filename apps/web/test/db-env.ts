import { testDatabaseUrl } from "./test-database-url";

// Before any test file imports @/lib/prisma: the client reads DATABASE_URL
// when it is constructed, and an already-set variable wins over apps/web/.env.
const url = testDatabaseUrl();
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
