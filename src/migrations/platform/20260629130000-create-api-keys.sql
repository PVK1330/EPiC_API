-- Week 9 Task 1: Public REST API Layer — per-tenant API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id              SERIAL PRIMARY KEY,
  organisation_id INTEGER      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  key_hash        VARCHAR(64)  NOT NULL UNIQUE,
  key_prefix      VARCHAR(12)  NOT NULL,
  scopes          TEXT[]       NOT NULL DEFAULT '{}',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_by      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_organisation_id ON api_keys(organisation_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash        ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active       ON api_keys(is_active) WHERE is_active = TRUE;
