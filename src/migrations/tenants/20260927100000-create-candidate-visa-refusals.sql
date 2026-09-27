-- Issue #6: Create candidate_visa_refusals table to support multiple visa refusal records per client/application

CREATE TABLE IF NOT EXISTS "candidate_visa_refusals" (
  "id" SERIAL PRIMARY KEY,
  "applicationId" INTEGER NOT NULL REFERENCES "candidate_applications"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "userId" INTEGER NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "organisationId" INTEGER REFERENCES "organisations"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  "refusalDate" DATE NOT NULL,
  "visaType" VARCHAR(100) NOT NULL,
  "country" VARCHAR(100) NOT NULL,
  "reason" TEXT NOT NULL,
  "referenceNumber" VARCHAR(100),
  "details" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "candidate_visa_refusals_application_id_idx" ON "candidate_visa_refusals" ("applicationId");
CREATE INDEX IF NOT EXISTS "candidate_visa_refusals_user_id_idx" ON "candidate_visa_refusals" ("userId");
CREATE INDEX IF NOT EXISTS "candidate_visa_refusals_organisation_id_idx" ON "candidate_visa_refusals" ("organisationId");

-- Safe migration / backfill:
-- For any existing candidate_applications where refusedVisa = 'Yes' and refusedVisaDate is not null,
-- insert into candidate_visa_refusals if not already migrated.
INSERT INTO "candidate_visa_refusals" (
  "applicationId",
  "userId",
  "organisationId",
  "refusalDate",
  "visaType",
  "country",
  "reason",
  "referenceNumber",
  "details",
  "createdAt",
  "updatedAt"
)
SELECT
  ca."id",
  ca."userId",
  ca."organisation_id",
  ca."refusedVisaDate",
  COALESCE(NULLIF(TRIM(ca."refusedVisaType"), ''), 'Other'),
  COALESCE(NULLIF(TRIM(ca."refusedVisaCountry"), ''), 'Unknown'),
  COALESCE(NULLIF(TRIM(ca."refusedVisaReason"), ''), NULLIF(TRIM(ca."refusedVisaDetails"), ''), 'Previous visa refusal'),
  NULLIF(TRIM(ca."refusedVisaReference"), ''),
  NULLIF(TRIM(ca."refusedVisaDetails"), ''),
  COALESCE(ca."createdAt", CURRENT_TIMESTAMP),
  COALESCE(ca."updatedAt", CURRENT_TIMESTAMP)
FROM "candidate_applications" ca
WHERE ca."refusedVisa" = 'Yes'
  AND ca."refusedVisaDate" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "candidate_visa_refusals" cvr
    WHERE cvr."applicationId" = ca."id"
  );
