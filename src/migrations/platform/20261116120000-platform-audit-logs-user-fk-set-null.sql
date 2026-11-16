-- platform_audit_logs.user_id was created with a plain REFERENCES users(id) (no ON DELETE
-- rule), so deleting any platform team member who has audit entries failed with a
-- foreign_key_violation (23503) -> "A linked record no longer exists...".
-- Audit rows must outlive the user: keep them and null the link (the legacy "user"
-- text column still records who performed the action).
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT IF EXISTS "platform_audit_logs_user_id_fkey";
ALTER TABLE "platform_audit_logs"
  ADD CONSTRAINT "platform_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
