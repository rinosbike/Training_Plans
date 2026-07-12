"""
Content Voiceover API — AI narration generation for the timeline editor's
audio tracks, via a self-hosted cloned voice (see voiceover_service.py).

- POST /api/content/stories/<sid>/voiceover              generate narration on a target audio track (background job)
- GET  /api/content/stories/<sid>/voiceover/<job_id>      poll job status
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError
from app.services import timeline_service
from app.api.content import _require_user, _get_story

content_voiceover_bp = Blueprint('content_voiceover', __name__)


@content_voiceover_bp.route('/api/content/stories/<story_id>/voiceover', methods=['POST'])
@jwt_required()
def start_voiceover(story_id):
    from app.services.voiceover_service import start_voiceover_job, is_available

    user_id, role = _require_user()
    _get_story(story_id, user_id, role)

    data = request.get_json() or {}
    track_id = data.get('track_id')
    text_content = (data.get('text_content') or '').strip()
    if not track_id:
        raise ValidationError('track_id is required')
    if not text_content:
        raise ValidationError('text_content is required')

    track = timeline_service.get_track(track_id, story_id)
    if track['kind'] != 'audio':
        raise ValidationError("Voiceover can only be generated onto an 'audio' track")

    if not is_available():
        raise ValidationError('Voiceover generation is not configured on this server')

    job = execute_write(
        '''INSERT INTO training.content_voiceover_jobs (story_id, target_track_id, status, text_content)
           VALUES (%s, %s, 'pending', %s) RETURNING *''',
        (story_id, track_id, text_content), returning=True
    )
    start_voiceover_job(str(job['id']), user_id)
    return jsonify(dict(job)), 202


@content_voiceover_bp.route('/api/content/stories/<story_id>/voiceover/<job_id>', methods=['GET'])
@jwt_required()
def get_voiceover_job(story_id, job_id):
    user_id, role = _require_user()
    _get_story(story_id, user_id, role)

    job = execute_query(
        'SELECT * FROM training.content_voiceover_jobs WHERE id = %s AND story_id = %s',
        (job_id, story_id), fetch_one=True
    )
    if not job:
        raise NotFoundError('Job not found')
    return jsonify(dict(job))
