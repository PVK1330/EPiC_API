-- Bank transfer payee details shown to candidates who choose to pay by bank
-- transfer (account name, sort code, account number, IBAN, etc.). Free text so
-- each org formats it as needed.
ALTER TABLE "payment_settings" ADD COLUMN IF NOT EXISTS "bank_details" TEXT;
