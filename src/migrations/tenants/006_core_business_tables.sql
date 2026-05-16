-- Consolidated Core Business Tables for Tenant Database
-- This file ensures all essential tables exist in a fresh tenant DB.

-- 1. Reference Data Tables
CREATE TABLE IF NOT EXISTS "visa_types" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS "petition_types" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 2. Business Domain Tables
CREATE TABLE IF NOT EXISTS "cases" (
    "id" SERIAL PRIMARY KEY,
    "caseId" VARCHAR(255),
    "candidateId" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "sponsorId" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "businessId" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "visaTypeId" INTEGER REFERENCES "visa_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "petitionTypeId" INTEGER REFERENCES "petition_types" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "priority" VARCHAR(20) DEFAULT 'medium',
    "status" VARCHAR(50) DEFAULT 'Lead',
    "submitted" DATE,
    "targetSubmissionDate" DATE NOT NULL,
    "lcaNumber" VARCHAR(255),
    "receiptNumber" VARCHAR(255),
    "nationality" VARCHAR(255),
    "jobTitle" VARCHAR(255),
    "departmentId" INTEGER REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "assignedcaseworkerId" JSONB,
    "salaryOffered" DECIMAL(10, 2) DEFAULT 0,
    "totalAmount" DECIMAL(10, 2) DEFAULT 0 NOT NULL,
    "paidAmount" DECIMAL(10, 2) DEFAULT 0,
    "amountStatus" VARCHAR(50) DEFAULT 'Not Submitted',
    "amountNotes" TEXT,
    "notes" TEXT,
    "biometricsDate" DATE,
    "submissionDate" DATE,
    "decisionDate" DATE,
    "applicationType" VARCHAR(100),
    "caseStage" VARCHAR(64) DEFAULT 'client_enquiry',
    "deleted_at" TIMESTAMP WITH TIME ZONE,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 3. Document Management
CREATE TABLE IF NOT EXISTS "documents" (
    "id" SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "caseId" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "documentType" VARCHAR(100) NOT NULL,
    "documentName" VARCHAR(255) NOT NULL,
    "userFileName" VARCHAR(255),
    "documentPath" VARCHAR(500),
    "documentCategory" VARCHAR(50) DEFAULT 'candidate' NOT NULL,
    "mimeType" VARCHAR(100),
    "fileSize" INTEGER,
    "status" VARCHAR(50) DEFAULT 'uploaded' NOT NULL,
    "expiryDate" DATE,
    "notes" TEXT,
    "uploadedBy" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "uploadedAt" TIMESTAMP WITH TIME ZONE,
    "reviewedBy" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "reviewedAt" TIMESTAMP WITH TIME ZONE,
    "reviewNotes" TEXT,
    "isRequired" BOOLEAN DEFAULT FALSE NOT NULL,
    "tags" JSONB,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 4. Messaging & Notifications
CREATE TABLE IF NOT EXISTS "conversations" (
    "id" SERIAL PRIMARY KEY,
    "participantOneId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "participantTwoId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "caseId" INTEGER REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "lastMessage" TEXT,
    "lastMessageAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS "messages" (
    "id" SERIAL PRIMARY KEY,
    "senderId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "receiverId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "conversationId" INTEGER REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "message" TEXT NOT NULL,
    "messageType" VARCHAR(20) DEFAULT 'text',
    "isRead" BOOLEAN DEFAULT FALSE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS "notifications" (
    "id" SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "roleId" INTEGER REFERENCES "roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "type" VARCHAR(50) DEFAULT 'info' NOT NULL,
    "priority" VARCHAR(20) DEFAULT 'medium' NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "actionType" VARCHAR(50),
    "entityId" INTEGER,
    "entityType" VARCHAR(50),
    "metadata" JSONB DEFAULT '{}',
    "is_read" BOOLEAN DEFAULT FALSE,
    "read_at" TIMESTAMP WITH TIME ZONE,
    "send_email" BOOLEAN DEFAULT FALSE,
    "email_sent" BOOLEAN DEFAULT FALSE,
    "scheduled_for" TIMESTAMP WITH TIME ZONE,
    "sent_at" TIMESTAMP WITH TIME ZONE,
    "expires_at" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 5. Audit Logging
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "action" VARCHAR(255) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" INTEGER,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 6. Profile & Applications
CREATE TABLE IF NOT EXISTS "sponsor_profiles" (
    "id" SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "companyName" VARCHAR(255),
    "licenseNumber" VARCHAR(100),
    "contactPerson" VARCHAR(255),
    "contactEmail" VARCHAR(255),
    "contactPhone" VARCHAR(20),
    "address" TEXT,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS "candidate_applications" (
    "id" SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "passportNumber" VARCHAR(50),
    "currentVisa" VARCHAR(100),
    "visaExpiry" DATE,
    "organisation_id" INTEGER REFERENCES "organisations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);
