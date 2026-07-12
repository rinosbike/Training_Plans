"""
Content Tracks API — multi-track timeline editor for the Content (Reel Builder) feature.

Adds a real multi-track model (video / image / audio / caption layers with
per-clip trim + timeline placement) on top of the existing single-track
content_stories/content_scenes model. A story opts in via
content_stories.editor_mode: 'legacy' (default, untouched scene-based flow)
or 'tracks' (this module). Legacy stories are upgraded on demand via /upgrade.

- POST   /api/content/stories/<sid>/upgrade                          legacy scenes -> tracks (idempotent)
- POST   /api/content/stories/<sid>/tracks                           add track
- PUT    /api/content/stories/<sid>/tracks/<tid>                     update track
- DELETE /api/content/stories/<sid>/tracks/<tid>                     delete track + its clips + R2 objects
- POST   /api/content/stories/<sid>/tracks/<tid>/clips/upload         upload a video/image/audio clip -> R2
- POST   /api/content/stories/<sid>/tracks/<tid>/clips                 add a text/caption clip (no file)
- PUT    /api/content/stories/<sid>/tracks/<tid>/clips/<cid>           update trim/position/text/style/volume/track
- DELETE /api/content/stories/<sid>/tracks/<tid>/clips/<cid>           delete clip + R2 object
- POST   /api/content/stories/<sid>/transcribe                         auto-transcribe a video/audio clip -> caption track (background job)
- GET    /api/content/stories/<sid>/transcribe/<job_id>                poll transcription job status
"""
import os
import tempfile
import uuid
import logging

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError
from app.services import timeline_service
from app.services.storage_service import (
    upload_fileobj_streaming, download_file, delete_file, ALLOWED_CONTENT_MIME_TYPES
)
from app.api.content import _require_user, _get_story

log = logging.getLogger(__name__)
content_tracks_bp = Blueprint('content_tracks', __name__)

_CONTENT_TYPE_TO_SOURCE_TYPE = {
    'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video',
    'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
    'image/gif': 'image', 'image/svg+xml': 'image',
    'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/wav': 'audio',
    'audio/x-wav': 'audio', 'audio/webm': 'audio', 'audio/ogg': 'audio',
}

_EXT_BY_CONTENT_TYPE = {
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg',
    'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
    'audio/x-wav': '.wav', 'audio/webm': '.weba', 'audio/ogg': '.ogg',
}


# ─── Legacy → tracks upgrade ─────────────────────────────────────────────────

@content_tracks_bp.route('/api/content/stories/<story_id>/upgrade', methods=['POST'])
@jwt_required()
def upgrade_story(story_id):
    user_id, role = _require_user()
    story = _get_story(story_id, user_id, role)

    if story['editor_mode'] == 'tracks':
        return jsonify({'editor_mode': 'tracks', 'warnings': [], **timeline_service.get_timeline(story_id)})

    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s ORDER BY position',
        (story_id,)
    )

    video_track = execute_write(
        '''INSERT INTO training.content_tracks (story_id, kind, name, z_index, position)
           VALUES (%s, 'video', 'Video 1', 0, 0) RETURNING *''',
        (story_id,), returning=True
    )
    caption_track = execute_write(
        '''INSERT INTO training.content_tracks (story_id, kind, name, z_index, position)
           VALUES (%s, 'caption', 'Captions', 10, 1) RETURNING *''',
        (story_id,), returning=True
    )

    warnings = []
    cursor_sec = 0.0

    for scene in scenes:
        scene = dict(scene)
        duration = float(scene.get('duration_sec') or 5)
        clip_urls = scene.get('clip_urls') or []

        if clip_urls:
            video_url = next((u for u in clip_urls if u.lower().endswith(('.mp4', '.mov', '.webm'))), None)
            image_url = next((u for u in clip_urls if not u.lower().endswith(('.mp4', '.mov', '.webm'))), None)
            chosen_url = video_url or image_url
            source_type = 'video' if video_url else 'image'

            probed = {'duration_sec': None, 'width': None, 'height': None}
            try:
                data = download_file(chosen_url)
                ext = os.path.splitext(chosen_url)[1] or '.bin'
                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                    tmp.write(data)
                    tmp_path = tmp.name
                try:
                    probed = timeline_service.probe_media(tmp_path)
                finally:
                    os.unlink(tmp_path)
            except Exception as e:
                log.warning('Failed to probe legacy clip %s: %s', chosen_url, e)

            # ffprobe's image2 demuxer reports a spurious ~0.04s "duration" for
            # still images (1 frame / default 25fps) — only trust probed duration
            # for actual video sources
            if source_type == 'image':
                trim_end = duration
                stored_source_duration = None
            else:
                trim_end = probed['duration_sec'] if probed['duration_sec'] else duration
                stored_source_duration = probed['duration_sec']

            execute_write(
                '''INSERT INTO training.content_clips
                     (track_id, source_url, source_type, source_duration_sec, source_width, source_height,
                      trim_start_sec, trim_end_sec, timeline_start_sec, timeline_end_sec, position)
                   VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s)''',
                (video_track['id'], chosen_url, source_type, stored_source_duration,
                 probed['width'], probed['height'], trim_end,
                 cursor_sec, cursor_sec + duration, scene['position'])
            )

            if len(clip_urls) > 1:
                warnings.append(f"Scene {scene['position']}: dropped {len(clip_urls) - 1} extra clip(s) (only the first clip per scene is used)")

        overlay_text = (scene.get('overlay_text') or '').strip()
        if overlay_text:
            execute_write(
                '''INSERT INTO training.content_clips
                     (track_id, source_type, text_content, timeline_start_sec, timeline_end_sec, position)
                   VALUES (%s, 'text', %s, %s, %s, %s)''',
                (caption_track['id'], overlay_text, cursor_sec, cursor_sec + duration, scene['position'])
            )

        cursor_sec += duration

    execute_write(
        "UPDATE training.content_stories SET editor_mode = 'tracks', updated_at = now() WHERE id = %s",
        (story_id,)
    )

    return jsonify({'editor_mode': 'tracks', 'warnings': warnings, **timeline_service.get_timeline(story_id)}), 201


# ─── Tracks ──────────────────────────────────────────────────────────────────

@content_tracks_bp.route('/api/content/stories/<story_id>/tracks', methods=['POST'])
@jwt_required()
def add_track(story_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    data = request.get_json() or {}

    kind = data.get('kind')
    if kind not in timeline_service.TRACK_KINDS:
        raise ValidationError(f"kind must be one of {timeline_service.TRACK_KINDS}")

    max_pos = execute_query(
        'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_tracks WHERE story_id = %s',
        (story_id,), fetch_one=True
    )
    position = data.get('position') if data.get('position') is not None else max_pos['mp'] + 1
    z_index = data.get('z_index') if data.get('z_index') is not None else position
    name = data.get('name') or kind.capitalize()

    track = execute_write(
        '''INSERT INTO training.content_tracks (story_id, kind, name, z_index, position)
           VALUES (%s, %s, %s, %s, %s) RETURNING *''',
        (story_id, kind, name, z_index, position),
        returning=True
    )
    return jsonify(dict(track)), 201


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>', methods=['PUT'])
@jwt_required()
def update_track(story_id, track_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)

    data = request.get_json() or {}
    allowed = ('name', 'z_index', 'position', 'muted')
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        raise ValidationError('No updatable fields provided')

    set_clause = ', '.join(f'{k} = %s' for k in updates) + ', updated_at = now()'
    values = list(updates.values()) + [track_id, story_id]
    track = execute_write(
        f'UPDATE training.content_tracks SET {set_clause} WHERE id = %s AND story_id = %s RETURNING *',
        values, returning=True
    )
    return jsonify(dict(track))


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>', methods=['DELETE'])
@jwt_required()
def delete_track(story_id, track_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)

    clips = execute_query(
        'SELECT source_url FROM training.content_clips WHERE track_id = %s', (track_id,)
    )
    for clip in clips:
        if clip['source_url']:
            delete_file(clip['source_url'])

    execute_write('DELETE FROM training.content_tracks WHERE id = %s AND story_id = %s', (track_id, story_id))
    return jsonify({'deleted': True})


# ─── Clips ───────────────────────────────────────────────────────────────────

@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips/upload', methods=['POST'])
@jwt_required()
def upload_track_clip(story_id, track_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    track = timeline_service.get_track(track_id, story_id)

    if track['kind'] not in ('video', 'image', 'audio'):
        raise ValidationError("File uploads are only allowed on video/image/audio tracks. Use the JSON clips endpoint for caption tracks.")

    if 'file' not in request.files:
        raise ValidationError('file field required')
    f = request.files['file']
    content_type = (f.content_type or '').split(';')[0].strip()
    if content_type not in ALLOWED_CONTENT_MIME_TYPES:
        raise ValidationError(f'Unsupported file type: {content_type}')

    source_type = _CONTENT_TYPE_TO_SOURCE_TYPE.get(content_type)
    if source_type != track['kind']:
        raise ValidationError(f"This is a '{track['kind']}' track — cannot upload a {source_type} file to it")

    ext = _EXT_BY_CONTENT_TYPE.get(content_type, '.bin')
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        f.save(tmp)
        tmp_path = tmp.name

    try:
        probed = timeline_service.probe_media(tmp_path)
        # ffprobe's image2 demuxer reports a spurious ~0.04s "duration" (1 frame /
        # default 25fps) for every still image — that's a demuxer artifact, not a
        # real content length, so images always get the fixed default instead of
        # trusting probed duration (unlike video, where it's meaningful).
        if source_type == 'image':
            duration = timeline_service.DEFAULT_IMAGE_DURATION_SEC
        else:
            duration = probed['duration_sec'] or timeline_service.DEFAULT_IMAGE_DURATION_SEC

        r2_filename = f'{uuid.uuid4().hex}{ext}'
        folder = f'content/{user_id}/{story_id}/{track_id}'
        with open(tmp_path, 'rb') as fh:
            url = upload_fileobj_streaming(fh, folder, content_type, filename=r2_filename)

        start = timeline_service.next_clip_start(story_id)
        max_pos = execute_query(
            'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
            (track_id,), fetch_one=True
        )

        # for images, probed['duration_sec'] is the image2 demuxer artifact above —
        # don't persist it as source_duration_sec either, or the UI would show a
        # meaningless "Source: 0.04s" on every image clip
        stored_source_duration = None if source_type == 'image' else probed['duration_sec']

        clip = execute_write(
            '''INSERT INTO training.content_clips
                 (track_id, source_url, source_type, source_duration_sec, source_width, source_height,
                  trim_start_sec, trim_end_sec, timeline_start_sec, timeline_end_sec, position)
               VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s)
               RETURNING *''',
            (track_id, url, source_type, stored_source_duration, probed['width'], probed['height'],
             duration, start, start + duration, max_pos['mp'] + 1),
            returning=True
        )
        return jsonify(dict(clip)), 201
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips', methods=['POST'])
@jwt_required()
def add_text_clip(story_id, track_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    track = timeline_service.get_track(track_id, story_id)

    if track['kind'] != 'caption':
        raise ValidationError("Text clips can only be added to caption tracks")

    data = request.get_json() or {}
    text_content = (data.get('text_content') or '').strip()
    if not text_content:
        raise ValidationError('text_content is required')

    timeline_start = data.get('timeline_start_sec')
    timeline_end = data.get('timeline_end_sec')
    if timeline_start is None or timeline_end is None:
        raise ValidationError('timeline_start_sec and timeline_end_sec are required')
    if float(timeline_end) <= float(timeline_start):
        raise ValidationError('timeline_end_sec must be greater than timeline_start_sec')

    max_pos = execute_query(
        'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
        (track_id,), fetch_one=True
    )

    clip = execute_write(
        '''INSERT INTO training.content_clips
             (track_id, source_type, text_content, style_json, timeline_start_sec, timeline_end_sec, position)
           VALUES (%s, 'text', %s, %s, %s, %s, %s)
           RETURNING *''',
        (track_id, text_content, data.get('style_json') or {}, timeline_start, timeline_end, max_pos['mp'] + 1),
        returning=True
    )
    return jsonify(dict(clip)), 201


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips/<clip_id>', methods=['PUT'])
@jwt_required()
def update_clip(story_id, track_id, clip_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)
    clip = timeline_service.get_clip(clip_id, track_id)

    data = request.get_json() or {}
    allowed = ('trim_start_sec', 'trim_end_sec', 'timeline_start_sec', 'timeline_end_sec',
               'text_content', 'style_json', 'volume', 'speed', 'position', 'track_id')
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        raise ValidationError('No updatable fields provided')

    new_start = updates.get('timeline_start_sec', clip['timeline_start_sec'])
    new_end = updates.get('timeline_end_sec', clip['timeline_end_sec'])
    if float(new_end) <= float(new_start):
        raise ValidationError('timeline_end_sec must be greater than timeline_start_sec')

    dest_track_id = updates.get('track_id')
    if dest_track_id and dest_track_id != track_id:
        dest_track = timeline_service.get_track(dest_track_id, story_id)
        expected_kind = timeline_service.SOURCE_TYPE_TO_TRACK_KIND[clip['source_type']]
        if dest_track['kind'] != expected_kind:
            raise ValidationError(f"Cannot move a '{clip['source_type']}' clip to a '{dest_track['kind']}' track")

    set_clause = ', '.join(f'{k} = %s' for k in updates) + ', updated_at = now()'
    values = list(updates.values()) + [clip_id, track_id]
    updated = execute_write(
        f'UPDATE training.content_clips SET {set_clause} WHERE id = %s AND track_id = %s RETURNING *',
        values, returning=True
    )
    return jsonify(dict(updated))


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips/<clip_id>', methods=['DELETE'])
@jwt_required()
def delete_clip(story_id, track_id, clip_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)
    clip = timeline_service.get_clip(clip_id, track_id)

    if clip['source_url']:
        delete_file(clip['source_url'])

    execute_write('DELETE FROM training.content_clips WHERE id = %s AND track_id = %s', (clip_id, track_id))
    return jsonify({'deleted': True})


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips/<clip_id>/split', methods=['POST'])
@jwt_required()
def split_clip(story_id, track_id, clip_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)
    clip = timeline_service.get_clip(clip_id, track_id)

    data = request.get_json() or {}
    at_sec = data.get('at_sec')
    if at_sec is None:
        raise ValidationError('at_sec is required')
    at_sec = float(at_sec)

    if not (clip['timeline_start_sec'] < at_sec < clip['timeline_end_sec']):
        raise ValidationError('at_sec must fall strictly inside the clip')

    clip_delta = at_sec - clip['timeline_start_sec']
    trim_start = clip.get('trim_start_sec') or 0
    trim_end = clip.get('trim_end_sec')
    split_trim = trim_start + clip_delta if clip['source_type'] != 'text' else None

    execute_write(
        'UPDATE training.content_clips SET timeline_end_sec = %s, trim_end_sec = %s, updated_at = now() WHERE id = %s',
        (at_sec, split_trim, clip_id)
    )

    max_pos = execute_query(
        'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
        (track_id,), fetch_one=True
    )
    new_clip = execute_write(
        '''INSERT INTO training.content_clips
             (track_id, source_url, source_type, source_duration_sec, source_width, source_height,
              trim_start_sec, trim_end_sec, timeline_start_sec, timeline_end_sec,
              text_content, style_json, volume, speed, position)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *''',
        (track_id, clip['source_url'], clip['source_type'], clip['source_duration_sec'],
         clip['source_width'], clip['source_height'],
         split_trim, trim_end, at_sec, clip['timeline_end_sec'],
         clip['text_content'], clip['style_json'], clip['volume'], clip['speed'], max_pos['mp'] + 1),
        returning=True
    )
    return jsonify(dict(new_clip)), 201


@content_tracks_bp.route('/api/content/stories/<story_id>/tracks/<track_id>/clips/<clip_id>/duplicate', methods=['POST'])
@jwt_required()
def duplicate_clip(story_id, track_id, clip_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)
    timeline_service.get_track(track_id, story_id)
    clip = timeline_service.get_clip(clip_id, track_id)

    start = timeline_service.next_clip_start(story_id)
    duration = clip['timeline_end_sec'] - clip['timeline_start_sec']

    max_pos = execute_query(
        'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
        (track_id,), fetch_one=True
    )
    new_clip = execute_write(
        '''INSERT INTO training.content_clips
             (track_id, source_url, source_type, source_duration_sec, source_width, source_height,
              trim_start_sec, trim_end_sec, timeline_start_sec, timeline_end_sec,
              text_content, style_json, volume, speed, position)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *''',
        (track_id, clip['source_url'], clip['source_type'], clip['source_duration_sec'],
         clip['source_width'], clip['source_height'],
         clip['trim_start_sec'], clip['trim_end_sec'], start, start + duration,
         clip['text_content'], clip['style_json'], clip['volume'], clip['speed'], max_pos['mp'] + 1),
        returning=True
    )
    return jsonify(dict(new_clip)), 201


# ─── Transcription ───────────────────────────────────────────────────────────

@content_tracks_bp.route('/api/content/stories/<story_id>/transcribe', methods=['POST'])
@jwt_required()
def start_transcribe(story_id):
    from app.services.transcription_service import start_transcription_job, is_available

    user_id, role = _require_user()
    _get_story(story_id, user_id, role)

    data = request.get_json() or {}
    clip_id = data.get('clip_id')
    if not clip_id:
        raise ValidationError('clip_id is required')

    clip = execute_query(
        '''SELECT c.* FROM training.content_clips c
           JOIN training.content_tracks t ON t.id = c.track_id
           WHERE c.id = %s AND t.story_id = %s''',
        (clip_id, story_id), fetch_one=True
    )
    if not clip:
        raise NotFoundError('Clip not found')
    if clip['source_type'] not in ('video', 'audio'):
        raise ValidationError('Only video or audio clips can be transcribed')

    if not is_available():
        raise ValidationError('Transcription is not configured on this server (faster-whisper not installed)')

    job = execute_write(
        '''INSERT INTO training.content_transcript_jobs (story_id, source_clip_id, status)
           VALUES (%s, %s, 'pending') RETURNING *''',
        (story_id, clip_id), returning=True
    )
    start_transcription_job(str(job['id']), user_id)
    return jsonify(dict(job)), 202


@content_tracks_bp.route('/api/content/stories/<story_id>/transcribe/<job_id>', methods=['GET'])
@jwt_required()
def get_transcribe_job(story_id, job_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)

    job = execute_query(
        'SELECT * FROM training.content_transcript_jobs WHERE id = %s AND story_id = %s',
        (job_id, story_id), fetch_one=True
    )
    if not job:
        raise NotFoundError('Job not found')
    return jsonify(dict(job))
