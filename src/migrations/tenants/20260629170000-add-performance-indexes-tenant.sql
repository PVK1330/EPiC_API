-- Week 9 Task 5: Tenant DB performance indexes for high-traffic queries
-- NB: several tenant tables (cases, documents, notifications, messages) use
-- quoted camelCase column identifiers, so those column names MUST be double
-- quoted here — Postgres folds unquoted identifiers to lower case.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_org_status           ON cases(organisation_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_caseworker_id        ON cases("assignedcaseworkerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_sponsor_id           ON cases("businessId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_target_date          ON cases("targetSubmissionDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_created_at           ON cases(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cases_deleted_at           ON cases(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_case_id          ON documents("caseId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_org_id           ON documents(organisation_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_status           ON documents(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id      ON notifications("userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_is_read      ON notifications(is_read) WHERE is_read = FALSE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_created_at   ON notifications("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_entity          ON audit_logs(entity_type, entity_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id         ON audit_logs(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_at      ON audit_logs(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sponsored_workers_sponsor  ON sponsored_workers(sponsor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sponsored_workers_status   ON sponsored_workers(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sponsored_workers_cos_num  ON sponsored_workers(worker_cos_number) WHERE worker_cos_number IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cos_requests_sponsor_id    ON cos_requests(sponsor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cos_requests_status        ON cos_requests(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to          ON tasks(assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_due_date             ON tasks(due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_status               ON tasks(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_id   ON messages("conversationId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at        ON messages("createdAt" DESC);
