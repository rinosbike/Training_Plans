CREATE TABLE IF NOT EXISTS training.workout_media (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL,
    workout_id       UUID         NOT NULL,
    r2_url           TEXT         NOT NULL,
    original_filename TEXT,
    media_type       TEXT         NOT NULL DEFAULT 'video',
    duration_sec     FLOAT,
    recorded_at      TIMESTAMPTZ,
    offset_sec       FLOAT,
    km_start         FLOAT,
    km_end           FLOAT,
    strava_time_start FLOAT,
    strava_time_end   FLOAT,
    metrics_json     JSONB,
    created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_media_workout_id
    ON training.workout_media (workout_id);
