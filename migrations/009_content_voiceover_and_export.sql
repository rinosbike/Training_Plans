-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 009_content_voiceover_and_export.sql

ALTER TABLE training.content_stories
  ADD COLUMN IF NOT EXISTS export_preset TEXT NOT NULL DEFAULT '9:16';

CREATE TABLE IF NOT EXISTS training.content_voiceover_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id        UUID NOT NULL REFERENCES training.content_stories(id) ON DELETE CASCADE,
  target_track_id UUID NOT NULL REFERENCES training.content_tracks(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  text_content    TEXT NOT NULL,
  voice_ref_url   TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voiceover_jobs_story ON training.content_voiceover_jobs(story_id);

-- Grant access to app roles (erp_app and devuser share this DB)
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_voiceover_jobs TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_voiceover_jobs TO devuser;
