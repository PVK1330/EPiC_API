-- Web Push (desktop notifications) — per-user browser push subscriptions.
-- One row per (user, browser) pair: a user who enables desktop notifications in
-- Chrome at work and Edge at home has two rows. The endpoint is the unique key —
-- push services (FCM/Mozilla) mint one URL per browser subscription. Rows are
-- deleted when the push service reports the subscription gone (404/410) or the
-- user turns the toggle off.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL
        REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per browser subscription; re-subscribing the same browser upserts.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_push_subscriptions_endpoint
    ON push_subscriptions (endpoint);

-- Fan-out lookup: "all subscriptions for user U" on every notification.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (user_id);
