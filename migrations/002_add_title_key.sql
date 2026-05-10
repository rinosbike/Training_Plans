-- Add title_key column so frontend can look up translated workout titles
ALTER TABLE training.workouts ADD COLUMN IF NOT EXISTS title_key VARCHAR(100);
