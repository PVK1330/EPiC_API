-- Track when a caseworker/admin last (re)sent the CCL + payment request to the
-- client, and how many times. Lets the UI show a "Sent / Resend" state instead
-- of always offering "Send".

ALTER TABLE case_ccl_records
  ADD COLUMN IF NOT EXISTS payment_request_sent_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE case_ccl_records
  ADD COLUMN IF NOT EXISTS payment_request_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE case_ccl_records
  ADD COLUMN IF NOT EXISTS payment_request_amount NUMERIC(10, 2) DEFAULT NULL;
