DO $$ BEGIN
    CREATE TYPE "enum_licence_applications_type" AS ENUM ('New', 'Renewal');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "enum_licence_applications_status" AS ENUM ('Pending', 'Approved', 'Rejected', 'Under Review', 'Information Requested');
EXCEPTION
    WHEN duplicate_object THEN 
        ALTER TYPE "enum_licence_applications_status" ADD VALUE IF NOT EXISTS 'Information Requested';
END $$;

CREATE TABLE IF NOT EXISTS "licence_applications" (
    "id" SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "type" "enum_licence_applications_type" DEFAULT 'New',
    "status" "enum_licence_applications_status" DEFAULT 'Pending',
    "companyName" VARCHAR(255) NOT NULL,
    "tradingName" VARCHAR(255),
    "registrationNumber" VARCHAR(50) NOT NULL,
    "industry" VARCHAR(100) NOT NULL,
    "licenceType" VARCHAR(100) NOT NULL,
    "cosAllocation" VARCHAR(50) NOT NULL,
    "proposedStartDate" DATE,
    "reason" TEXT,
    "contactName" VARCHAR(255) NOT NULL,
    "contactEmail" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "fundingSource" VARCHAR(100),
    "estimatedAnnualCost" DECIMAL(15, 2),
    "documents" JSONB,
    "requestedDocuments" JSONB,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);
