-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 010_content_effects.sql
--
-- Adds per-clip playback speed. Filters, Ken Burns, fades, and caption
-- design (font/size/color/background/position/animation) all live in the
-- already-existing content_clips.style_json JSONB column — no migration
-- needed for those.

ALTER TABLE training.content_clips
  ADD COLUMN IF NOT EXISTS speed FLOAT NOT NULL DEFAULT 1.0;
