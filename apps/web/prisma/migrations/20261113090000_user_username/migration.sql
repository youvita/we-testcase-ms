-- Sign in with a username as well as an email.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "displayUsername" TEXT;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Everyone who already has an account gets one from their email, so they can
-- use it at once: the part before the @, cut to what a username allows
-- (3–30 of a-z, 0-9, _ and .; a short one gets the domain's name added). The earliest account keeps the plain name; a
-- later one with the same name gets a number. They can change it in Profile.
DO $$
DECLARE
  person RECORD;
  base TEXT;
  candidate TEXT;
  n INTEGER;
BEGIN
  FOR person IN SELECT "id", "email" FROM "User" WHERE "username" IS NULL ORDER BY "createdAt", "id" LOOP
    base := left(regexp_replace(lower(split_part(person."email", '@', 1)), '[^a-z0-9_.]', '', 'g'), 26);
    -- Too short alone ("qa@example.com"): add the domain's name, "qa.example".
    IF length(base) < 3 THEN
      base := left(base || '.' || regexp_replace(lower(split_part(split_part(person."email", '@', 2), '.', 1)), '[^a-z0-9_]', '', 'g'), 26);
      base := ltrim(base, '.');
      IF length(base) < 3 THEN
        base := rpad(base, 3, '0');
      END IF;
    END IF;
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM "User" WHERE "username" = candidate) LOOP
      n := n + 1;
      candidate := base || n;
    END LOOP;
    UPDATE "User" SET "username" = candidate, "displayUsername" = candidate WHERE "id" = person."id";
  END LOOP;
END $$;
