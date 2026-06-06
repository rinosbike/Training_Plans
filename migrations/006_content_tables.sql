-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 006_content_tables.sql

CREATE TABLE IF NOT EXISTS training.content_stories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES training.users(id),
  title            TEXT NOT NULL,
  theme            TEXT,
  goal             TEXT,
  generated_script TEXT,
  status           TEXT DEFAULT 'draft',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training.content_scenes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id     UUID REFERENCES training.content_stories(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  description  TEXT,
  overlay_text TEXT,
  duration_sec INTEGER,
  clip_urls    JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Grant access to app roles (erp_app and devuser share this DB)
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_stories TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_scenes  TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_stories TO devuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON training.content_scenes  TO devuser;
