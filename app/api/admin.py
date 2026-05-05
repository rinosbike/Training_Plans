"""
Admin API — user list and role management.
- GET  /api/admin/users           → admin + super_admin
- PUT  /api/admin/users/<id>/role → super_admin only
"""
from flask import Blueprint, request, jsonify, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
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
