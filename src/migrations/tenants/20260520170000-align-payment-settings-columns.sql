-- Align payment_settings with PaymentSetting Sequelize model (admin Payment Config UI)
ALTER TABLE IF EXISTS "payment_settings"
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(10) DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS "pay_bank" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "pay_card" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "pay_cheque" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "invoice_prefix" VARCHAR(32) DEFAULT 'INV-',
  ADD COLUMN IF NOT EXISTS "stripe_public_key" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "stripe_secret_key" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "paypal_client_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "paypal_secret" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "razorpay_key_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "razorpay_key_secret" VARCHAR(255);

-- stripe_webhook_secret may already exist from 20260520160000
ALTER TABLE IF EXISTS "payment_settings"
  ADD COLUMN IF NOT EXISTS "stripe_webhook_secret" VARCHAR(255);
