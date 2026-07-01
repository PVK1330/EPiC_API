-- Week 8: Self-serve onboarding wizard
-- Tracks which onboarding steps each organisation has completed.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS onboarding_steps JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN organisations.onboarding_steps IS
  'JSONB map of step_key → completed_at: { profile_setup, plan_chosen, team_invited, trial_started }';

COMMENT ON COLUMN organisations.is_sandbox IS
  'If TRUE this is a demo/sandbox org — reset daily';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organisations_is_sandbox
  ON organisations (is_sandbox)
  WHERE is_sandbox = TRUE;
