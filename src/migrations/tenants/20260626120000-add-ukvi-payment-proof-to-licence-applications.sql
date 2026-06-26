-- Optional proof-of-payment file path for the sponsor's UKVI licence fee
-- confirmation. Nullable: uploading proof is optional.
ALTER TABLE licence_applications
  ADD COLUMN IF NOT EXISTS ukvi_payment_proof_path TEXT;
