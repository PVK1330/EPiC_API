-- Tasks: assignments with optional case link; FKs to users (assignee, creator) and cases.
-- Run after `users` and `cases` exist.

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_tasks_priority') THEN
        CREATE TYPE "enum_tasks_priority" AS ENUM ('low', 'medium', 'high');
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_tasks_status') THEN
        CREATE TYPE "enum_tasks_status" AS ENUM ('pending', 'in-progress', 'completed');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(500) NOT NULL,
  "assigned_to" INTEGER NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "case_id" INTEGER REFERENCES "cases"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  "priority" "enum_tasks_priority" NOT NULL DEFAULT 'medium',
  "status" "enum_tasks_status" NOT NULL DEFAULT 'pending',
  "due_date" DATE NOT NULL,
  "created_by" INTEGER NOT NULL REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_tasks_assigned_to" ON "tasks" ("assigned_to");
CREATE INDEX IF NOT EXISTS "idx_tasks_case_id" ON "tasks" ("case_id");
CREATE INDEX IF NOT EXISTS "idx_tasks_created_by" ON "tasks" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_tasks_due_date" ON "tasks" ("due_date");
