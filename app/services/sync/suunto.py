"""
Suunto Cloud API OAuth2 + Workout sync service.

Prerequisites (one-time):
  1. Apply at apizone.suunto.com (requires organization account)
  2. Get SUUNTO_CLIENT_ID, SUUNTO_CLIENT_SECRET, SUUNTO_SUBSCRIPTION_KEY
  3. Set redirect URI to https://training.rinosbike.com/api/sync/suunto/callback

Flow:
  GET /api/sync/suunto/connect → redirect to Suunto OAuth
  GET /api/sync/suunto/callback?code= → exchange code → store tokens
  POST /api/sync/suunto/run → fetch workouts since last sync → match → upsert
  POST /api/sync/suunto/webhook → real-time push on new workout
"""
import os
import hmac
import hashlib
import logging
from datetime import datetime, timezone
from urllib.parse import urlencode
import requests

log = logging.getLogger(__name__)

SUUNTO_AUTH_URL  = 'https://cloudapi-oauth.suunto.com/oauth/authorize'
SUUNTO_TOKEN_URL = 'https://cloudapi-oauth.suunto.com/oauth/token'
SUUNTO_API_BASE  = 'https://cloudapi.suunto.com'

# Suunto activityId (numeric) → our sport enum
# Full mapping available in Activities.pdf (developer portal).
# Common IDs verified from examples:
ACTIVITY_MAP = {
    1:  'run',      # Running
    2:  'cycle',    # Mountain Biking
    3:  'cycle',    # Cycling / Road
    4:  'swim',     # Swimming (pool & open water in some firmware)
    5:  'strength', # Gym / Indoor
    6:  'run',      # Trail Running
    7:  'run',      # Ultra Running
    11: 'swim',     # Open Water Swimming
    13: 'run',      # Treadmill
    28: 'strength', # CrossFit / Circuit Training
    58: 'core',     # Yoga
    64: 'strength', # Strength Training
    75: 'cycle',    # Indoor Cycling / Spinning
    93: 'run',      # Nordic Walking
}
_DEFAULT_SPORT = 'run'


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

def get_auth_url(client_id: str, redirect_uri: str, state: str = '') -> str:
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'workout',
    }
    if state:
        params['state'] = state
    return f"{SUUNTO_AUTH_URL}?{urlencode(params)}"


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    resp = requests.post(SUUNTO_TOKEN_URL, data={
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(client_id: str, client_secret: str, refresh_tok: str) -> dict:
    resp = requests.post(SUUNTO_TOKEN_URL, data={
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_tok,
        'grant_type': 'refresh_token',
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_valid_token(token_row: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    """Returns (access_token, refreshed_data_or_None). Token valid 24h."""
    expires_at = token_row.get('expires_at')
    if expires_at:
        if hasattr(expires_at, 'replace'):
            exp = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at
        else:
            exp = datetime.fromtimestamp(float(expires_at), tz=timezone.utc)
        if (exp - datetime.now(timezone.utc)).total_seconds() < 300:
            data = refresh_access_token(client_id, client_secret, token_row['refresh_token'])
            return data['access_token'], data
    return token_row['access_token'], None


def _headers(access_token: str, subscription_key: str) -> dict:
    """Suunto requires both Bearer + subscription key headers."""
    return {
        'Authorization': f'Bearer {access_token}',
        'Ocp-Apim-Subscription-Key': subscription_key,
    }


# ---------------------------------------------------------------------------
# Workout fetch
# ---------------------------------------------------------------------------

def fetch_workouts(access_token: str, subscription_key: str,
                   since_epoch_ms: int = None, limit: int = 50) -> list:
    """Fetch workouts from Suunto Cloud API with pagination."""
    params = {'limit': limit, 'offset': 0}
    if since_epoch_ms:
        params['since'] = int(since_epoch_ms)

    workouts = []
    while True:
        resp = requests.get(
            f"{SUUNTO_API_BASE}/v2/workouts",
            headers=_headers(access_token, subscription_key),
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get('payload', data) if isinstance(data, dict) else data
        if not batch:
            break
        workouts.extend(batch)
        if len(batch) < limit:
            break
        params['offset'] += limit
    return workouts


def fetch_workout_detail(access_token: str, subscription_key: str, workout_key: str) -> dict:
    resp = requests.get(
        f"{SUUNTO_API_BASE}/v2/workouts/{workout_key}",
        headers=_headers(access_token, subscription_key),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Data mapping
# ---------------------------------------------------------------------------

def map_workout(workout: dict) -> dict:
    """Map a Suunto workout to our workout_log field set."""
    activity_id = workout.get('activityId') or workout.get('activityid', 1)
    sport = ACTIVITY_MAP.get(int(activity_id), _DEFAULT_SPORT)

    start_ms = workout.get('startTime') or workout.get('starttime', 0)
    if start_ms:
        dt = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
        # Use local time via offset
        offset_min = workout.get('timeOffsetInMinutes') or workout.get('timeoffsetinminutes', 0)
        from datetime import timedelta
        local_dt = dt + timedelta(minutes=offset_min)
        log_date = local_dt.strftime('%Y-%m-%d')
    else:
        log_date = None

    total_sec = float(workout.get('totalTime') or 0)
    distance_m = float(workout.get('totalDistance') or 0)

    hr_data = workout.get('hrdata') or workout.get('hrData') or {}
    avg_hr = hr_data.get('workoutAvgHR') or hr_data.get('workoutavghr')
    max_hr = hr_data.get('workoutMaxHR') or hr_data.get('workoutmaxhr')

    # Suunto-specific richness
    peak_te      = workout.get('peakTrainingEffect') or workout.get('peaktrainingeffect')
    recovery_h   = workout.get('recoveryTime') or workout.get('recoverytime')  # hours
    energy_kcal  = workout.get('energyConsumption') or workout.get('energyconsumption')

    return {
        'external_id':        str(workout.get('workoutKey') or workout.get('workoutkey', '')),
        'source':             'suunto',
        'sport':              sport,
        'log_date':           log_date,
        'actual_duration_min':round(total_sec / 60, 1) if total_sec else None,
        'actual_distance_km': round(distance_m / 1000, 2) if distance_m else None,
        'avg_hr':             int(avg_hr) if avg_hr else None,
        'max_hr':             int(max_hr) if max_hr else None,
        'avg_power_watts':    None,  # Suunto power in samples, not summary
        'calories_burned':    int(energy_kcal) if energy_kcal else None,
        'perceived_effort':   None,  # no direct RPE in Suunto
        'notes':              f"Suunto | Peak TE: {peak_te} | Recovery: {recovery_h}h" if peak_te else '',
        'raw_data':           workout,
    }


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------

def verify_webhook_signature(payload_bytes: bytes, signature_header: str, secret: str) -> bool:
    """Verify Suunto webhook HMAC-SHA256 signature."""
    expected = hmac.new(
        secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header or '')


# ---------------------------------------------------------------------------
# Match to plan (identical logic to Strava)
# ---------------------------------------------------------------------------

def match_to_plan(mapped: dict, user_id: str, db_query_fn) -> str | None:
    if not mapped.get('log_date'):
        return None
    rows = db_query_fn(
        '''SELECT w.id, w.sport, w.duration_min
           FROM training.workouts w
           JOIN training.plan_days pd ON pd.id = w.plan_day_id
           WHERE pd.user_id = %s AND pd.date = %s::date''',
        (user_id, mapped['log_date'])
    )
    if not rows:
        return None
    dur = mapped.get('actual_duration_min') or 0
    sport = mapped['sport']
    same_sport = [row for row in rows if row['sport'] == sport]
    if not same_sport:
        return None
    best, best_diff = None, float('inf')
    for row in same_sport:
        plan_dur = float(row['duration_min'] or 0)
        if plan_dur == 0:
            continue
        diff = abs(dur - plan_dur) / plan_dur
        if diff < 0.40 and diff < best_diff:
            best, best_diff = str(row['id']), diff
    # Fallback: only one option of this sport — match regardless of duration
    if best is None and len(same_sport) == 1:
        best = str(same_sport[0]['id'])
    return best
