-- Fix absence_records.worker_id FK: was referencing users(id) but workerId
-- is the sponsored_workers.id, not a user account id.
ALTER TABLE "absence_records"
  DROP CONSTRAINT IF EXISTS "absence_records_worker_id_fkey";

ALTER TABLE "absence_records"
  ADD CONSTRAINT "absence_records_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "sponsored_workers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
