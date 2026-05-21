-- Drop table if it exists (to handle failed migration)
DROP TABLE IF EXISTS case_timeline CASCADE;

-- Create case_timeline table
CREATE TABLE case_timeline (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  action_type VARCHAR(50) NOT NULL CHECK (action_type IN (
    'case_created',
    'case_updated',
    'status_changed',
    'document_uploaded',
    'document_reviewed',
    'payment_received',
    'payment_recorded',
    'note_added',
    'communication_sent',
    'communication_received',
    'assignment_changed',
    'deadline_updated',
    'reminder_sent',
    'case_closed',
    'case_reopened'
  )),
  description TEXT NOT NULL,
  performed_by INTEGER,
  action_date TIMESTAMP NOT NULL DEFAULT NOW(),
  previous_value TEXT,
  new_value TEXT,
  metadata JSONB,
  is_system_action BOOLEAN NOT NULL DEFAULT FALSE,
  visibility VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'admin_only')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_case_timeline_case_id ON case_timeline(case_id);
CREATE INDEX idx_case_timeline_action_type ON case_timeline(action_type);
CREATE INDEX idx_case_timeline_performed_by ON case_timeline(performed_by);
CREATE INDEX idx_case_timeline_action_date ON case_timeline(action_date DESC);
