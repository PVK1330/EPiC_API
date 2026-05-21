CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" SERIAL PRIMARY KEY,
    "organisation_id" INTEGER NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
    "plan_id" INTEGER NOT NULL REFERENCES "plans"("id") ON DELETE RESTRICT,
    "status" VARCHAR(20) DEFAULT 'trial' NOT NULL CHECK (status IN ('active', 'trial', 'expired', 'cancelled', 'past_due')),
    "current_period_start" TIMESTAMP WITH TIME ZONE,
    "current_period_end" TIMESTAMP WITH TIME ZONE,
    "trial_ends_at" TIMESTAMP WITH TIME ZONE,
    "cancelled_at" TIMESTAMP WITH TIME ZONE,
    "stripe_subscription_id" VARCHAR(255),
    "stripe_customer_id" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organisation ON subscriptions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end);

CREATE TABLE IF NOT EXISTS "invoices" (
    "id" SERIAL PRIMARY KEY,
    "organisation_id" INTEGER NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
    "subscription_id" INTEGER REFERENCES "subscriptions"("id") ON DELETE SET NULL,
    "invoice_number" VARCHAR(100) UNIQUE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" VARCHAR(10) DEFAULT 'GBP' NOT NULL,
    "status" VARCHAR(20) DEFAULT 'pending' NOT NULL CHECK (status IN ('paid', 'pending', 'overdue', 'failed', 'refunded')),
    "payment_method" VARCHAR(100),
    "payment_gateway" VARCHAR(100),
    "stripe_invoice_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "paid_at" TIMESTAMP WITH TIME ZONE,
    "due_at" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_organisation ON invoices(organisation_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at ON invoices(due_at);

CREATE TABLE IF NOT EXISTS "payment_transactions" (
    "id" SERIAL PRIMARY KEY,
    "organisation_id" INTEGER NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
    "invoice_id" INTEGER REFERENCES "invoices"("id") ON DELETE SET NULL,
    "reference" VARCHAR(100) UNIQUE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" VARCHAR(10) DEFAULT 'GBP' NOT NULL,
    "status" VARCHAR(20) DEFAULT 'processing' NOT NULL CHECK (status IN ('completed', 'failed', 'processing', 'refunded')),
    "payment_method" VARCHAR(100),
    "gateway" VARCHAR(100),
    "gateway_reference" VARCHAR(255),
    "failure_reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_organisation ON payment_transactions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice ON payment_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "subscription_expires_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(255);

CREATE OR REPLACE FUNCTION expire_subscriptions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_period_end < NOW() AND NEW.status = 'active' THEN
        NEW.status := 'expired';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_expire_subscriptions ON subscriptions;
CREATE TRIGGER trigger_expire_subscriptions
    BEFORE INSERT OR UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION expire_subscriptions();

CREATE OR REPLACE FUNCTION mark_subscription_past_due()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'overdue' AND OLD.status != 'overdue' THEN
        UPDATE subscriptions
        SET status = 'past_due', "updatedAt" = NOW()
        WHERE id = NEW.subscription_id AND status = 'active';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_mark_subscription_past_due ON invoices;
CREATE TRIGGER trigger_mark_subscription_past_due
    AFTER INSERT OR UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION mark_subscription_past_due();

CREATE OR REPLACE FUNCTION process_payment_transaction()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        BEGIN
            UPDATE invoices
            SET status = 'paid', paid_at = NOW(), "updatedAt" = NOW()
            WHERE id = NEW.invoice_id AND status != 'paid';

            UPDATE subscriptions s
            SET status = 'active', "updatedAt" = NOW()
            FROM invoices i
            WHERE i.id = NEW.invoice_id
              AND s.id = i.subscription_id
              AND s.status = 'past_due';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE EXCEPTION 'Payment transaction processing failed: %', SQLERRM;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_process_payment_transaction ON payment_transactions;
CREATE TRIGGER trigger_process_payment_transaction
    AFTER INSERT OR UPDATE ON payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION process_payment_transaction();
