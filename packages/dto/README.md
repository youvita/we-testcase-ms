# @wetestcase/dto

Shared **DTOs** for TestCase MS: enums, Zod request/query schemas, and pure
response types. Framework-free — safe to import from the Next app, scripts, or
a future second client.

```ts
import {
  testCaseSchema,
  type TestCaseInput,
  type StatusBreakdown,
  ROLES,
} from "@wetestcase/dto";
```

Keep Prisma-shaped view models in `apps/web/types` (they depend on `@prisma/client`).
