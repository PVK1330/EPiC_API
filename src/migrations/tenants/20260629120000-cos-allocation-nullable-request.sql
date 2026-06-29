-- Allow cos_allocation_records.cos_request_id to be NULL so that initial
-- licence-grant allocations (which have no corresponding cos_request row)
-- can be stored as proper CosAllocationRecord entries.
ALTER TABLE cos_allocation_records
  ALTER COLUMN cos_request_id DROP NOT NULL;
