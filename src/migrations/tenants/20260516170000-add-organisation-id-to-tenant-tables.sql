ALTER TABLE IF EXISTS "tasks"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "documents"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "appointments"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "notifications"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "messages"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "conversations"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "escalations"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "worker_events"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "licence_applications"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "calendar_meetings"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "unverified_users"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "departments"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "roles"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "permissions"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "email_templates"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "sla_settings"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "sla_rules"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "payment_settings"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "application_field_settings"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "application_custom_fields"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "document_checklists"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "case_categories"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "visa_types"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "petition_types"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "caseworker_profiles"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "admin_user_preferences"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "candidate_account_settings"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "candidate_feedbacks"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "candidate_issue_reports"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE IF EXISTS "sponsor_user_preferences"
  ADD COLUMN IF NOT EXISTS "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  org_id INTEGER;
  target_table TEXT;
  tables TEXT[] := ARRAY[
    'tasks',
    'documents',
    'appointments',
    'notifications',
    'messages',
    'conversations',
    'escalations',
    'worker_events',
    'licence_applications',
    'calendar_meetings',
    'unverified_users',
    'departments',
    'roles',
    'permissions',
    'email_templates',
    'sla_settings',
    'sla_rules',
    'payment_settings',
    'application_field_settings',
    'application_custom_fields',
    'document_checklists',
    'case_categories',
    'visa_types',
    'petition_types',
    'caseworker_profiles',
    'admin_user_preferences',
    'candidate_account_settings',
    'candidate_feedbacks',
    'candidate_issue_reports',
    'sponsor_user_preferences'
  ];
BEGIN
  SELECT id INTO org_id FROM organisations ORDER BY id ASC LIMIT 1;
  IF org_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH target_table IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'organisation_id'
    ) THEN
      EXECUTE format(
        'UPDATE %I SET organisation_id = $1 WHERE organisation_id IS NULL',
        target_table
      ) USING org_id;

      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (organisation_id)',
        'idx_' || target_table || '_organisation_id',
        target_table
      );
    END IF;
  END LOOP;
END $$;
