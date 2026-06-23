-- Widen sponsor_profiles phone columns from VARCHAR(20) to VARCHAR(30).
--
-- Why: the profile-update endpoint (PUT /api/business/account/profile) accepts
-- several phone fields that were VARCHAR(20). A formatted / international number
-- (or an accidental paste of a longer string) overflowed the column and surfaced
-- as a 500 "value too long for type character varying(20)". E.164 maxes at 16
-- chars, but 30 gives safe headroom for separators and extensions. Server-side
-- validation now rejects non-phone values up front; this just removes the
-- low-headroom column as a failure mode. Widening is loss-free for existing data.

ALTER TABLE sponsor_profiles
  ALTER COLUMN "authorisingPhone" TYPE VARCHAR(30),
  ALTER COLUMN "keyContactPhone"  TYPE VARCHAR(30),
  ALTER COLUMN "hrPhone"          TYPE VARCHAR(30),
  ALTER COLUMN "billingPhone"     TYPE VARCHAR(30);
