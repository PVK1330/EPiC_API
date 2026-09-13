-- Case ID Generation feature: atomic per-(organisation, visa code, year)
-- sequence counter backing generateCaseId(). organisation_id uses 0 as a
-- NULL-sentinel because Postgres UNIQUE constraints treat NULL values as
-- distinct, which would let concurrent requests with organisation_id = NULL
-- silently fork the counter instead of sharing one sequence. Deliberately
-- has NO FK to organisations(id): id 0 will never exist there.
CREATE TABLE IF NOT EXISTS case_id_sequences (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL DEFAULT 0,
  visa_code VARCHAR(20) NOT NULL,
  year_code VARCHAR(2) NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, visa_code, year_code)
);
