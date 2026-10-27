-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 014_content_scene_media_prompts.sql
-- Per-scene prompts for AI image/video generation (step 2: written by the plan model from the story script, editable by the creator).
ALTER TABLE training.content_scenes ADD COLUMN IF NOT EXISTS image_prompt TEXT;
ALTER TABLE training.content_scenes ADD COLUMN IF NOT EXISTS video_prompt TEXT;
