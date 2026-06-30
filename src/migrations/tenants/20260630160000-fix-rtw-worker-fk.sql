-- Fix right_to_work_records.worker_id FK: was referencing users(id) but the
-- business portal sends sponsored_workers.id as the workerId.
ALTER TABLE "right_to_work_records"
  DROP CONSTRAINT IF EXISTS "right_to_work_records_worker_id_fkey";

ALTER TABLE "right_to_work_records"
  ADD CONSTRAINT "right_to_work_records_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "sponsored_workers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
