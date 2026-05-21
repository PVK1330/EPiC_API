-- Stripe webhook secret on payment settings
ALTER TABLE IF EXISTS "payment_settings"
  ADD COLUMN IF NOT EXISTS "stripe_webhook_secret" VARCHAR(255);

-- Organisation branding
ALTER TABLE IF EXISTS "organisations"
  ADD COLUMN IF NOT EXISTS "logo_url" VARCHAR(500);

-- Candidate Stripe subscription tracking (per user)
ALTER TABLE IF EXISTS "candidate_account_settings"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "subscription_status" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "subscription_current_period_end" TIMESTAMP WITH TIME ZONE;
