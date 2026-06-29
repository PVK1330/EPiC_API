-- Week 6: E-signature support integration
-- Stores signature requests sent to candidates + their completions.

CREATE TYPE IF NOT EXISTS esig_status AS ENUM ('pending', 'signed', 'declined', 'expired');

CREATE TABLE IF NOT EXISTS esignature_requests (
  id               SERIAL PRIMARY KEY,
  case_id          INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  document_id      INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  requested_by     INTEGER NOT NULL,          -- admin/caseworker user id
  signer_id        INTEGER NOT NULL,          -- candidate user id
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  status           esig_status NOT NULL DEFAULT 'pending',
  token            VARCHAR(128) NOT NULL UNIQUE,  -- secure link token
  expires_at       TIMESTAMPTZ NOT NULL,
  signed_at        TIMESTAMPTZ,
  declined_at      TIMESTAMPTZ,
  decline_reason   TEXT,
  signature_data   TEXT,                      -- base64 data-URL of drawn/typed signature
  signature_type   VARCHAR(16) DEFAULT 'drawn', -- 'drawn' | 'typed'
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esig_case_id    ON esignature_requests (case_id);
CREATE INDEX IF NOT EXISTS idx_esig_signer_id  ON esignature_requests (signer_id);
CREATE INDEX IF NOT EXISTS idx_esig_token      ON esignature_requests (token);
CREATE INDEX IF NOT EXISTS idx_esig_status     ON esignature_requests (status);
