-- Case notes table (required by admin case detail and case-notes API)
CREATE TABLE IF NOT EXISTS case_notes (
  id SERIAL PRIMARY KEY,
  "caseId" INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "noteType" VARCHAR(50) NOT NULL DEFAULT 'internal',
  title VARCHAR(255),
  content TEXT NOT NULL,
  "authorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  visibility VARCHAR(50) NOT NULL DEFAULT 'team',
  "isPinned" BOOLEAN NOT NULL DEFAULT FALSE,
  "isArchived" BOOLEAN NOT NULL DEFAULT FALSE,
  "reminderDate" DATE,
  "reminderSent" BOOLEAN NOT NULL DEFAULT FALSE,
  tags JSONB,
  attachments JSONB,
  "parentNoteId" INTEGER REFERENCES case_notes(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_notes_case_id ON case_notes ("caseId");
CREATE INDEX IF NOT EXISTS idx_case_notes_author_id ON case_notes ("authorId");
CREATE INDEX IF NOT EXISTS idx_case_notes_parent_note_id ON case_notes ("parentNoteId");

-- Case communications (idempotent — some tenants may already have this from sync)
CREATE TABLE IF NOT EXISTS case_communications (
  id SERIAL PRIMARY KEY,
  "caseId" INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "messageType" VARCHAR(50) NOT NULL DEFAULT 'note',
  subject VARCHAR(255),
  message TEXT NOT NULL,
  "senderId" INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "recipientId" INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "recipientType" VARCHAR(50) NOT NULL DEFAULT 'candidate',
  "recipientEmail" VARCHAR(255),
  "sentDate" TIMESTAMP WITH TIME ZONE,
  "readDate" TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  direction VARCHAR(50) NOT NULL DEFAULT 'outbound',
  attachments JSONB,
  priority VARCHAR(50) NOT NULL DEFAULT 'normal',
  "isInternal" BOOLEAN NOT NULL DEFAULT FALSE,
  "requiresResponse" BOOLEAN NOT NULL DEFAULT FALSE,
  "responseDueDate" DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_communications_case_id ON case_communications ("caseId");

-- Case payments (idempotent — some tenants may already have this from sync)
CREATE TABLE IF NOT EXISTS case_payments (
  id SERIAL PRIMARY KEY,
  "caseId" INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "paymentType" VARCHAR(50) NOT NULL DEFAULT 'fee',
  amount DECIMAL(10, 2) NOT NULL,
  "paymentMethod" VARCHAR(50) NOT NULL,
  "paymentDate" DATE NOT NULL,
  "paymentStatus" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "transactionId" VARCHAR(100),
  "invoiceNumber" VARCHAR(50),
  description TEXT,
  "receivedBy" INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  notes TEXT,
  "dueDate" DATE,
  "isRecurring" BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_payments_case_id ON case_payments ("caseId");
