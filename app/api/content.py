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
- GET    /api/content/stories/<sid>/export             download ZIP
"""
import io
import json
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

@content_bp.route('/api/content/stories/<story_id>/export', methods=['GET'])
@jwt_required()
def export_story(story_id):
    _require_admin()
    story = _get_story(story_id)
    scenes = execute_query(
        'SELECT * FROM training.content_scenes WHERE story_id = %s ORDER BY position',
        (story_id,)
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        # script.md
        script_lines = [
            f'# {story["title"]}',
            f'',
            f'**Theme:** {story.get("theme") or "—"}',
            f'**Goal:** {story.get("goal") or "—"}',
            f'',
            f'---',
            f'',
        ]
        for s in scenes:
            script_lines.append(f'## Scene {s["position"]} — {s.get("overlay_text") or "(no overlay)"}')
            if s.get('description'):
                script_lines.append(f'_{s["description"]}_')
            if s.get('duration_sec'):
                script_lines.append(f'Duration: {s["duration_sec"]}s')
            script_lines.append('')

        script_lines += ['---', '', '## Generated Reel Script', '']
        script_lines.append(story.get('generated_script') or '_No script generated yet. Use the Generate Script button in the app._')

        zf.writestr('script.md', '\n'.join(script_lines))

        # Clips
        for s in scenes:
            for url in (s.get('clip_urls') or []):
                try:
                    file_data = download_file(url)
                    filename = url.split('/')[-1]
                    zf.writestr(f'scenes/{s["position"]}/{filename}', file_data)
                except Exception as e:
                    zf.writestr(f'scenes/{s["position"]}/ERROR_{url.split("/")[-1]}.txt', str(e))

    buf.seek(0)
    safe_title = ''.join(c if c.isalnum() or c in '-_ ' else '_' for c in story['title'])
    return Response(
        buf.read(),
        mimetype='application/zip',
        headers={'Content-Disposition': f'attachment; filename="{safe_title}.zip"'}
    )
