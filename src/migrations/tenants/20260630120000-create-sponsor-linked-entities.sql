-- Section K: Multi-Company Handling — Sponsor Linked Entities
-- Creates the sponsor_linked_entities join table that records parent/subsidiary
-- relationships between two sponsor_profiles rows. A sponsor can be the parent
-- of many subsidiaries; a subsidiary belongs to at most one parent at a time
-- (enforced by the unique index on child_sponsor_profile_id).

CREATE TABLE IF NOT EXISTS sponsor_linked_entities (
    id                        SERIAL PRIMARY KEY,
    parent_sponsor_profile_id INTEGER NOT NULL
        REFERENCES sponsor_profiles(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    child_sponsor_profile_id  INTEGER NOT NULL
        REFERENCES sponsor_profiles(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    relationship_type         VARCHAR(50) NOT NULL DEFAULT 'subsidiary'
        CHECK (relationship_type IN ('subsidiary', 'linked')),
    notes                     TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A profile can only be the child in one relationship at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_sle_child
    ON sponsor_linked_entities (child_sponsor_profile_id);

-- Prevent a profile from linking to itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_sle_no_self_link'
      AND conrelid = 'sponsor_linked_entities'::regclass
  ) THEN
    ALTER TABLE sponsor_linked_entities
      ADD CONSTRAINT chk_sle_no_self_link
      CHECK (parent_sponsor_profile_id <> child_sponsor_profile_id);
  END IF;
END $$;

-- Speed up "give me all children of parent P" queries.
CREATE INDEX IF NOT EXISTS idx_sle_parent
    ON sponsor_linked_entities (parent_sponsor_profile_id);
