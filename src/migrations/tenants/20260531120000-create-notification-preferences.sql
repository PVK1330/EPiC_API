-- Notification delivery preferences, one row per user.
-- Backs GET/PATCH /api/notifications/preferences and the per-user delivery
-- gating in notification.service.js (notifyUser).

CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "email_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "in_app_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "case_updates" BOOLEAN NOT NULL DEFAULT TRUE,
    "payment_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "appointment_notifications" BOOLEAN NOT NULL DEFAULT TRUE,
    "marketing_notifications" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_notification_preferences_user" ON "notification_preferences" ("user_id");
