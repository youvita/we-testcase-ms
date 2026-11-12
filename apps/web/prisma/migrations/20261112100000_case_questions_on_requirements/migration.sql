-- One home for each open question: a test case that verifies requirements
-- keeps its open questions on them (the first, by code), not on itself.
-- A question the case's requirements already ask, however punctuated, is
-- not added again. Cases in the Trash are left as they are.

WITH case_lines AS (
  SELECT tc.id AS "testCaseId",
         first_req.id AS "requirementId",
         trim(regexp_replace(t.line, '^\s*([-*•–]|[0-9]+[.)])\s+', '')) AS question,
         t.n
  FROM "TestCase" tc
  JOIN LATERAL (
    SELECT r.id
    FROM "TestCaseRequirement" tr
    JOIN "Requirement" r ON r.id = tr."requirementId"
    WHERE tr."testCaseId" = tc.id
    ORDER BY r.code
    LIMIT 1
  ) first_req ON true
  CROSS JOIN LATERAL regexp_split_to_table(tc."openQuestions", E'\n') WITH ORDINALITY AS t(line, n)
  WHERE tc."deletedAt" IS NULL AND trim(coalesce(tc."openQuestions", '')) <> ''
),
keyed AS (
  SELECT *, trim(regexp_replace(lower(question), '[^[:alnum:]]+', ' ', 'g')) AS key
  FROM case_lines
),
held AS (
  SELECT tr."testCaseId",
         trim(regexp_replace(lower(trim(regexp_replace(l.line, '^\s*([-*•–]|[0-9]+[.)])\s+', ''))), '[^[:alnum:]]+', ' ', 'g')) AS key
  FROM "TestCaseRequirement" tr
  JOIN "Requirement" r ON r.id = tr."requirementId"
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(r."openQuestions", ''), E'\n') AS l(line)
),
fresh AS (
  SELECT DISTINCT ON (k."requirementId", k.key) k."requirementId", k.question, k."testCaseId", k.n
  FROM keyed k
  WHERE k.key <> ''
    AND NOT EXISTS (SELECT 1 FROM held h WHERE h."testCaseId" = k."testCaseId" AND h.key = k.key)
  ORDER BY k."requirementId", k.key, k."testCaseId", k.n
),
added AS (
  SELECT "requirementId", string_agg('- ' || question, E'\n' ORDER BY "testCaseId", n) AS lines
  FROM fresh
  GROUP BY "requirementId"
)
UPDATE "Requirement" r
SET "openQuestions" = concat_ws(E'\n', nullif(trim(r."openQuestions"), ''), added.lines)
FROM added
WHERE r.id = added."requirementId";

UPDATE "TestCase" tc
SET "openQuestions" = NULL
WHERE tc."deletedAt" IS NULL
  AND tc."openQuestions" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "TestCaseRequirement" tr WHERE tr."testCaseId" = tc.id);
