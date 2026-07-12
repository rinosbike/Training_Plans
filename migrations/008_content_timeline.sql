-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 008_content_timeline.sql
--
-- Adds a multi-track timeline data model alongside the existing single-track
-- content_scenes model. Stories opt in per-row via editor_mode; legacy stories
-- keep using content_scenes/clip_urls exactly as before.

ALTER TABLE training.content_stories
  ADD COLUMN IF NOT EXISTS editor_mode TEXT NOT NULL DEFAULT 'legacy'
    CHECK (editor_mode IN ('legacy', 'tracks'));

CREATE TABLE IF NOT EXISTS training.content_tracks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   UUID NOT NULL REFERENCES training.content_stories(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('video', 'image', 'audio', 'caption')),
  name       TEXT,
  z_index    INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  muted      BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_tracks_story ON training.content_tracks(story_id);

CREATE TABLE IF NOT EXISTS training.content_clips (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id             UUID NOT NULL REFERENCES training.content_tracks(id) ON DELETE CASCADE,
  source_url           TEXT,                     -- NULL for source_type='text'
  source_type          TEXT NOT NULL CHECK (source_type IN ('video','image','audio','text')),
  source_duration_sec  FLOAT,
  source_width         INTEGER,
  source_height        INTEGER,
  trim_start_sec       FLOAT NOT NULL DEFAULT 0,
  trim_end_sec         FLOAT,
  timeline_start_sec   FLOAT NOT NULL,
  timeline_end_sec     FLOAT NOT NULL,
  text_content          TEXT,
  style_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume                 FLOAT NOT NULL DEFAULT 1.0,
  position                INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_clips_track ON training.content_clips(track_id);

CREATE TABLE IF NOT EXISTS training.content_transcript_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id       UUID NOT NULL REFERENCES training.content_stories(id) ON DELETE CASCADE,
  source_clip_id UUID REFERENCES training.content_clips(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  provider       TEXT NOT NULL DEFAULT 'elevenlabs',
  language       TEXT,
  raw_response   JSONB,
  error_message  TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transcript_jobs_story ON training.content_transcript_jobs(story_id);

-- Grant access to app roles (erp_app and devuser share this DB)
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_tracks           TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_clips            TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_transcript_jobs  TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_tracks           TO devuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_clips            TO devuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_transcript_jobs  TO devuser;
