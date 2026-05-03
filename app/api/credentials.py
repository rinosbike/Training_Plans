"""
Credentials API — manage training.api_credentials (Strava, Suunto, etc.)
Admin-level: any authenticated user can manage their own app credentials.
"""
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
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
    """Return platform definitions + current saved key names (values masked)."""
    result = []
    for platform_id, meta in PLATFORMS.items():
        saved = list_credentials(platform_id)
        saved_map = {r['key_name']: r for r in saved}
        keys = []
        for k in meta['keys']:
            row = saved_map.get(k['name'])
            keys.append({
                **k,
                'saved': row is not None,
                'updated_at': row['updated_at'] if row else None,
            })
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
    if platform not in PLATFORMS:
        return jsonify({'error': 'Unknown platform'}), 404
    deleted = delete_credential(platform, key_name)
    return jsonify({'deleted': deleted})


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
