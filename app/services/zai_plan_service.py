"""
Z.ai (GLM) via the Coding Plan, for content generation.

Uses the Anthropic-compatible /v1/messages endpoint, which is billed against the plan's rolling 5-hour token window.
The native /paas/v4 endpoint (used by ai_coach_service) draws from separate pay-as-you-go credits instead.
No `tools` key is ever sent, so calls stay on the plain chat quota and never touch the web-search quota.
"""
import os
import time
import requests

from app.exceptions import APIError

ZAI_MESSAGES_URL = 'https://api.z.ai/api/anthropic/v1/messages'
ANTHROPIC_VERSION = '2023-06-01'
MODEL = 'glm-5.2'

# 1302/1303/1305 are short request-rate limits (retried); 1304/1308/1310 mean the plan window is spent (daily/5-hour/weekly).
RATE_LIMIT_CODES = {'1302', '1303', '1305'}
QUOTA_CODES = {'1304', '1308', '1310'}
_RETRY_DELAYS = (2, 5, 10)


def _error_from(resp) -> APIError:
    message, code = resp.text[:300], ''
    try:
        err = (resp.json() or {}).get('error') or {}
        code = str(err.get('code') or '')
        message = err.get('message') or message
    except ValueError:
        pass
    if code in QUOTA_CODES:
        return APIError('The Z.ai plan quota is used up; it refills when the 5-hour window resets. Try again later.', 429)
    if resp.status_code == 429 or code in RATE_LIMIT_CODES:
        return APIError('Z.ai is rate limiting requests; try again in a moment.', 429)
    return APIError(f'Z.ai error {resp.status_code}: {message}', 502)


def complete(prompt: str, max_tokens: int = 4096, temperature: float = 0.7, timeout: int = 120) -> str:
    """Blocking single-prompt completion; returns the text."""
    key = os.getenv('ZAI_API_KEY', '')
    if not key:
        raise APIError('ZAI_API_KEY not set', 500)
    headers = {'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json'}
    payload = {'model': MODEL, 'max_tokens': max_tokens, 'temperature': temperature,
               'messages': [{'role': 'user', 'content': prompt}]}
    for attempt in range(len(_RETRY_DELAYS) + 1):
        resp = requests.post(ZAI_MESSAGES_URL, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 200:
            blocks = resp.json().get('content', [])
            text = ''.join(b.get('text', '') for b in blocks if b.get('type') == 'text')
            if not text.strip():
                # GLM-5.2 reasons first; a too-small max_tokens is spent on the thinking block and leaves no answer.
                raise APIError('Z.ai returned no text (token budget used up by reasoning); try again.', 502)
            return text
        err = _error_from(resp)
        if err.status_code == 429 and 'rate limiting' in err.message and attempt < len(_RETRY_DELAYS):
            time.sleep(_RETRY_DELAYS[attempt])
            continue
        raise err
