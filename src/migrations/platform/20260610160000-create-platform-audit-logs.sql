CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'Success' NOT NULL,
    category VARCHAR(50),
    "user" VARCHAR(100),
    org VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
