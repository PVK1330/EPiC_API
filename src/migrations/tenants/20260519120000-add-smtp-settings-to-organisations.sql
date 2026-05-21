-- Mirror platform column so shared Organisation model works in tenant DBs.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS smtp_settings JSONB DEFAULT NULL;
