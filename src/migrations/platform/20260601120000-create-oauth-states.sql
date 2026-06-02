-- OAuth CSRF state store.
-- Holds a single-use, short-lived random "state" nonce for the Google/Microsoft
-- OAuth authorization-code flow. The user's session token is kept here
-- SERVER-SIDE only (it must never appear in the OAuth state query parameter).
CREATE TABLE IF NOT EXISTS "oauth_states" (
  "id" SERIAL PRIMARY KEY,
  "state" VARCHAR(128) NOT NULL UNIQUE,
  "provider" VARCHAR(20) NOT NULL,
  "user_id" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "auth_token" TEXT,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_oauth_states_expires_at" ON "oauth_states" ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_oauth_states_user_provider" ON "oauth_states" ("user_id", "provider");
