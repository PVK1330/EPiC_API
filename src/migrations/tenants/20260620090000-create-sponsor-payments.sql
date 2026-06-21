-- Sponsor (business) online payments ledger.
--
-- Records sponsor-initiated Stripe payments that have NO home in case_payments
-- (which requires a caseId): the sponsor licence application fee and the
-- Immigration Skills Charge. Case-fee payments made by a sponsor continue to be
-- recorded in case_payments alongside the candidate's, keeping the case ledger
-- as the single source of truth for case balances.
--
-- All sponsor payments transact on the TENANT's own Stripe account (the keys the
-- org admin enters in Admin -> Payment Config), resolved via getStripeForTenant.
-- Idempotent + additive: safe to run repeatedly across existing tenant DBs.

CREATE TABLE IF NOT EXISTS sponsor_payments (
  id                       SERIAL PRIMARY KEY,
  sponsor_user_id          INTEGER       NOT NULL,
  organisation_id          INTEGER,
  payable_type             VARCHAR(40)   NOT NULL,            -- 'licence_fee' | 'isc'
  payable_ref              VARCHAR(100),                      -- e.g. licence_applications.id
  description              TEXT,
  amount                   NUMERIC(10,2) NOT NULL,
  currency                 VARCHAR(3)    NOT NULL DEFAULT 'GBP',
  status                   VARCHAR(20)   NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed'
  stripe_session_id        VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  paid_at                  TIMESTAMP,
  created_at               TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsor_payments_sponsor ON sponsor_payments (sponsor_user_id);

-- One ledger row per Stripe Checkout session (idempotent finalisation). NULLs are
-- allowed to coexist (Postgres treats NULLs as distinct in a unique index), but
-- in practice the session id is always set at creation time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sponsor_payments_session ON sponsor_payments (stripe_session_id);
