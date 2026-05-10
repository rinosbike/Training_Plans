"""
Admin API — user list, role management, and maintenance tasks.
- GET  /api/admin/users                      → admin + super_admin
- PUT  /api/admin/users/<id>/role            → super_admin only
- POST /api/admin/translate-descriptions     → super_admin only
"""
import json
from flask import Blueprint, request, jsonify, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write, get_db
from app.exceptions import NotFoundError, ValidationError

admin_bp = Blueprint('admin', __name__)

VALID_ROLES = ('user', 'admin', 'super_admin')


def _get_role(user_id: str) -> str:
    row = execute_query(
        "SELECT role FROM training.users WHERE id = %s", (user_id,), fetch_one=True
    )
    return (row['role'] if row else 'user') or 'user'


@admin_bp.route('/api/admin/users', methods=['GET'])
@jwt_required()
def list_users():
    caller_role = _get_role(get_jwt_identity())
    if caller_role not in ('admin', 'super_admin'):
        abort(403)

    rows = execute_query(
        '''SELECT id, email, name, avatar_url, role, created_at,
                  (SELECT MAX(created_at) FROM training.ai_messages WHERE user_id = users.id) AS last_active
           FROM training.users
           ORDER BY created_at''',
        ()
    )
    return jsonify([dict(r) for r in rows])


@admin_bp.route('/api/admin/users/<target_id>/role', methods=['PUT'])
@jwt_required()
def set_user_role(target_id):
    caller_id = get_jwt_identity()
    caller_role = _get_role(caller_id)

    if caller_role != 'super_admin':
        abort(403)

    data = request.get_json() or {}
    new_role = data.get('role', '').strip()
    if new_role not in VALID_ROLES:
        raise ValidationError(f'role must be one of: {", ".join(VALID_ROLES)}')

    # super_admin cannot be set via API — must be done via direct DB
    if new_role == 'super_admin':
        raise ValidationError('super_admin role cannot be assigned via API')

    target = execute_query(
        'SELECT id, email, role FROM training.users WHERE id = %s', (target_id,), fetch_one=True
    )
    if not target:
        raise NotFoundError('User not found')

    # Cannot demote another super_admin
    if target['role'] == 'super_admin':
        raise ValidationError('Cannot change the role of a super_admin')

    # Cannot change own role
    if str(target['id']) == str(caller_id):
        raise ValidationError('Cannot change your own role')

    execute_write(
        'UPDATE training.users SET role = %s WHERE id = %s', (new_role, target_id)
    )
    return jsonify({'id': target_id, 'role': new_role})


@admin_bp.route('/api/admin/translate-descriptions', methods=['POST'])
@jwt_required()
def translate_descriptions():
    """Translate all workout descriptions to DE/ZH/PL/ES using Copilot API."""
    caller_role = _get_role(get_jwt_identity())
    if caller_role != 'super_admin':
        abort(403)

    from app.services.ai_coach_service import chat_complete

    LANGS = ['de', 'zh', 'pl', 'es']
    BATCH = 8  # descriptions per API call

    rows = execute_query(
        """SELECT id, description FROM training.workouts
           WHERE description IS NOT NULL AND description != ''
             AND (description_translations IS NULL OR description_translations = '{}'::jsonb)
           ORDER BY id""",
        ()
    )
    if not rows:
        return jsonify({'translated': 0, 'message': 'Nothing to translate'})

    total = 0
    errors = []
    batch = list(rows)

    for i in range(0, len(batch), BATCH):
        chunk = batch[i:i + BATCH]
        desc_map = {str(j): row['description'] for j, row in enumerate(chunk)}

        prompt = (
            'You are a sports training translator. Translate each numbered description to '
            'German (de), Chinese Simplified (zh), Polish (pl), and Spanish (es). '
            'Preserve all numbers, pace values (e.g. 5:30/km), watt values, distances, '
            'and technical terms exactly. Return ONLY valid JSON, no explanation.\n\n'
            'Format: {"0": {"de": "...", "zh": "...", "pl": "...", "es": "..."}, "1": {...}}\n\n'
            'Descriptions:\n' +
            '\n'.join(f'{j}: {json.dumps(d)}' for j, d in desc_map.items())
        )

        try:
            content, _ = chat_complete(
                [{'role': 'user', 'content': prompt}],
                max_tokens=4000
            )
            # Strip markdown code fences if present
            content = content.strip()
            if content.startswith('```'):
                content = content.split('\n', 1)[1].rsplit('```', 1)[0]
            translations = json.loads(content)
        except Exception as e:
            errors.append(f'Batch {i//BATCH}: {str(e)[:100]}')
            continue

        db = get_db()
        for j, row in enumerate(chunk):
            t = translations.get(str(j), {})
            if not t:
                continue
            # Merge with any existing translations
            full = {'de': t.get('de', ''), 'zh': t.get('zh', ''),
                    'pl': t.get('pl', ''), 'es': t.get('es', '')}
            try:
                with db.cursor() as cur:
                    cur.execute(
                        'UPDATE training.workouts SET description_translations = %s WHERE id = %s',
                        (json.dumps(full), str(row['id']))
                    )
                db.commit()
                total += 1
            except Exception as e:
                errors.append(f'Row {row["id"]}: {str(e)[:100]}')

    return jsonify({'translated': total, 'errors': errors})
