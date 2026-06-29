-- Sponsor confirmation of the UKVI decision (sent to their registered email).
-- The case team may only grant/close the licence once the sponsor has confirmed.
-- ukvi_decision_letter_path is the optional UKVI grant/decision letter the sponsor
-- may attach as proof. Both nullable.
ALTER TABLE licence_applications
  ADD COLUMN IF NOT EXISTS ukvi_decision_confirmed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS ukvi_decision_letter_path  TEXT;
