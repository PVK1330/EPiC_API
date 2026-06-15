-- BUG-043: Add missing ON DELETE behaviour to foreign keys that were created
-- without it. Two FKs on the "cases" table were added by later ALTER TABLE
-- migrations and inherited PostgreSQL's default of ON DELETE NO ACTION, which
-- blocks deleting a referenced user/department even though the case-side
-- reference is optional:
--
--   * cases."businessId"   -> users(id)        (20260424120000-add-business-id-to-cases.sql)
--   * cases."departmentId" -> departments(id)  (20260424130000-alter-department-to-department-id.sql)
--
-- Both are nullable, optional references on "cases" — the case must survive the
-- deletion of the referenced row — so the correct behaviour is ON DELETE SET
-- NULL. This matches the canonical sibling FKs in 006_core_business_tables.sql
-- (candidateId / sponsorId / departmentId all use ON DELETE SET NULL).
--
-- We do NOT edit the historical migration files in place (they would not re-run
-- on already-applied databases and would diverge schema). Instead this new,
-- later-timestamped migration ALTERs the constraints in an idempotent way: it
-- drops whatever FK constraint currently exists on each column (regardless of
-- its auto-generated name) and re-creates it with the correct ON DELETE rule.
-- Safe to run more than once.

-- ── cases."businessId" -> users(id) : ON DELETE SET NULL ──────────────────────
DO $$
DECLARE
  con_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cases' AND column_name = 'businessId'
  ) THEN
    -- Drop any existing FK constraint on cases."businessId".
    FOR con_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND rel.relname = 'cases'
        AND att.attname = 'businessId'
    LOOP
      EXECUTE format('ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS %I', con_name);
    END LOOP;

    ALTER TABLE "cases"
      ADD CONSTRAINT "cases_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "users" ("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- ── cases."departmentId" -> departments(id) : ON DELETE SET NULL ──────────────
DO $$
DECLARE
  con_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cases' AND column_name = 'departmentId'
  ) THEN
    -- Drop any existing FK constraint on cases."departmentId".
    FOR con_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND rel.relname = 'cases'
        AND att.attname = 'departmentId'
    LOOP
      EXECUTE format('ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS %I', con_name);
    END LOOP;

    ALTER TABLE "cases"
      ADD CONSTRAINT "cases_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "departments" ("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;
