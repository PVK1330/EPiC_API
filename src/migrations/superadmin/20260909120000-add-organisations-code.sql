-- Case ID Generation feature: organisation initials used as the Case ID
-- prefix (e.g. "EPIC" in EPIC-SW26-001). Nullable — generateCaseId() derives
-- a fallback from the org name until a superadmin sets this explicitly.
-- No uniqueness constraint here: this is the global cross-tenant registry,
-- and two unrelated tenants may legitimately pick the same code (their
-- Case ID namespaces never intersect). Uniqueness is enforced per tenant DB
-- instead — see the tenants/ migration of the same name.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS code VARCHAR(20);

UPDATE organisations SET code = 'EPIC'
WHERE slug = 'epic-default' AND (code IS NULL OR code = '');
