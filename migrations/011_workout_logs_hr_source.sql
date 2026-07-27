-- Run as postgres: runuser -u postgres -- psql -d neondb -f 011_workout_logs_hr_source.sql

-- Chest-strap HR (FIT device_info: antplus_device_type='heart_rate', source_type != 'local')
-- reads the heart's electrical signal directly and is materially more accurate than the
-- watch's built-in wrist optical sensor, especially during high-intensity/high-motion efforts.
ALTER TABLE training.workout_logs ADD COLUMN IF NOT EXISTS hr_source TEXT CHECK (hr_source IN ('chest_strap', 'optical'));
