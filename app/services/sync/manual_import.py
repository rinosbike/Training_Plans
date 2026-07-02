"""
Manual FIT/GPX import — fallback path when Strava/Suunto live sync is unavailable.

User exports a .fit or .gpx file from their watch's companion app and uploads it
directly; we parse both the summary metrics (for workout_logs columns) and the
full time-series data (streams/laps/map route) so the workout detail page can
render the same kind of rich analysis chart it used to fetch live from Strava —
all sourced from the uploaded file, stored once in workout_logs.raw_data.
"""
import hashlib
import logging
from datetime import datetime, timezone

import gpxpy
from fitparse import FitFile

log = logging.getLogger(__name__)

# FIT sport enum (as decoded by fitparse) → our sport enum
FIT_SPORT_MAP = {
    'running':          'run',
    'walking':          'run',
    'hiking':           'run',
    'cycling':          'cycle',
    'swimming':         'swim',
    'training':         'strength',
    'strength_training':'strength',
    'fitness_equipment':'strength',
    'rowing':           'strength',
    'yoga':             'core',
}

MAX_STREAM_POINTS = 500
SEMICIRCLE = 180 / (2 ** 31)


def _external_id(file_bytes: bytes) -> str:
    return 'manual-' + hashlib.sha256(file_bytes).hexdigest()[:16]


def _downsample(arr, max_pts=MAX_STREAM_POINTS):
    if not arr or len(arr) <= max_pts:
        return arr
    step = max(1, len(arr) // max_pts)
    return arr[::step]


def _encode_number(num):
    out = []
    while num >= 0x20:
        out.append(chr((0x20 | (num & 0x1f)) + 63))
        num >>= 5
    out.append(chr(num + 63))
    return ''.join(out)


def _encode_polyline(coords, precision=5):
    """Google encoded-polyline format — same format Strava's summary_polyline uses,
    so the existing RouteMap component works unmodified."""
    factor = 10 ** precision
    out = []
    prev_lat = prev_lng = 0
    for lat, lng in coords:
        lat_i, lng_i = round(lat * factor), round(lng * factor)
        for delta in (lat_i - prev_lat, lng_i - prev_lng):
            shifted = ~(delta << 1) if delta < 0 else (delta << 1)
            out.append(_encode_number(shifted))
        prev_lat, prev_lng = lat_i, lng_i
    return ''.join(out)


# ---------------------------------------------------------------------------
# FIT
# ---------------------------------------------------------------------------

def parse_fit(file_bytes: bytes) -> dict:
    """Parse a FIT file into summary + streams + laps + route, in one pass."""
    fitfile = FitFile(file_bytes)

    session_msg = next(iter(fitfile.get_messages('session')), None)
    session = {f.name: f.value for f in session_msg} if session_msg else {}

    laps = []
    for lap_msg in fitfile.get_messages('lap'):
        l = {f.name: f.value for f in lap_msg}
        laps.append({
            'moving_time':        l.get('total_timer_time'),
            'distance':           l.get('total_distance'),
            'average_speed':      l.get('avg_speed'),
            'average_heartrate':  l.get('avg_heart_rate'),
            'average_watts':      l.get('avg_power'),
        })

    time_s, distance, heartrate, altitude, cadence, velocity, coords = [], [], [], [], [], [], []
    start_time = session.get('start_time')

    for rec_msg in fitfile.get_messages('record'):
        r = {f.name: f.value for f in rec_msg}
        ts = r.get('timestamp')
        if ts is None:
            continue
        if start_time is None:
            start_time = ts

        time_s.append((ts - start_time).total_seconds())
        distance.append(r.get('distance'))
        heartrate.append(r.get('heart_rate'))
        altitude.append(r.get('altitude') or r.get('enhanced_altitude'))
        cadence.append(r.get('cadence'))
        velocity.append(r.get('speed') or r.get('enhanced_speed'))

        lat, lng = r.get('position_lat'), r.get('position_long')
        if lat is not None and lng is not None:
            coords.append((lat * SEMICIRCLE, lng * SEMICIRCLE))

    if not session and not time_s:
        raise ValueError('FIT file has no session or record data')

    def stream(arr):
        return _downsample(arr) if any(v is not None for v in arr) else None

    streams = {k: v for k, v in {
        'time':             stream(time_s),
        'distance':         stream(distance),
        'heartrate':        stream(heartrate),
        'altitude':         stream(altitude),
        'cadence':          stream(cadence),
        'velocity_smooth':  stream(velocity),
    }.items() if v}

    alt_vals = [a for a in altitude if a is not None]

    return {
        'sport_raw':      str(session.get('sport') or '').lower(),
        'start_time':     start_time,
        'duration_sec':   session.get('total_timer_time') or (time_s[-1] if time_s else None),
        'distance_m':     session.get('total_distance') or (distance[-1] if distance and distance[-1] else None),
        'avg_hr':         session.get('avg_heart_rate'),
        'max_hr':         session.get('max_heart_rate'),
        'avg_power':      session.get('avg_power'),
        'max_power':      session.get('max_power'),
        'calories':       session.get('total_calories'),
        'total_elevation_gain': session.get('total_ascent'),
        'elev_high':      max(alt_vals) if alt_vals else None,
        'elev_low':       min(alt_vals) if alt_vals else None,
        'streams':        streams,
        'laps':           laps,
        'map_polyline':   _encode_polyline(_downsample(coords)) if len(coords) > 1 else None,
    }


# ---------------------------------------------------------------------------
# GPX
# ---------------------------------------------------------------------------

def parse_gpx(file_bytes: bytes) -> dict:
    """Extract summary + streams from a GPX track. GPX carries no sport type,
    power, cadence or calorie data — caller should let the user pick the sport."""
    gpx = gpxpy.parse(file_bytes.decode('utf-8', errors='ignore'))

    points = [p for track in gpx.tracks for seg in track.segments for p in seg.points]
    if not points:
        raise ValueError('GPX file has no track points')

    start_time = points[0].time
    time_s, distance, heartrate, altitude, coords = [], [], [], [], []
    cum_dist = 0.0
    prev = None

    for p in points:
        if p.time and start_time:
            time_s.append((p.time - start_time).total_seconds())
        else:
            time_s.append(None)
        if prev is not None:
            cum_dist += prev.distance_3d(p) or prev.distance_2d(p) or 0
        distance.append(round(cum_dist, 1))
        altitude.append(p.elevation)
        coords.append((p.latitude, p.longitude))

        hr = None
        for ext in (p.extensions or []):
            hr_el = ext.find('.//{*}hr')
            if hr_el is not None and hr_el.text:
                hr = int(hr_el.text)
        heartrate.append(hr)
        prev = p

    def stream(arr):
        return _downsample(arr) if any(v is not None for v in arr) else None

    streams = {k: v for k, v in {
        'time':      stream(time_s),
        'distance':  stream(distance),
        'heartrate': stream(heartrate),
        'altitude':  stream(altitude),
    }.items() if v}

    hrs = [h for h in heartrate if h is not None]
    alt_vals = [a for a in altitude if a is not None]
    times = [p.time for p in points if p.time]

    return {
        'sport_raw':      '',
        'start_time':     start_time,
        'duration_sec':   (max(times) - min(times)).total_seconds() if len(times) > 1 else None,
        'distance_m':     cum_dist or None,
        'avg_hr':         round(sum(hrs) / len(hrs)) if hrs else None,
        'max_hr':         max(hrs) if hrs else None,
        'avg_power':      None,
        'max_power':      None,
        'calories':       None,
        'total_elevation_gain': None,
        'elev_high':      max(alt_vals) if alt_vals else None,
        'elev_low':       min(alt_vals) if alt_vals else None,
        'streams':        streams,
        'laps':           [],
        'map_polyline':   _encode_polyline(_downsample(coords)) if len(coords) > 1 else None,
    }


# ---------------------------------------------------------------------------
# Map to workout_log shape (mirrors strava_svc.map_activity)
# ---------------------------------------------------------------------------

def map_summary(parsed: dict, file_bytes: bytes, filename: str,
                 sport_override: str = None, log_date_override: str = None) -> dict:
    start_time = parsed.get('start_time')
    if log_date_override:
        log_date = log_date_override
    elif isinstance(start_time, datetime):
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        log_date = start_time.date().isoformat()
    else:
        log_date = datetime.now(timezone.utc).date().isoformat()

    sport = sport_override or FIT_SPORT_MAP.get(parsed.get('sport_raw', ''), 'run')

    duration_sec = parsed.get('duration_sec')
    distance_m = parsed.get('distance_m')

    raw_data = {
        'activity_id':          _external_id(file_bytes),
        'streams':               parsed.get('streams') or {},
        'laps':                  parsed.get('laps') or [],
        'map_polyline':          parsed.get('map_polyline'),
        'total_elevation_gain':  parsed.get('total_elevation_gain'),
        'elev_high':             parsed.get('elev_high'),
        'elev_low':              parsed.get('elev_low'),
        'average_watts':         parsed.get('avg_power'),
        'max_watts':              parsed.get('max_power'),
        'device_watts':          bool(parsed.get('avg_power')),
        'total_distance_m':      distance_m,
        'sport_type':            sport,
        'filename':               filename,
    }

    return {
        'external_id':        raw_data['activity_id'],
        'source':              'manual',
        'sport':               sport,
        'log_date':            log_date,
        'actual_duration_min': round(float(duration_sec) / 60, 1) if duration_sec else None,
        'actual_distance_km':  round(float(distance_m) / 1000, 2) if distance_m else None,
        'avg_hr':              int(parsed['avg_hr']) if parsed.get('avg_hr') else None,
        'max_hr':              int(parsed['max_hr']) if parsed.get('max_hr') else None,
        'avg_power_watts':     int(parsed['avg_power']) if parsed.get('avg_power') else None,
        'calories_burned':     int(parsed['calories']) if parsed.get('calories') else None,
        'perceived_effort':    None,
        'notes':               filename,
        'raw_data':            raw_data,
    }
