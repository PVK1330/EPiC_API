-- Phase 5: Attendance Notes — Multi-Caseworker Tagging
-- Creates the case_note_participants table to track multiple caseworkers who attended an attendance event/meeting.

CREATE TABLE IF NOT EXISTS case_note_participants (
  id SERIAL PRIMARY KEY,
  case_note_id INTEGER NOT NULL REFERENCES case_notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  caseworker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_case_note_participant UNIQUE (case_note_id, caseworker_id)
);

CREATE INDEX IF NOT EXISTS idx_case_note_participants_note_id ON case_note_participants (case_note_id);
CREATE INDEX IF NOT EXISTS idx_case_note_participants_cw_id ON case_note_participants (caseworker_id);
