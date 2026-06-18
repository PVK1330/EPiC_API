-- Licence Dispatch Documents
-- Tracks files (declaration forms, credentials, sponsor licence copies, etc.)
-- uploaded by admin/caseworker and dispatched to the sponsor via email + portal.

CREATE TABLE IF NOT EXISTS licence_dispatch_documents (
  id                      SERIAL       PRIMARY KEY,
  licence_application_id  INTEGER      NOT NULL REFERENCES licence_applications(id) ON DELETE CASCADE,
  sender_user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role             VARCHAR(20)  NOT NULL DEFAULT 'admin',
  document_type           VARCHAR(50)  NOT NULL DEFAULT 'supporting_document',
  document_name           VARCHAR(255) NOT NULL,
  file_path               VARCHAR(500) NOT NULL,
  file_name               VARCHAR(255) NOT NULL,
  file_size               INTEGER      NULL,
  mime_type               VARCHAR(100) NULL,
  message                 TEXT         NULL,
  email_sent              BOOLEAN      NOT NULL DEFAULT FALSE,
  downloaded_at           TIMESTAMPTZ  NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ldd_application ON licence_dispatch_documents (licence_application_id);
CREATE INDEX IF NOT EXISTS idx_ldd_sender      ON licence_dispatch_documents (sender_user_id);
