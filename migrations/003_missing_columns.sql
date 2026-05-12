-- Run as postgres: runuser -u postgres -- psql -d neondb -f 003_missing_columns.sql

-- ai_sessions was missing title column (used by list_sessions and chat auto-title)
ALTER TABLE training.ai_sessions ADD COLUMN IF NOT EXISTS title TEXT;

-- workout_logs was missing updated_at (AI update action used SET updated_at = NOW())
ALTER TABLE training.workout_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
