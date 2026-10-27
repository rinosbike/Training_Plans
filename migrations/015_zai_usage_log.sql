-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 015_zai_usage_log.sql
-- One row per Z.ai Coding Plan call (script, media prompts, AI coach), so usage can be broken down by feature and user.
CREATE TABLE IF NOT EXISTS training.zai_usage_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID,
  feature       TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok',   -- ok | quota | rate_limited | error
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zai_usage_log_created ON training.zai_usage_log(created_at DESC);
GRANT SELECT, INSERT ON training.zai_usage_log TO erp_app;
GRANT SELECT, INSERT ON training.zai_usage_log TO devuser;
GRANT USAGE, SELECT ON SEQUENCE training.zai_usage_log_id_seq TO erp_app;
GRANT USAGE, SELECT ON SEQUENCE training.zai_usage_log_id_seq TO devuser;
