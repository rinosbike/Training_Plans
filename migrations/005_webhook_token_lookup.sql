-- Allow webhook handlers to find a sync token by provider_user_id without
-- requiring a pre-established RLS context (bootstrap problem: the webhook
-- has no JWT and therefore no training.current_user_id set yet).
--
-- SECURITY DEFINER makes this run as the function owner (postgres), which
-- bypasses RLS only for this single targeted lookup.  The caller still
-- operates under erp_app privileges for every subsequent write.
--
-- Run as postgres: runuser -u postgres -- psql -d neondb -f 005_webhook_token_lookup.sql

CREATE OR REPLACE FUNCTION training.find_sync_token_by_provider(
    p_provider      text,
    p_provider_uid  text
)
RETURNS SETOF training.sync_tokens
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = training
AS $$
    SELECT * FROM training.sync_tokens
    WHERE  provider = p_provider
      AND  provider_user_id = p_provider_uid
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION training.find_sync_token_by_provider(text, text) TO erp_app;
