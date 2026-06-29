-- Week 9 Task 5: Platform DB performance indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organisations_plan_id       ON organisations(plan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organisations_slug           ON organisations(slug);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_org_id        ON subscriptions(organisation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_status        ON subscriptions(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_plan_id       ON subscriptions(plan_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_org_id             ON invoices(organisation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_status             ON invoices(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_transactions_org_id ON payment_transactions(organisation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_role              ON users(organisation_id, role_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email                 ON users(email);
-- NB: platform_audit_logs has no organisation_id column (org reference is the
-- legacy free-text "org" VARCHAR), so there is no useful FK index to add here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_platform_audit_log_created  ON platform_audit_logs(created_at DESC);
