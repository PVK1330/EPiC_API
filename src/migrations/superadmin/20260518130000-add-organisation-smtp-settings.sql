-- Per-organisation SMTP (optional). When not set or disabled, platform .env SMTP is used.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS smtp_settings JSONB DEFAULT NULL;
