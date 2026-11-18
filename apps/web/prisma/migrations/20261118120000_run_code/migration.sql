-- What people call a run: "Run #K7Q3P", a short random code, so deleting
-- runs leaves no gaps in the list. `number` stays as the order they started.
ALTER TABLE "TestRun" ADD COLUMN "code" TEXT;

-- A code for every run anyone started; script checks keep none. The alphabet
-- leaves out 0/O and 1/I/L, which read alike. Correlated on the row, so each
-- run draws its own.
UPDATE "TestRun" r
SET "code" = (
  SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (floor(random() * 31) + 1)::int, 1), '')
  FROM generate_series(1, 5) AS g
  WHERE r."id" IS NOT NULL
)
WHERE r."purpose" = 'RUN';

CREATE UNIQUE INDEX "TestRun_projectId_code_key" ON "TestRun"("projectId", "code");

-- The results runs recorded name them in their comment: "Automated — Run #10
-- on SIT". Name them by their new code, so the comment and the link agree.
UPDATE "TestExecution" e
SET "comment" = replace(e."comment", 'Run #' || r."number" || ' ', 'Run #' || r."code" || ' ')
FROM "TestRunItem" i
JOIN "TestRun" r ON r."id" = i."runId"
WHERE i."executionId" = e."id"
  AND r."code" IS NOT NULL
  AND r."number" IS NOT NULL
  AND e."comment" LIKE 'Automated — Run #%';
