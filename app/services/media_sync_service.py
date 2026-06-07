import json
import re
import subprocess
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

_DJI_FILENAME_RE = re.compile(r'DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_')


def correct_dji_clock(video_start: datetime, filename: str, strava_detail: dict) -> datetime:
    """
    DJI cameras often store creation_time with the wrong timezone (e.g. UTC-6 labelled
    as UTC). The filename timestamp is always in the camera's local clock which matches
    the user's local time. Use the DJI filename + Strava's local timezone to compute the
    correct UTC start, and return it when it differs from creation_time by more than 60s.
    """
    m = _DJI_FILENAME_RE.match(filename or '')
    if not m:
        return video_start

    yr, mo, dy, hh, mn, ss = [int(x) for x in m.groups()]
    start_date_local = strava_detail.get('start_date_local', '')
    start_date_utc   = strava_detail.get('start_date', '')
    if not start_date_local or not start_date_utc:
        return video_start

    # Derive the UTC offset from the Strava activity.
    # Python 3.11+ fromisoformat() accepts 'Z' as UTC, making the result timezone-aware.
    # Strip timezone info so both are naive before arithmetic.
    local_dt = datetime.fromisoformat(start_date_local.replace('Z', '+00:00')).replace(tzinfo=None)
    utc_dt   = datetime.fromisoformat(start_date_utc.replace('Z', '+00:00')).replace(tzinfo=None)
    tz_offset = local_dt - utc_dt  # e.g. timedelta(hours=2) for CEST

    # Convert DJI filename local time → UTC
    filename_utc = datetime(yr, mo, dy, hh, mn, ss, tzinfo=timezone.utc) - tz_offset

    creation_utc = video_start.replace(tzinfo=timezone.utc) if video_start.tzinfo is None else video_start
    drift_sec = abs((creation_utc - filename_utc).total_seconds())

    if drift_sec > 60:
        log.info('DJI clock drift %.0fs detected — correcting creation_time from %s to %s',
                 drift_sec, creation_utc.isoformat(), filename_utc.isoformat())
        return filename_utc

    return video_start


def extract_video_metadata(file_path: str) -> dict:
    """
    Run ffprobe on the video file and return:
      - video_start: UTC datetime (from DJI/camera creation_time tag)
      - duration_sec: float
    Raises ValueError if creation_time is absent (camera clock not synced via DJI Mimo).
    """
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-print_format', 'json',
         '-show_format', file_path],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise ValueError(f'ffprobe failed: {result.stderr.strip()}')

    info = json.loads(result.stdout)
    fmt  = info.get('format', {})
    tags = fmt.get('tags', {})

    creation_time_str = tags.get('creation_time')
    if not creation_time_str:
        raise ValueError(
            'No creation_time in video metadata — sync DJI Mimo with the camera before recording'
        )

    video_start  = datetime.fromisoformat(creation_time_str.replace('Z', '+00:00'))
    duration_sec = float(fmt.get('duration', 0))
    return {'video_start': video_start, 'duration_sec': duration_sec}


def _interp(times, values, t):
    """Linear interpolation of values array at time t (seconds from activity start)."""
    if not times or not values or len(times) != len(values):
        return None
    if t <= times[0]:
        return float(values[0])
    if t >= times[-1]:
        return float(values[-1])
    for i in range(1, len(times)):
        if times[i] >= t:
            t0, t1 = times[i - 1], times[i]
            v0, v1 = values[i - 1], values[i]
            frac = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return v0 + frac * (v1 - v0)
    return float(values[-1])


def compute_sync(video_start: datetime, duration_sec: float,
                 strava_start_utc: datetime, streams_raw: dict) -> dict:
    """
    Align video timestamps with Strava activity streams using UTC clock comparison.

    strava_start_utc  — activity.start_date from Strava API (UTC)
    streams_raw       — raw streams dict from fetch_activity_streams(), full resolution

    Returns:
      offset_sec, km_start, km_end (floats with 4dp),
      strava_time_start, strava_time_end,
      metrics (list of {t, km, hr, speed} — one entry per second of video)
    """
    if video_start.tzinfo is None:
        video_start = video_start.replace(tzinfo=timezone.utc)

    offset_sec = (video_start - strava_start_utc).total_seconds()

    time_data = streams_raw.get('time', {}).get('data', [])
    dist_data = streams_raw.get('distance', {}).get('data', [])     # metres
    hr_data   = streams_raw.get('heartrate', {}).get('data', [])
    vel_data  = streams_raw.get('velocity_smooth', {}).get('data', [])  # m/s

    def km_at(t):
        d = _interp(time_data, dist_data, t)
        return round(d / 1000, 4) if d is not None else None

    km_start = km_at(offset_sec)
    km_end   = km_at(offset_sec + duration_sec)

    metrics = []
    for t in range(int(duration_sec) + 1):
        strava_t = offset_sec + t
        dist = _interp(time_data, dist_data, strava_t)
        hr   = _interp(time_data, hr_data, strava_t)
        vel  = _interp(time_data, vel_data, strava_t)
        metrics.append({
            't':     t,
            'km':    round(dist / 1000, 4) if dist is not None else None,
            'hr':    round(hr)             if hr   is not None else None,
            'speed': round(vel * 3.6, 1)  if vel  is not None else None,
        })

    return {
        'offset_sec':         offset_sec,
        'km_start':           km_start,
        'km_end':             km_end,
        'strava_time_start':  offset_sec,
        'strava_time_end':    offset_sec + duration_sec,
        'metrics':            metrics,
    }
