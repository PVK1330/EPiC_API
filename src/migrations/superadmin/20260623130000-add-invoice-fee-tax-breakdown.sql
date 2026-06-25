-- Persist the professional charge breakdown on platform invoices so an
-- itemised VAT invoice (subscription + platform fee + VAT) can be reproduced
-- exactly rather than recomputed at PDF-render time. `amount` remains the gross
-- total actually charged; these columns explain it. All nullable for legacy rows.
ALTER TABLE IF EXISTS "invoices"
  ADD COLUMN IF NOT EXISTS "subtotal"            DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "platform_fee_amount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "tax_rate"            DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS "tax_amount"          DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "total"               DECIMAL(10,2);
