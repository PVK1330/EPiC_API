-- Add missing active_gateway column to payment_settings table
ALTER TABLE payment_settings ADD COLUMN IF NOT EXISTS active_gateway VARCHAR(255) DEFAULT 'stripe';
