-- Create AuditLogs table for audit trail system

CREATE TABLE IF NOT EXISTS "AuditLogs" (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "Users"(id) ON DELETE SET NULL,
    user_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    ip_address VARCHAR(50),
    user_agent TEXT,
    status VARCHAR(50) DEFAULT 'SUCCESS',
    details TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_auditlogs_user_id ON "AuditLogs"(user_id);
CREATE INDEX idx_auditlogs_action ON "AuditLogs"(action);
CREATE INDEX idx_auditlogs_resource_type ON "AuditLogs"(resource_type);
CREATE INDEX idx_auditlogs_status ON "AuditLogs"(status);
CREATE INDEX idx_auditlogs_created_at ON "AuditLogs"("createdAt");
CREATE INDEX idx_auditlogs_user_created ON "AuditLogs"(user_id, "createdAt");

-- Add constraints for enum-like validation
ALTER TABLE "AuditLogs" ADD CONSTRAINT check_action CHECK (action IN (
    'LOGIN',
    'LOGOUT',
    'CASE_CREATED',
    'CASE_UPDATED',
    'PAYMENT_PROCESSED',
    'USER_CREATED',
    'USER_UPDATED',
    'DOCUMENT_UPLOADED',
    'DOCUMENT_DELETED',
    'CASE_DELETED',
    'PAYMENT_DELETED'
));

ALTER TABLE "AuditLogs" ADD CONSTRAINT check_resource_type CHECK (resource_type IN (
    'CASE',
    'SYSTEM',
    'INVOICE',
    'USER',
    'DOCUMENT'
));

ALTER TABLE "AuditLogs" ADD CONSTRAINT check_status CHECK (status IN (
    'SUCCESS',
    'FAILED',
    'PENDING'
));
