-- Natural (human) ordering for TC IDs.
--
-- The default collation sorts TestCase.tcId byte-wise, so "TC-10" lands between
-- "TC-1" and "TC-2" and clicking the TC ID column header looks broken to anyone
-- whose IDs are not zero-padded. An ICU collation with numeric ordering
-- (en-u-kn-true) compares digit runs as numbers, so TC-1 < TC-2 < TC-10.
--
-- Applying it to the column rather than to one query means every ORDER BY on
-- tcId — list, Excel/PDF exports, the failed-and-blocked view — agrees, with no
-- application code involved. The collation is deterministic, so equality, the
-- (projectId, tcId) unique index and LIKE all behave exactly as before.
--
-- Requires a Postgres built with ICU (postgres:16-alpine is).
CREATE COLLATION IF NOT EXISTS natural_sort (
  provider = icu,
  locale = 'en-u-kn-true',
  deterministic = true
);

-- Rebuilds the (projectId, tcId) unique index under the new collation.
ALTER TABLE "TestCase" ALTER COLUMN "tcId" TYPE TEXT COLLATE natural_sort;
