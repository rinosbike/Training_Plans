import json
import subprocess
import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)


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
