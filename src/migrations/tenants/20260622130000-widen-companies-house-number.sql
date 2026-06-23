-- Widen licence_organisation_info.companies_house_number VARCHAR(20) -> VARCHAR(50).
--
-- Why: syncPersonnelFromProfile (licenceApplicationV2.service.js) copies the
-- Business Profile's registrationNumber (sponsor_profiles.registrationNumber,
-- VARCHAR(50)) into this column. A 21–50 char registration number overflowed the
-- old VARCHAR(20) and surfaced as a 500 from the licence-V2 create/sync endpoints
-- (which have no data-error-to-400 mapping). Matching the source column width
-- removes the mismatch with no data loss. ALTER TABLE IF EXISTS so tenants that
-- have not yet provisioned the V2 wizard tables are skipped cleanly.

ALTER TABLE IF EXISTS licence_organisation_info
  ALTER COLUMN "companies_house_number" TYPE VARCHAR(50);
