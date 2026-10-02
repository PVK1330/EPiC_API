-- Add can_add_clients permission toggle to caseworker profiles
ALTER TABLE caseworker_profiles
ADD COLUMN IF NOT EXISTS can_add_clients BOOLEAN NOT NULL DEFAULT false;
