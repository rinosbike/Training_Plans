-- Add actual TSS column to workout_logs.
-- wl.tss is actual TSS as reported by the device or entered manually.
-- load_service.py uses it as the highest-priority source for ATL/CTL/TSB.
ALTER TABLE training.workout_logs ADD COLUMN IF NOT EXISTS tss INTEGER;
