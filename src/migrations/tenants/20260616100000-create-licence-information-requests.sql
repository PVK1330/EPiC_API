-- ────────────────────────────────────────────────────────────────────────────
-- Licence Information Request workflow
--
-- Adds:
--   1. info_requested_at / info_received_at timestamps to licence_applications
--   2. licence_information_requests  — one row per formal request thread
--   3. licence_information_request_comments — comment thread per request
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Timestamps on the parent application
ALTER TABLE licence_applications
  ADD COLUMN IF NOT EXISTS info_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_received_at   TIMESTAMPTZ;

-- 2. Information request threads
CREATE TABLE IF NOT EXISTS licence_information_requests (
  id                      SERIAL          PRIMARY KEY,
  licence_application_id  INTEGER         NOT NULL
                            REFERENCES licence_applications(id) ON DELETE CASCADE,
  requested_by_id         INTEGER         REFERENCES users(id) ON DELETE SET NULL,
  resolved_by_id          INTEGER         REFERENCES users(id) ON DELETE SET NULL,
  -- open | responded | closed
  status                  VARCHAR(20)     NOT NULL DEFAULT 'open',
  subject                 VARCHAR(255)    NOT NULL,
  details                 TEXT,
  requested_documents     JSONB           NOT NULL DEFAULT '[]',
  sponsor_response        TEXT,
  requested_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  responded_at            TIMESTAMPTZ,
  closed_at               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lic_info_req_application
  ON licence_information_requests(licence_application_id);
CREATE INDEX IF NOT EXISTS idx_lic_info_req_status
  ON licence_information_requests(status);

-- 3. Comment threads
CREATE TABLE IF NOT EXISTS licence_information_request_comments (
  id                              SERIAL      PRIMARY KEY,
  licence_information_request_id  INTEGER     NOT NULL
                                    REFERENCES licence_information_requests(id) ON DELETE CASCADE,
  author_id                       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  -- caseworker | admin | sponsor
  author_role                     VARCHAR(20) NOT NULL,
  comment                         TEXT        NOT NULL,
  -- TRUE = internal staff note, hidden from the sponsor
  is_internal                     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lic_info_req_comments_request
  ON licence_information_request_comments(licence_information_request_id);
