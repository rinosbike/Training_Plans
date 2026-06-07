import json
import os
import tempfile
import uuid
import logging
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError
from app.services import storage_service
from app.services.media_sync_service import extract_video_metadata, compute_sync
from app.services.credential_service import get_credential
from app.services.sync import strava as strava_svc

log = logging.getLogger(__name__)
media_bp = Blueprint('media', __name__)

ALLOWED_CONTENT_TYPES = {'video/mp4', 'video/quicktime', 'video/webm'}


@media_bp.route('/api/workouts/<workout_id>/media', methods=['GET'])
@jwt_required()
def list_media(workout_id):
    user_id = get_jwt_identity()
    _require_workout(workout_id, user_id)
    rows = execute_query(
        '''SELECT id, r2_url, original_filename, media_type,
                  duration_sec, recorded_at, km_start, km_end,
                  strava_time_start, strava_time_end, offset_sec, created_at
           FROM training.workout_media
           WHERE workout_id = %s AND user_id = %s
           ORDER BY km_start ASC NULLS LAST, created_at ASC''',
        (workout_id, user_id)
    )
    return jsonify([dict(r) for r in rows])


@media_bp.route('/api/workouts/<workout_id>/media/<media_id>/metrics', methods=['GET'])
@jwt_required()
def get_metrics(workout_id, media_id):
    user_id = get_jwt_identity()
    row = execute_query(
        '''SELECT metrics_json FROM training.workout_media
           WHERE id = %s AND workout_id = %s AND user_id = %s''',
        (media_id, workout_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Media not found')
    return jsonify(row['metrics_json'] or [])


@media_bp.route('/api/workouts/<workout_id>/media', methods=['POST'])
@jwt_required()
def upload_media(workout_id):
    user_id = get_jwt_identity()
    _require_workout(workout_id, user_id)

    if 'file' not in request.files:
        raise ValidationError('file is required')

    f = request.files['file']
    content_type = (f.content_type or '').split(';')[0].strip() or 'video/mp4'
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(f'Unsupported type: {content_type}. Upload an MP4, MOV or WebM file.')

    ext = {'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm'}.get(content_type, '.mp4')

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        f.save(tmp)
        tmp_path = tmp.name

    try:
        meta = extract_video_metadata(tmp_path)

        r2_filename = f'{uuid.uuid4().hex}{ext}'
        folder = f'workout-media/{user_id}/{workout_id}'
        with open(tmp_path, 'rb') as fh:
            r2_url = storage_service.upload_fileobj_streaming(
                fh, folder, content_type, filename=r2_filename
            )

        sync_result = _try_strava_sync(workout_id, user_id, meta)

        row = execute_write(
            '''INSERT INTO training.workout_media
               (user_id, workout_id, r2_url, original_filename, media_type,
                duration_sec, recorded_at, offset_sec,
                km_start, km_end, strava_time_start, strava_time_end, metrics_json)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               RETURNING id, r2_url, original_filename, media_type,
                         duration_sec, recorded_at, km_start, km_end,
                         strava_time_start, strava_time_end, offset_sec, created_at''',
            [user_id, workout_id, r2_url, f.filename, 'video',
             meta['duration_sec'], meta['video_start'],
             sync_result.get('offset_sec'),
             sync_result.get('km_start'), sync_result.get('km_end'),
             sync_result.get('strava_time_start'), sync_result.get('strava_time_end'),
             json.dumps(sync_result['metrics']) if sync_result.get('metrics') else None],
            returning=True
        )
        return jsonify(dict(row)), 201

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@media_bp.route('/api/workouts/<workout_id>/media/<media_id>', methods=['DELETE'])
@jwt_required()
def delete_media(workout_id, media_id):
    user_id = get_jwt_identity()
    row = execute_query(
        '''SELECT r2_url FROM training.workout_media
           WHERE id = %s AND workout_id = %s AND user_id = %s''',
        (media_id, workout_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Media not found')
    storage_service.delete_file(row['r2_url'])
    execute_write('DELETE FROM training.workout_media WHERE id = %s', (media_id,))
    return jsonify({'ok': True})


@media_bp.route('/api/workouts/<workout_id>/media/<media_id>/resync', methods=['POST'])
@jwt_required()
def resync_media(workout_id, media_id):
    """Re-run Strava sync with an optional manual clock offset adjustment."""
    user_id = get_jwt_identity()
    row = execute_query(
        'SELECT * FROM training.workout_media WHERE id = %s AND workout_id = %s AND user_id = %s',
        (media_id, workout_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Media not found')
    if not row['recorded_at']:
        raise ValidationError('No recorded_at on this clip — cannot resync')

    body = request.get_json(silent=True) or {}
    offset_adjust = float(body.get('offset_adjust_sec', 0))

    adjusted_start = row['recorded_at'] + timedelta(seconds=offset_adjust)
    meta = {'video_start': adjusted_start, 'duration_sec': row['duration_sec']}

    sync_result = _try_strava_sync(workout_id, user_id, meta)
    if not sync_result:
        raise ValidationError('Strava sync failed — check that this workout has a linked Strava activity')

    execute_write(
        '''UPDATE training.workout_media
           SET offset_sec=%s, km_start=%s, km_end=%s,
               strava_time_start=%s, strava_time_end=%s, metrics_json=%s
           WHERE id=%s''',
        [sync_result.get('offset_sec'), sync_result.get('km_start'), sync_result.get('km_end'),
         sync_result.get('strava_time_start'), sync_result.get('strava_time_end'),
         json.dumps(sync_result['metrics']) if sync_result.get('metrics') else None,
         media_id]
    )
    updated = execute_query(
        '''SELECT id, r2_url, km_start, km_end, offset_sec,
                  strava_time_start, strava_time_end
           FROM training.workout_media WHERE id = %s''',
        (media_id,), fetch_one=True
    )
    return jsonify(dict(updated))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_workout(workout_id, user_id):
    row = execute_query(
        'SELECT id FROM training.workouts WHERE id = %s AND user_id = %s',
        (workout_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Workout not found')


def _try_strava_sync(workout_id, user_id, meta: dict) -> dict:
    """Attempt Strava sync. Returns sync result dict or {} on failure."""
    try:
        log_row = execute_query(
            "SELECT external_id FROM training.workout_logs "
            "WHERE workout_id = %s AND user_id = %s AND source = 'strava'",
            (workout_id, user_id), fetch_one=True
        )
        if not log_row or not log_row['external_id']:
            return {}

        activity_id = log_row['external_id']
        token_row = execute_query(
            "SELECT * FROM training.sync_tokens WHERE user_id = %s AND provider = 'strava'",
            (user_id,), fetch_one=True
        )
        if not token_row:
            return {}

        client_id     = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
        client_secret = get_credential('strava', 'client_secret') or current_app.config.get('STRAVA_CLIENT_SECRET', '')
        access_token, _ = strava_svc.get_valid_token(dict(token_row), client_id, client_secret)

        detail = strava_svc.fetch_activity_detail(access_token, activity_id)
        strava_start = datetime.fromisoformat(detail['start_date'].replace('Z', '+00:00'))

        streams_raw = strava_svc.fetch_activity_streams(access_token, activity_id)
        return compute_sync(meta['video_start'], meta['duration_sec'], strava_start, streams_raw)

    except Exception as e:
        log.warning('Strava sync skipped for media upload: %s', e)
        return {}
