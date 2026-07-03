-- Announcement history — the admin Announcements page lists, edits ("update &
-- resend"), deletes and exports previously sent announcements. Sending was
-- already implemented as a notification fan-out, but nothing was persisted, so
-- the history list was always empty. One row per announcement; the fan-out
-- notifications remain independent rows in notifications.

CREATE TABLE IF NOT EXISTS announcements (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(255) NOT NULL,
    message          TEXT NOT NULL,
    -- e.g. ["caseworker","sponsor"] — the audience checkboxes on the send form.
    target_roles     JSONB NOT NULL DEFAULT '[]'::jsonb,
    send_email       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Recipient count of the LATEST send (updated on "update & resend").
    recipients       INTEGER NOT NULL DEFAULT 0,
    created_by       INTEGER
        REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    -- Denormalised so history keeps showing the sender after user deletion.
    created_by_name  VARCHAR(255),
    organisation_id  INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History is listed newest-first per organisation.
CREATE INDEX IF NOT EXISTS idx_announcements_org_created
    ON announcements (organisation_id, created_at DESC);
