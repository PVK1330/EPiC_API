-- Org-wide display timezone + date format (admin-selectable, applies to all panels).
-- timezone stores an IANA identifier (e.g. 'Europe/London', 'America/New_York').
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS timezone    VARCHAR(64) NOT NULL DEFAULT 'Europe/London',
  ADD COLUMN IF NOT EXISTS date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY';
