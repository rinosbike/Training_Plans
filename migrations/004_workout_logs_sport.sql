-- Run as postgres: runuser -u postgres -- psql -d neondb -f 004_workout_logs_sport.sql

-- workout_logs was missing sport column; needed to display standalone (unmatched) synced activities
ALTER TABLE training.workout_logs ADD COLUMN IF NOT EXISTS sport TEXT;
