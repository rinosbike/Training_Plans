"""
Credentials API — manage training.api_credentials (Strava, Suunto, etc.)
Admin-level: admin users can manage app credentials and upload platform icons.
"""
import base64
import logging
from flask import Blueprint, request, jsonify
from flask import abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query
from app.services.credential_service import get_credential, set_credential, list_credentials, delete_credential

credentials_bp = Blueprint('credentials', __name__)
log = logging.getLogger(__name__)

PLATFORMS = {
    'strava': {
        'label': 'Strava',
        'keys': [
            {'name': 'client_id',            'label': 'Client ID',            'is_secret': False},
            {'name': 'client_secret',         'label': 'Client Secret',         'is_secret': True},
            {'name': 'webhook_verify_token',  'label': 'Webhook Verify Token',  'is_secret': True},
        ],
        'docs': 'https://www.strava.com/settings/api',
    },
    'suunto': {
        'label': 'Suunto Direct API',
        'keys': [
            {'name': 'client_id',       'label': 'Client ID',         'is_secret': False},
            {'name': 'client_secret',   'label': 'Client Secret',     'is_secret': True},
            {'name': 'subscription_key','label': 'Subscription Key',  'is_secret': True},
            {'name': 'webhook_secret',  'label': 'Webhook Secret',    'is_secret': True},
        ],
        'docs': 'https://apizone.suunto.com',
    },
}


@credentials_bp.route('/api/credentials/platforms')
@jwt_required()
def get_platforms():
    """Return platform definitions + current saved key names (admin/super_admin only)."""
    if not _is_admin(get_jwt_identity()):
        abort(403)
    result = []
    for platform_id, meta in PLATFORMS.items():
        saved = list_credentials(platform_id)
        saved_map = {r['key_name']: r for r in saved}
        keys = []
        for k in meta['keys']:
            row = saved_map.get(k['name'])
            entry = {
                **k,
                'saved': row is not None,
                'updated_at': row['updated_at'] if row else None,
                'value': None,
            }
            if row and not k['is_secret']:
                entry['value'] = get_credential(platform_id, k['name'])
            keys.append(entry)
        result.append({
            'platform': platform_id,
            'label': meta['label'],
            'docs': meta['docs'],
            'keys': keys,
        })
    return jsonify(result)


@credentials_bp.route('/api/credentials/<platform>', methods=['GET'])
@jwt_required()
def get_platform_creds(platform):
    if not _is_admin(get_jwt_identity()):
        abort(403)
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    rows = list_credentials(platform)
    # Mask secret values
    for r in rows:
        if r.get('is_secret'):
            r['key_value'] = '••••••••'
    return jsonify(rows)


@credentials_bp.route('/api/credentials/<platform>', methods=['PUT'])
@jwt_required()
def upsert_platform_creds(platform):
    if not _is_admin(get_jwt_identity()):
        abort(403)
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    body = request.get_json() or {}
    # body = { key_name: value, ... }
    allowed_keys = {k['name'] for k in PLATFORMS[platform]['keys']}
    saved = []
    for key_name, key_value in body.items():
        if key_name not in allowed_keys:
            continue
        if not key_value or str(key_value).strip() == '':
            continue
        is_secret = next((k['is_secret'] for k in PLATFORMS[platform]['keys'] if k['name'] == key_name), True)
        set_credential(platform, key_name, str(key_value).strip(), is_secret=is_secret)
        saved.append(key_name)
    log.info('Updated credentials for %s: %s', platform, saved)
    return jsonify({'saved': saved})


@credentials_bp.route('/api/credentials/<platform>/<key_name>', methods=['DELETE'])
@jwt_required()
def delete_platform_cred(platform, key_name):
    if not _is_admin(get_jwt_identity()):
        abort(403)
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    deleted = delete_credential(platform, key_name)
    return jsonify({'deleted': deleted})


def _is_admin(user_id: str) -> bool:
    row = execute_query(
        "SELECT role FROM training.users WHERE id = %s", (user_id,), fetch_one=True
    )
    return bool(row and row['role'] in ('admin', 'super_admin'))


@credentials_bp.route('/api/admin/platform-icons', methods=['GET'])
@jwt_required()
def get_platform_icons():
    """Return uploaded icon data URLs for all platforms (accessible to all users for display)."""
    icons = {}
    for platform in PLATFORMS:
        icons[platform] = get_credential(platform, 'icon_data')
    return jsonify(icons)


@credentials_bp.route('/api/admin/platform-icon/<platform>', methods=['POST'])
@jwt_required()
def upload_platform_icon(platform):
    """Admin: upload a PNG/SVG icon for a platform."""
    if not _is_admin(get_jwt_identity()):
        return jsonify({'error': 'Admin only'}), 403
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    f = request.files.get('icon')
    if not f:
        return jsonify({'error': 'No file uploaded'}), 400
    raw = f.read()
    if len(raw) > 153600:  # 150 KB limit
        return jsonify({'error': 'Icon must be under 150 KB'}), 400
    mime = f.mimetype or 'image/png'
    data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    set_credential(platform, 'icon_data', data_url, is_secret=False)
    log.info('Admin uploaded icon for %s (%d bytes)', platform, len(raw))
    return jsonify({'ok': True})


@credentials_bp.route('/api/admin/platform-icon/<platform>', methods=['DELETE'])
@jwt_required()
def delete_platform_icon(platform):
    if not _is_admin(get_jwt_identity()):
        return jsonify({'error': 'Admin only'}), 403
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    delete_credential(platform, 'icon_data')
    return jsonify({'ok': True})


@credentials_bp.route('/api/credentials/test/<platform>', methods=['POST'])
@jwt_required()
def test_platform(platform):
    """Quick connectivity test using stored credentials."""
    if platform == 'strava':
        client_id = get_credential('strava', 'client_id')
        if not client_id:
            return jsonify({'ok': False, 'message': 'client_id not set'}), 400
        return jsonify({
            'ok': True,
            'message': f'Strava client_id {client_id} is configured. Use the Sync page to connect your account via OAuth.',
        })
    elif platform == 'suunto':
        client_id  = get_credential('suunto', 'client_id')
        sub_key    = get_credential('suunto', 'subscription_key')
        if not client_id:
            return jsonify({'ok': False, 'message': 'client_id not set'}), 400
        if not sub_key:
            return jsonify({'ok': False, 'message': 'subscription_key not set'}), 400
        return jsonify({
            'ok': True,
            'message': f'Suunto client_id {client_id} is configured. Use the Sync page to connect via OAuth.',
        })
    return jsonify({'error': 'Unknown platform'}), 404
