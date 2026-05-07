"""
Strava OAuth2 + Activity sync service.

Flow:
  1. User clicks Connect → redirect to Strava OAuth
  2. Strava redirects back with ?code= → exchange for access+refresh tokens
  3. Store tokens in training.sync_tokens
  4. /api/sync/strava/run → fetch activities since last sync → match to plan → upsert workout_logs
  5. Webhook: Strava POSTs to /api/sync/strava/webhook on new activity → instant import
"""
import os
import logging
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
import requests

log = logging.getLogger(__name__)

STRAVA_AUTH_URL  = 'https://www.strava.com/oauth/authorize'
STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
STRAVA_API_BASE  = 'https://www.strava.com/api/v3'

# Strava sport_type → our sport enum
SPORT_MAP = {
    'Run':                          'run',
    'VirtualRun':                   'run',
    'TrailRun':                     'run',
    'Walk':                         'run',
    'Hike':                         'run',
    'Ride':                         'cycle',
    'VirtualRide':                  'cycle',
    'GravelRide':                   'cycle',
    'EBikeRide':                    'cycle',
    'MountainBikeRide':             'cycle',
    'Handcycle':                    'cycle',
    'Swim':                         'swim',
    'WeightTraining':               'strength',
    'Crossfit':                     'strength',
    'HighIntensityIntervalTraining':'strength',
    'Elliptical':                   'strength',
    'StairStepper':                 'strength',
    'Yoga':                         'core',
    'Pilates':                      'core',
    'Rowing':                       'strength',
    'VirtualRow':                   'strength',
}


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

def get_auth_url(client_id: str, redirect_uri: str, state: str = '') -> str:
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'activity:read_all',
        'approval_prompt': 'auto',
    }
    if state:
        params['state'] = state
    return f"{STRAVA_AUTH_URL}?{urlencode(params)}"


def exchange_code(client_id: str, client_secret: str, code: str) -> dict:
    resp = requests.post(STRAVA_TOKEN_URL, data={
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'grant_type': 'authorization_code',
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def refresh_access_token(client_id: str, client_secret: str, refresh_tok: str) -> dict:
    resp = requests.post(STRAVA_TOKEN_URL, data={
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_tok,
        'grant_type': 'refresh_token',
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_valid_token(token_row: dict, client_id: str, client_secret: str) -> tuple[str, dict | None]:
    """
    Returns (access_token, refreshed_data_or_None).
    If token was refreshed, refreshed_data contains the new token fields to persist.
    """
    expires_at = token_row.get('expires_at')
    if expires_at:
        if hasattr(expires_at, 'replace'):
            # psycopg2 datetime object
            exp = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at
        else:
            exp = datetime.fromtimestamp(float(expires_at), tz=timezone.utc)
        if (exp - datetime.now(timezone.utc)).total_seconds() < 300:
            data = refresh_access_token(client_id, client_secret, token_row['refresh_token'])
            return data['access_token'], data
    return token_row['access_token'], None


# ---------------------------------------------------------------------------
# Activity fetch
# ---------------------------------------------------------------------------

def fetch_activities(access_token: str, after_epoch: int = None, per_page: int = 50) -> list:
    """Fetch Strava activities. after_epoch limits to activities after that Unix timestamp."""
    params = {'per_page': per_page, 'page': 1}
    if after_epoch:
        params['after'] = int(after_epoch)

    activities = []
    while True:
        resp = requests.get(
            f"{STRAVA_API_BASE}/athlete/activities",
            headers={'Authorization': f'Bearer {access_token}'},
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        if len(batch) < per_page:
            break
        params['page'] += 1
    return activities


def fetch_activity_detail(access_token: str, activity_id) -> dict:
    resp = requests.get(
        f"{STRAVA_API_BASE}/activities/{activity_id}",
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_activity_zones(access_token: str, activity_id) -> list:
    """Fetch HR + power zone distribution for a single activity."""
    resp = requests.get(
        f"{STRAVA_API_BASE}/activities/{activity_id}/zones",
        headers={'Authorization': f'Bearer {access_token}'},
        timeout=15,
    )
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Data mapping
# ---------------------------------------------------------------------------

def map_activity(activity: dict) -> dict:
    """Map a Strava SummaryActivity to our workout_log field set."""
    sport_type = activity.get('sport_type') or activity.get('type', 'Run')
    sport = SPORT_MAP.get(sport_type, 'run')

    start_local = activity.get('start_date_local') or activity.get('start_date', '')
    log_date = start_local[:10] if start_local else None

    moving_sec = float(activity.get('moving_time') or 0)
    distance_m = float(activity.get('distance') or 0)

    avg_hr  = activity.get('average_heartrate')
    max_hr  = activity.get('max_heartrate')
    avg_w   = activity.get('average_watts')
    cal     = activity.get('calories')
    suffer  = activity.get('suffer_score')      # Strava's RPE proxy (0-100)
    rpe     = round(suffer / 10) if suffer else None  # convert to 1-10

    return {
        'external_id':        str(activity['id']),
        'source':             'strava',
        'sport':              sport,
        'log_date':           log_date,
        'actual_duration_min':round(moving_sec / 60, 1) if moving_sec else None,
        'actual_distance_km': round(distance_m / 1000, 2) if distance_m else None,
        'avg_hr':             int(avg_hr) if avg_hr else None,
        'max_hr':             int(max_hr) if max_hr else None,
        'avg_power_watts':    int(avg_w) if avg_w else None,
        'calories_burned':    int(cal) if cal else None,
        'perceived_effort':   rpe,
        'notes':              activity.get('name', ''),
        'raw_data':           activity,
    }


# ---------------------------------------------------------------------------
# Match & upsert
# ---------------------------------------------------------------------------

def match_to_plan(mapped: dict, user_id: str, db_query_fn) -> str | None:
    """
    Find the planned workout_id that best matches this activity.
    Primary: same date + same sport + duration within ±40%.
    Fallback: if exactly one planned workout of that sport exists on the day,
    match it anyway — athlete may have cut the session short.
    Returns workout_id or None.
    """
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
