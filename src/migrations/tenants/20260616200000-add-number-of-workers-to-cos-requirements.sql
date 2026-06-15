-- Add number_of_workers to licence_cos_requirements.
-- Replaces the per-candidate model with a UKVI-aligned per-role model:
-- each row = one role type + headcount, no candidate PII at licence application stage.

ALTER TABLE licence_cos_requirements
  ADD COLUMN IF NOT EXISTS number_of_workers SMALLINT NOT NULL DEFAULT 1;
