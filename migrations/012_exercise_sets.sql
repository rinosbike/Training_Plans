-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 012_exercise_sets.sql
--
-- Structured set-by-set logging for strength/core workouts (push-ups, sit-ups,
-- pull-ups, etc.) so actual volume can differ from the plan and still produce
-- an objective training load, instead of collapsing the whole session into
-- one duration + one RPE number.

-- ─── EXERCISE LIBRARY (public catalog, no RLS — same pattern as food_database) ─
CREATE TABLE IF NOT EXISTS training.exercise_library (
    id                    SERIAL PRIMARY KEY,
    key                   TEXT UNIQUE NOT NULL,           -- stable slug, e.g. 'push_up'
    category              TEXT NOT NULL CHECK (category IN ('push','pull','core','legs','hold','full_body')),
    unit                  TEXT NOT NULL CHECK (unit IN ('reps','seconds')),
    allow_weight          BOOLEAN NOT NULL DEFAULT false, -- can log an added weight_kg
    difficulty_coefficient NUMERIC(5,3) NOT NULL,          -- relative load per rep/second, push_up = 1.0 baseline
    sort_order            INTEGER NOT NULL DEFAULT 0
);

INSERT INTO training.exercise_library (key, category, unit, allow_weight, difficulty_coefficient, sort_order) VALUES
    ('push_up',           'push',  'reps',    false, 1.000, 10),
    ('incline_push_up',   'push',  'reps',    false, 0.700, 11),
    ('decline_push_up',   'push',  'reps',    false, 1.200, 12),
    ('dip',               'push',  'reps',    true,  1.800, 13),
    ('pull_up',           'pull',  'reps',    true,  3.000, 20),
    ('chin_up',           'pull',  'reps',    true,  2.800, 21),
    ('inverted_row',      'pull',  'reps',    false, 1.800, 22),
    ('sit_up',            'core',  'reps',    false, 0.400, 30),
    ('crunch',            'core',  'reps',    false, 0.300, 31),
    ('bicycle_crunch',    'core',  'reps',    false, 0.350, 32),
    ('hanging_leg_raise', 'core',  'reps',    false, 1.500, 33),
    ('knee_raise',        'core',  'reps',    false, 1.000, 34),
    ('plank',             'core',  'seconds', false, 0.050, 35),
    ('superman',          'core',  'reps',    false, 0.400, 36),
    ('squat_bodyweight',  'legs',  'reps',    true,  0.800, 40),
    ('jump_squat',        'legs',  'reps',    false, 1.300, 41),
    ('lunge',             'legs',  'reps',    true,  0.900, 42),
    ('glute_bridge',      'legs',  'reps',    false, 0.500, 43),
    ('wall_sit',          'legs',  'seconds', false, 0.060, 44),
    ('burpee',            'full_body', 'reps', false, 2.000, 50),
    ('mountain_climber',  'full_body', 'reps', false, 0.300, 51)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE training.exercise_library DISABLE ROW LEVEL SECURITY;

-- ─── LOGGED SETS (child of workout_logs, isolation via the parent's user_id) ──
CREATE TABLE IF NOT EXISTS training.workout_log_sets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_log_id UUID NOT NULL REFERENCES training.workout_logs(id) ON DELETE CASCADE,
    exercise_id    INTEGER NOT NULL REFERENCES training.exercise_library(id),
    set_number     INTEGER NOT NULL,
    reps           INTEGER,
    duration_sec   INTEGER,
    weight_kg      NUMERIC(5,1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workout_log_sets_log ON training.workout_log_sets(workout_log_id);

-- Grant access to app roles (erp_app and devuser share this DB)
GRANT SELECT                                    ON training.exercise_library    TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE            ON training.workout_log_sets    TO erp_app;
GRANT SELECT                                    ON training.exercise_library    TO devuser;
GRANT SELECT, INSERT, UPDATE, DELETE            ON training.workout_log_sets    TO devuser;
GRANT USAGE, SELECT ON training.exercise_library_id_seq TO erp_app;
GRANT USAGE, SELECT ON training.exercise_library_id_seq TO devuser;
