-- CoS Allocation module — dedicated cos_requests entity
-- Migration: 20260610150000-create-cos-requests.sql
--
-- 1) Create the cos_requests table (single source of truth for CoS requests).
-- 2) Backfill from the legacy approach (CoS requests stored as licence_applications
--    rows whose reason was prefixed "CoS Request:" / "CoS Allocation Request:").
-- 3) Delete those rows from licence_applications so real licence applications and
--    CoS requests are no longer conflated (it is a MOVE — no data loss).

-- 1) Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "cos_requests" (
  "id" SERIAL PRIMARY KEY,
  "sponsor_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "visa_type" VARCHAR(100),
  "requested_amount" INTEGER NOT NULL DEFAULT 0,
  "approved_amount" INTEGER,
  "reason" TEXT,
  "status" VARCHAR(30) NOT NULL DEFAULT 'Pending',
  "assigned_caseworker_ids" JSONB,
  "review_notes" TEXT,
  "reviewed_by" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "reviewed_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cos_requests_sponsor ON "cos_requests" ("sponsor_id");
CREATE INDEX IF NOT EXISTS idx_cos_requests_status  ON "cos_requests" ("status");

-- 2) Backfill (copy) -----------------------------------------------------------
INSERT INTO "cos_requests" (
  "sponsor_id", "organisation_id", "visa_type", "requested_amount", "approved_amount",
  "reason", "status", "assigned_caseworker_ids", "review_notes", "reviewed_by",
  "reviewed_at", "created_at", "updated_at"
)
SELECT
  la."userId",
  u."organisation_id",
  la."licenceType",
  CASE WHEN la."cosAllocation" ~ '^[0-9]+$' THEN la."cosAllocation"::int ELSE 0 END,
  CASE WHEN la."status" = 'Approved' AND la."cosAllocation" ~ '^[0-9]+$' THEN la."cosAllocation"::int ELSE NULL END,
  regexp_replace(la."reason", '^CoS (Allocation )?Request:\s*', ''),
  CASE WHEN la."status" = 'Information Requested' THEN 'Under Review' ELSE la."status" END,
  la."assignedcaseworkerId",
  la."adminNotes",
  NULL,
  CASE WHEN la."status" IN ('Approved', 'Rejected') THEN la."updatedAt" ELSE NULL END,
  la."createdAt",
  la."updatedAt"
FROM "licence_applications" la
LEFT JOIN "users" u ON u."id" = la."userId"
WHERE la."reason" ILIKE 'CoS Request:%'
   OR la."reason" ILIKE 'CoS Allocation Request:%';

-- 3) Remove the migrated rows from licence_applications ------------------------
DELETE FROM "licence_applications"
WHERE "reason" ILIKE 'CoS Request:%'
   OR "reason" ILIKE 'CoS Allocation Request:%';
