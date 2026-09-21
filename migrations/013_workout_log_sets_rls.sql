-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 013_workout_log_sets_rls.sql
--
-- 012 created workout_log_sets and described "isolation via the parent's user_id"
-- but never enabled RLS on it, so any session could read/write/delete another
-- user's logged sets. Enforce it in the database: a set row is only visible or
-- writable when its parent workout_log is (workout_logs itself has FORCE RLS
-- keyed on training.current_user_id, so the subquery is already user-scoped).

ALTER TABLE training.workout_log_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE training.workout_log_sets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_isolation ON training.workout_log_sets;
DROP POLICY IF EXISTS user_insert ON training.workout_log_sets;

CREATE POLICY user_isolation ON training.workout_log_sets
  USING (EXISTS (
    SELECT 1 FROM training.workout_logs wl
    WHERE wl.id = workout_log_sets.workout_log_id
      AND wl.user_id = current_setting('training.current_user_id', true)::uuid
  ));

CREATE POLICY user_insert ON training.workout_log_sets FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM training.workout_logs wl
    WHERE wl.id = workout_log_sets.workout_log_id
      AND wl.user_id = current_setting('training.current_user_id', true)::uuid
  ));
