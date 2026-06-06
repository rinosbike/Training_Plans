"""
Content API — Instagram Reel story builder (admin/super_admin only).

Stories contain ordered scenes; each scene holds clips uploaded to R2.

- GET    /api/content/stories                          list stories
- POST   /api/content/stories                          create story
- GET    /api/content/stories/<sid>                    story + scenes
- PUT    /api/content/stories/<sid>                    update story
- DELETE /api/content/stories/<sid>                    delete story + R2 clips
- POST   /api/content/stories/<sid>/scenes             add scene
- PUT    /api/content/stories/<sid>/scenes/<scid>      update scene
- DELETE /api/content/stories/<sid>/scenes/<scid>      delete scene + R2 clips
- POST   /api/content/stories/<sid>/scenes/<scid>/clips  upload clip → R2
- DELETE /api/content/stories/<sid>/scenes/<scid>/clips  remove one clip URL
- POST   /api/content/stories/<sid>/generate           AI reel script generation
- GET    /api/content/stories/<sid>/export             compose + download 9:16 MP4 Reel
"""
import io
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from flask import Blueprint, request, jsonify, abort, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError
from app.services.storage_service import (
    upload_file, download_file, delete_file, ALLOWED_CONTENT_MIME_TYPES
)

content_bp = Blueprint('content', __name__)

MAX_CLIP_BYTES = 150 * 1024 * 1024  # 150 MB


def _require_admin():
    user_id = get_jwt_identity()
    row = execute_query(
        'SELECT role FROM training.users WHERE id = %s', (user_id,), fetch_one=True
    )
    role = (row['role'] if row else 'user') or 'user'
    if role not in ('admin', 'super_admin'):
        abort(403)
    return user_id


def _get_story(story_id: str):
    story = execute_query(
        'SELECT * FROM training.content_stories WHERE id = %s', (story_id,), fetch_one=True
    )
    if not story:
        raise NotFoundError('Story not found')
    return story


def _get_scene(scene_id: str, story_id: str):
    scene = execute_query(
        'SELECT * FROM training.content_scenes WHERE id = %s AND story_id = %s',
        (scene_id, story_id), fetch_one=True
    )
    if not scene:
        raise NotFoundError('Scene not found')
    return scene


def _delete_scene_clips(scene):
    for url in (scene.get('clip_urls') or []):
        delete_file(url)


# ─── Stories ─────────────────────────────────────────────────────────────────

@content_bp.route('/api/content/stories', methods=['GET'])
@jwt_required()
def list_stories():
    _require_admin()
    rows = execute_query(
        '''SELECT s.id, s.title, s.theme, s.goal, s.status, s.created_at, s.updated_at,
                  COUNT(sc.id) AS scene_count
           FROM training.content_stories s
           LEFT JOIN training.content_scenes sc ON sc.story_id = s.id
           GROUP BY s.id
           ORDER BY s.created_at DESC''',
        ()
    )
    return jsonify([dict(r) for r in rows])


@content_bp.route('/api/content/stories', methods=['POST'])
@jwt_required()
def create_story():
    user_id = _require_admin()
    data = request.get_json() or {}
    title = (data.get('title') or '').strip()
    if not title:
        raise ValidationError('title is required')

    story = execute_write(
        '''INSERT INTO training.content_stories (user_id, title, theme, goal)
           VALUES (%s, %s, %s, %s)
           RETURNING *''',
        (user_id, title, data.get('theme'), data.get('goal')),
        returning=True
    )
    return jsonify(dict(story)), 201


@content_bp.route('/api/content/stories/<story_id>', methods=['GET'])
@jwt_required()
def get_story(story_id):
    _require_admin()
    story = _get_story(story_id)
    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s ORDER BY position',
        (story_id,)
    )
    result = dict(story)
    result['scenes'] = [dict(s) for s in scenes]
    return jsonify(result)


@content_bp.route('/api/content/stories/<story_id>', methods=['PUT'])
@jwt_required()
def update_story(story_id):
    _require_admin()
    _get_story(story_id)
    data = request.get_json() or {}
    allowed = ('title', 'theme', 'goal', 'status')
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        raise ValidationError('No updatable fields provided')

    set_clause = ', '.join(f'{k} = %s' for k in updates)
    set_clause += ', updated_at = now()'
    values = list(updates.values()) + [story_id]
    story = execute_write(
        f'UPDATE training.content_stories SET {set_clause} WHERE id = %s RETURNING *',
        values, returning=True
    )
    return jsonify(dict(story))


@content_bp.route('/api/content/stories/<story_id>', methods=['DELETE'])
@jwt_required()
def delete_story(story_id):
    _require_admin()
    _get_story(story_id)
    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s', (story_id,)
    )
    for scene in scenes:
        _delete_scene_clips(dict(scene))
    execute_write('DELETE FROM training.content_stories WHERE id = %s', (story_id,))
    return jsonify({'deleted': True})


# ─── Scenes ──────────────────────────────────────────────────────────────────

@content_bp.route('/api/content/stories/<story_id>/scenes', methods=['POST'])
@jwt_required()
def add_scene(story_id):
    _require_admin()
    _get_story(story_id)
    data = request.get_json() or {}

    max_pos = execute_query(
        'SELECT COALESCE(MAX(position), 0) AS mp FROM training.content_scenes WHERE story_id = %s',
        (story_id,), fetch_one=True
    )
    position = data.get('position') or (max_pos['mp'] + 1)

    scene = execute_write(
        '''INSERT INTO training.content_scenes
             (story_id, position, description, overlay_text, duration_sec)
           VALUES (%s, %s, %s, %s, %s)
           RETURNING *''',
        (story_id, position, data.get('description'), data.get('overlay_text'),
         data.get('duration_sec')),
        returning=True
    )
    return jsonify(dict(scene)), 201


@content_bp.route('/api/content/stories/<story_id>/scenes/<scene_id>', methods=['PUT'])
@jwt_required()
def update_scene(story_id, scene_id):
    _require_admin()
    _get_scene(scene_id, story_id)
    data = request.get_json() or {}
    allowed = ('description', 'overlay_text', 'duration_sec', 'position')
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        raise ValidationError('No updatable fields provided')

    set_clause = ', '.join(f'{k} = %s' for k in updates)
    values = list(updates.values()) + [scene_id, story_id]
    scene = execute_write(
        f'UPDATE training.content_scenes SET {set_clause} WHERE id = %s AND story_id = %s RETURNING *',
        values, returning=True
    )
    return jsonify(dict(scene))


@content_bp.route('/api/content/stories/<story_id>/scenes/<scene_id>', methods=['DELETE'])
@jwt_required()
def delete_scene(story_id, scene_id):
    _require_admin()
    scene = _get_scene(scene_id, story_id)
    _delete_scene_clips(dict(scene))
    execute_write(
        'DELETE FROM training.content_scenes WHERE id = %s AND story_id = %s',
        (scene_id, story_id)
    )
    return jsonify({'deleted': True})


# ─── Clips ───────────────────────────────────────────────────────────────────

@content_bp.route('/api/content/stories/<story_id>/scenes/<scene_id>/clips', methods=['POST'])
@jwt_required()
def upload_clip(story_id, scene_id):
    _require_admin()
    _get_story(story_id)
    scene = _get_scene(scene_id, story_id)

    if 'file' not in request.files:
        raise ValidationError('file field required')
    f = request.files['file']
    content_type = f.content_type or 'application/octet-stream'

    if content_type not in ALLOWED_CONTENT_MIME_TYPES:
        raise ValidationError(f'Unsupported file type: {content_type}. Allowed: image/jpeg, image/png, video/mp4, video/quicktime, video/webm')

    data = f.read()
    if len(data) > MAX_CLIP_BYTES:
        raise ValidationError('File exceeds 150 MB limit')

    folder = f'content/{story_id}/{scene_id}'
    url = upload_file(data, folder, content_type)

    current_urls = list(scene.get('clip_urls') or [])
    current_urls.append(url)
    updated = execute_write(
        'UPDATE training.content_scenes SET clip_urls = %s WHERE id = %s AND story_id = %s RETURNING *',
        (json.dumps(current_urls), scene_id, story_id),
        returning=True
    )
    return jsonify(dict(updated)), 201


@content_bp.route('/api/content/stories/<story_id>/scenes/<scene_id>/clips', methods=['DELETE'])
@jwt_required()
def remove_clip(story_id, scene_id):
    _require_admin()
    scene = _get_scene(scene_id, story_id)
    data = request.get_json() or {}
    url = (data.get('url') or '').strip()
    if not url:
        raise ValidationError('url is required')

    current_urls = list(scene.get('clip_urls') or [])
    if url not in current_urls:
        raise ValidationError('URL not found in this scene')

    delete_file(url)
    current_urls.remove(url)
    updated = execute_write(
        'UPDATE training.content_scenes SET clip_urls = %s WHERE id = %s AND story_id = %s RETURNING *',
        (json.dumps(current_urls), scene_id, story_id),
        returning=True
    )
    return jsonify(dict(updated))


# ─── AI Generation ───────────────────────────────────────────────────────────

@content_bp.route('/api/content/stories/<story_id>/generate', methods=['POST'])
@jwt_required()
def generate_script(story_id):
    _require_admin()
    story = _get_story(story_id)
    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s ORDER BY position',
        (story_id,)
    )

    if not scenes:
        raise ValidationError('Add at least one scene before generating a script')

    scene_lines = []
    for i, s in enumerate(scenes, 1):
        parts = [f'Scene {i} ({s["duration_sec"] or "?"}s)']
        if s.get('description'):
            parts.append(f'Director note: {s["description"]}')
        if s.get('overlay_text'):
            parts.append(f'On-screen text: "{s["overlay_text"]}"')
        clip_count = len(s.get('clip_urls') or [])
        if clip_count:
            parts.append(f'{clip_count} clip(s) attached')
        scene_lines.append(' | '.join(parts))

    prompt = f"""You are a social media manager specialising in endurance sports and triathlon content. Generate a polished, passion-driven Instagram Reel script based on the story below. The creator is an athlete who also built the training app they use — both builder and athlete.

Story title: {story['title']}
Theme: {story.get('theme') or 'Not specified'}
Goal: {story.get('goal') or 'Not specified'}

Scenes:
{chr(10).join(scene_lines)}

Produce:
1. A shot-by-shot script with exact timing for each scene
2. On-screen text overlays (bold, punchy — 5 words max per card)
3. Audio/music suggestion (mood + example artist)
4. Caption (3–5 sentences, personal and motivational)
5. 10–12 hashtags mixing triathlon, endurance sport, fitness data, and AI training

Format clearly with numbered scenes. Tone: raw, passionate, data-meets-grit. Audience: serious triathletes and endurance athletes."""

    from app.services.ai_coach_service import chat_complete
    content, _ = chat_complete([{'role': 'user', 'content': prompt}], max_tokens=2000)

    execute_write(
        'UPDATE training.content_stories SET generated_script = %s, updated_at = now() WHERE id = %s',
        (content, story_id)
    )
    return jsonify({'script': content})


# ─── Export ──────────────────────────────────────────────────────────────────

_FONT_PATH   = '/usr/share/fonts/truetype/lato/Lato-Black.ttf'
_REEL_W, _REEL_H = 1080, 1920
_FPS  = 30
_CRF  = 22   # quality: lower = larger file, better quality
_PRESET = 'fast'


def _ffmpeg_segment(clip_path, text_file, duration, out_path, is_video):
    """Encode one scene segment to a 9:16 MP4 with text overlay."""
    scale_crop = (
        f'scale={_REEL_W}:{_REEL_H}:force_original_aspect_ratio=increase,'
        f'crop={_REEL_W}:{_REEL_H}'
    )
    drawtext = (
        f'drawtext=fontfile={_FONT_PATH}'
        f':textfile={text_file}'
        f':fontsize=78:fontcolor=white'
        f':x=(w-text_w)/2:y=h*0.77'
        f':shadowx=5:shadowy=5:shadowcolor=black@0.85'
    )
    vf = f'{scale_crop},{drawtext}' if os.path.getsize(text_file) > 0 else scale_crop

    if is_video:
        cmd = [
            'ffmpeg', '-y',
            '-i', clip_path,
            '-t', str(duration),
            '-vf', vf,
            '-c:v', 'libx264', '-preset', _PRESET, '-crf', str(_CRF),
            '-pix_fmt', 'yuv420p', '-r', str(_FPS),
            '-an', out_path,
        ]
    else:
        cmd = [
            'ffmpeg', '-y',
            '-loop', '1', '-i', clip_path,
            '-t', str(duration),
            '-vf', vf,
            '-c:v', 'libx264', '-preset', _PRESET, '-crf', str(_CRF),
            '-pix_fmt', 'yuv420p', '-r', str(_FPS),
            out_path,
        ]
    result = subprocess.run(cmd, capture_output=True, timeout=180)
    return result.returncode == 0, result.stderr.decode('utf-8', errors='replace')


@content_bp.route('/api/content/stories/<story_id>/export', methods=['GET'])
@jwt_required()
def export_story(story_id):
    """Compose all scenes into a single 9:16 MP4 ready for Instagram Reels."""
    _require_admin()
    story = _get_story(story_id)
    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s ORDER BY position',
        (story_id,)
    )

    tmpdir = tempfile.mkdtemp(prefix='reel_export_')
    try:
        segment_paths = []

        for i, scene in enumerate(scenes):
            clips = scene.get('clip_urls') or []
            if not clips:
                continue

            duration = scene.get('duration_sec') or 5
            overlay  = (scene.get('overlay_text') or '').strip()

            # Write overlay text to file (avoids all ffmpeg escaping issues)
            text_file = os.path.join(tmpdir, f'text_{i}.txt')
            with open(text_file, 'w', encoding='utf-8') as tf:
                tf.write(overlay)

            # Use first video clip if present, otherwise first image
            video_clip = next((u for u in clips if u.lower().endswith(('.mp4', '.mov', '.webm'))), None)
            image_clip = next((u for u in clips if not u.lower().endswith(('.mp4', '.mov', '.webm'))), None)
            chosen_url = video_clip or image_clip
            is_video   = video_clip is not None

            ext = chosen_url.split('.')[-1].lower()
            clip_path = os.path.join(tmpdir, f'clip_{i}.{ext}')
            clip_data = download_file(chosen_url)
            with open(clip_path, 'wb') as f:
                f.write(clip_data)

            seg_path = os.path.join(tmpdir, f'seg_{i:03d}.mp4')
            ok, err = _ffmpeg_segment(clip_path, text_file, duration, seg_path, is_video)
            if not ok:
                import logging
                logging.getLogger(__name__).error('ffmpeg segment %d failed: %s', i, err[-500:])
                continue
            segment_paths.append(seg_path)

        if not segment_paths:
            return jsonify({'error': 'No clips to export — add clips to your scenes first'}), 400

        # Concat all segments
        concat_list = os.path.join(tmpdir, 'concat.txt')
        with open(concat_list, 'w') as f:
            for p in segment_paths:
                f.write(f"file '{p}'\n")

        final_path = os.path.join(tmpdir, 'reel.mp4')
        concat_cmd = [
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', concat_list,
            '-c', 'copy',
            final_path,
        ]
        result = subprocess.run(concat_cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            return jsonify({'error': 'Video assembly failed', 'detail': result.stderr.decode()[-300:]}), 500

        with open(final_path, 'rb') as f:
            video_data = f.read()

        safe_title = ''.join(c if c.isalnum() or c in '-_ ' else '_' for c in story['title'])
        return Response(
            video_data,
            mimetype='video/mp4',
            headers={
                'Content-Disposition': f'attachment; filename="{safe_title}.mp4"',
                'Content-Length': str(len(video_data)),
            }
        )

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
