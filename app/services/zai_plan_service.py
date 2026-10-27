"""
Z.ai (GLM) via the Coding Plan: script generation, media prompts and the AI coach.

Uses the Anthropic-compatible /v1/messages endpoint, which is billed against the plan's rolling 5-hour (and weekly) token
window. The native /paas/v4 endpoint draws from separate pay-as-you-go credits instead.
No `tools` key is ever sent, so calls stay on the plain chat quota and never touch the web-search quota.
Every call is written to training.zai_usage_log; quota_status() reads the plan's remaining quota (costs no tokens).
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

import requests

from app.db import execute_query, execute_write
from app.exceptions import APIError

log = logging.getLogger(__name__)

ZAI_MESSAGES_URL = 'https://api.z.ai/api/anthropic/v1/messages'
QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'
ANTHROPIC_VERSION = '2023-06-01'
MODEL = 'glm-5.2'

# 1302/1303/1305 are short request-rate limits (retried); 1304/1308/1310 mean the plan window is spent (daily/5-hour/weekly).
RATE_LIMIT_CODES = {'1302', '1303', '1305'}
QUOTA_CODES = {'1304', '1308', '1310'}
_RETRY_DELAYS = (2, 5, 10)
_QUOTA_CACHE_SECONDS = 60

_quota_lock = threading.Lock()
_quota_cache = {'at': 0.0, 'value': None}


def _log_call(feature, user_id, usage, status='ok', error=None):
    """Record one call. Logging must never break the call itself."""
    try:
        usage = usage or {}
        execute_write(
            '''INSERT INTO training.zai_usage_log (user_id, feature, input_tokens, output_tokens, status, error)
               VALUES (%s, %s, %s, %s, %s, %s)''',
            (user_id, feature, int(usage.get('input_tokens') or 0), int(usage.get('output_tokens') or 0),
             status, (error or None) and error[:300]))
    except Exception as e:
        log.warning('zai usage log failed: %s', e)


def _error_from(resp):
    """Return (APIError, status) for a non-200 answer; status is the log status."""
    message, code = resp.text[:300], ''
    try:
        err = (resp.json() or {}).get('error') or {}
        code = str(err.get('code') or '')
        message = err.get('message') or message
    except ValueError:
        pass
    if code in QUOTA_CODES:
        return APIError('The Z.ai plan quota is used up; it refills when the 5-hour window resets. Try again later.', 429), 'quota'
    if resp.status_code == 429 or code in RATE_LIMIT_CODES:
        return APIError('Z.ai is rate limiting requests; try again in a moment.', 429), 'rate_limited'
    return APIError(f'Z.ai error {resp.status_code}: {message}', 502), 'error'


def _split_system(messages):
    """OpenAI-style messages (system role inline) -> (system text, Anthropic messages)."""
    system = '\n\n'.join(m['content'] for m in messages if m['role'] == 'system')
    return system, [m for m in messages if m['role'] != 'system']


def _post(payload, timeout, stream, feature, user_id):
    key = os.getenv('ZAI_API_KEY', '')
    if not key:
        raise APIError('ZAI_API_KEY not set', 500)
    headers = {'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json'}
    for attempt in range(len(_RETRY_DELAYS) + 1):
        resp = requests.post(ZAI_MESSAGES_URL, headers=headers, json=payload, timeout=timeout, stream=stream)
        if resp.status_code == 200:
            return resp
        err, status = _error_from(resp)
        resp.close()
        if status == 'rate_limited' and attempt < len(_RETRY_DELAYS):
            time.sleep(_RETRY_DELAYS[attempt])
            continue
        _log_call(feature, user_id, None, status, err.message)
        raise err


def _payload(messages, max_tokens, temperature, thinking, stream=False):
    system, msgs = _split_system(messages)
    payload = {'model': MODEL, 'max_tokens': max_tokens, 'temperature': temperature, 'messages': msgs}
    if system:
        payload['system'] = system
    if not thinking:
        payload['thinking'] = {'type': 'disabled'}
    if stream:
        payload['stream'] = True
    return payload


def complete_messages(messages, max_tokens=4096, temperature=0.7, timeout=120, feature='other', user_id=None,
                      thinking=True):
    """Blocking completion; returns (text, usage dict)."""
    resp = _post(_payload(messages, max_tokens, temperature, thinking), timeout, False, feature, user_id)
    data = resp.json()
    usage = data.get('usage') or {}
    text = ''.join(b.get('text', '') for b in data.get('content', []) if b.get('type') == 'text')
    if not text.strip():
        # GLM-5.2 reasons first; a too-small max_tokens is spent on the thinking block and leaves no answer.
        msg = 'Z.ai returned no text (token budget used up by reasoning); try again.'
        _log_call(feature, user_id, usage, 'error', msg)
        raise APIError(msg, 502)
    _log_call(feature, user_id, usage)
    return text, usage


def complete(prompt, max_tokens=4096, temperature=0.7, timeout=120, feature='other', user_id=None):
    """Single-prompt completion; returns the text."""
    text, _ = complete_messages([{'role': 'user', 'content': prompt}], max_tokens, temperature, timeout,
                                feature, user_id)
    return text


def stream_lines(messages, max_tokens=1024, temperature=0.7, feature='other', user_id=None):
    """Yield raw Anthropic SSE lines; usage is logged when the stream ends. Reasoning is off: chat must answer fast."""
    resp = _post(_payload(messages, max_tokens, temperature, False, stream=True), 120, True, feature, user_id)
    usage = {}
    status, error = 'ok', None
    try:
        for line in resp.iter_lines():
            if not line:
                continue
            line = line.decode('utf-8') if isinstance(line, bytes) else line
            if line.startswith('data: '):
                try:
                    ev = json.loads(line[6:])
                except ValueError:
                    ev = {}
                if ev.get('type') == 'message_start':
                    usage['input_tokens'] = (ev.get('message', {}).get('usage') or {}).get('input_tokens', 0)
                elif ev.get('type') == 'message_delta':
                    u = ev.get('usage') or {}
                    usage['input_tokens'] = u.get('input_tokens') or usage.get('input_tokens', 0)
                    usage['output_tokens'] = u.get('output_tokens', 0)
            yield line
    except GeneratorExit:  # client went away mid-answer; tokens were still spent
        raise
    except Exception as e:
        status, error = 'error', str(e)
        raise
    finally:
        _log_call(feature, user_id, usage, status, error)


def _ms_to_iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat() if ms else None


def quota_status():
    """The plan's 5-hour and weekly windows ({five_hour_pct, five_hour_reset, weekly_pct, weekly_reset, plan_level}).
    Cached 60 s per worker; returns None if Z.ai cannot be reached."""
    with _quota_lock:
        if time.monotonic() - _quota_cache['at'] < _QUOTA_CACHE_SECONDS:
            return _quota_cache['value']
        key = os.getenv('ZAI_API_KEY', '')
        value = None
        if key:
            try:
                resp = requests.get(QUOTA_URL, headers={'Authorization': key, 'Accept-Language': 'en-US,en'}, timeout=10)
                resp.raise_for_status()
                data = (resp.json() or {}).get('data') or {}
                five = weekly = None
                for lim in data.get('limits', []):
                    if lim.get('type') != 'TOKENS_LIMIT':
                        continue  # TIME_LIMIT is the separate web-search allowance, which is never used here
                    if (lim.get('unit'), lim.get('number')) == (3, 5):
                        five = lim
                    elif (lim.get('unit'), lim.get('number')) == (6, 1):
                        weekly = lim
                value = {
                    'plan_level': data.get('level'),
                    'five_hour_pct': float((five or {}).get('percentage') or 0),
                    'five_hour_reset': _ms_to_iso((five or {}).get('nextResetTime')),
                    'weekly_pct': float((weekly or {}).get('percentage') or 0),
                    'weekly_reset': _ms_to_iso((weekly or {}).get('nextResetTime')),
                }
            except Exception as e:
                log.warning('Z.ai quota poll failed: %s', e)
        _quota_cache.update(at=time.monotonic(), value=value)
        return value


def usage_summary(days=30):
    """Per-feature and per-user totals from the usage log."""
    by_feature = execute_query(
        '''SELECT feature, COUNT(*)::int AS calls,
                  COUNT(*) FILTER (WHERE status <> 'ok')::int AS problems,
                  COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens
           FROM training.zai_usage_log WHERE created_at > now() - make_interval(days => %s)
           GROUP BY feature ORDER BY tokens DESC''', (days,))
    by_user = execute_query(
        '''SELECT COALESCE(u.email, 'system') AS user, COUNT(*)::int AS calls,
                  COALESCE(SUM(l.input_tokens + l.output_tokens), 0)::bigint AS tokens
           FROM training.zai_usage_log l LEFT JOIN training.users u ON u.id = l.user_id
           WHERE l.created_at > now() - make_interval(days => %s)
           GROUP BY u.email ORDER BY tokens DESC LIMIT 20''', (days,))
    return {'days': days, 'by_feature': [dict(r) for r in by_feature], 'by_user': [dict(r) for r in by_user]}
