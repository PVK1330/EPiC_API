-- Org-wide display timezone + date format mirrored into the tenant DB
-- (kept in sync from the platform registry, like logo_url).
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS timezone    VARCHAR(64) NOT NULL DEFAULT 'Europe/London',
  ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY';
