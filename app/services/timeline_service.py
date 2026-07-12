"""
Shared DB helpers for the multi-track timeline editor
(training.content_tracks / training.content_clips).
"""
import json
import subprocess
from app.db import execute_query
from app.exceptions import NotFoundError

TRACK_KINDS = ('video', 'image', 'audio', 'caption')
SOURCE_TYPES = ('video', 'image', 'audio', 'text')

# Track kind a given clip source_type is allowed to live on.
SOURCE_TYPE_TO_TRACK_KIND = {
    'video': 'video',
    'image': 'image',
    'audio': 'audio',
    'text': 'caption',
}

DEFAULT_IMAGE_DURATION_SEC = 5.0


def get_track(track_id: str, story_id: str) -> dict:
    track = execute_query(
        'SELECT * FROM training.content_tracks WHERE id = %s AND story_id = %s',
        (track_id, story_id), fetch_one=True
    )
    if not track:
        raise NotFoundError('Track not found')
    return dict(track)


def get_clip(clip_id: str, track_id: str) -> dict:
    clip = execute_query(
        'SELECT * FROM training.content_clips WHERE id = %s AND track_id = %s',
        (clip_id, track_id), fetch_one=True
    )
    if not clip:
        raise NotFoundError('Clip not found')
    return dict(clip)


def get_timeline(story_id: str) -> dict:
    """Return {tracks: [...], clips: [...]} for a story's multi-track timeline."""
    tracks = execute_query(
        'SELECT * FROM training.content_tracks WHERE story_id = %s ORDER BY position',
        (story_id,)
    )
    clips = execute_query(
        '''SELECT c.* FROM training.content_clips c
           JOIN training.content_tracks t ON t.id = c.track_id
           WHERE t.story_id = %s ORDER BY c.timeline_start_sec''',
        (story_id,)
    )
    return {
        'tracks': [dict(t) for t in tracks],
        'clips': [dict(c) for c in clips],
    }


def next_clip_start(story_id: str) -> float:
    """Append point for a newly uploaded clip: end of the latest clip on this story's timeline."""
    row = execute_query(
        '''SELECT COALESCE(MAX(c.timeline_end_sec), 0) AS max_end
           FROM training.content_clips c
           JOIN training.content_tracks t ON t.id = c.track_id
           WHERE t.story_id = %s''',
        (story_id,), fetch_one=True
    )
    return float(row['max_end'] or 0)


def probe_media(file_path: str) -> dict:
    """
    Run ffprobe to extract duration/width/height. Tolerant of missing tags/streams
    (unlike media_sync_service.extract_video_metadata, which requires a creation_time
    tag — legacy content clips never had that tag). Returns None fields on any failure.
    """
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json',
             '-show_format', '-show_streams', file_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return {'duration_sec': None, 'width': None, 'height': None}

        info = json.loads(result.stdout)
        fmt = info.get('format', {})
        duration = fmt.get('duration')
        duration_sec = float(duration) if duration is not None else None

        width = height = None
        for stream in info.get('streams', []):
            if stream.get('codec_type') == 'video':
                width = stream.get('width')
                height = stream.get('height')
                break

        return {'duration_sec': duration_sec, 'width': width, 'height': height}
    except Exception:
        return {'duration_sec': None, 'width': None, 'height': None}
