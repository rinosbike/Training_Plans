"""
Sync API — Phase 2 placeholder.
Suunto and Strava OAuth connect/callback endpoints.
Full implementation after API keys are obtained from developer portals.
"""
from flask import Blueprint, request, jsonify, redirect, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write

sync_bp = Blueprint('sync', __name__)


@sync_bp.route('/api/sync/status')
@jwt_required()
def sync_status():
    user_id = get_jwt_identity()
    tokens = execute_query(
        'SELECT provider, provider_user_id, updated_at FROM training.sync_tokens WHERE user_id = %s',
        (user_id,)
    )
    log = execute_query(
        '''SELECT provider, synced_at, activities_imported, status
           FROM training.sync_log WHERE user_id = %s
           ORDER BY synced_at DESC LIMIT 10''',
        (user_id,)
    )
    connected = {r['provider']: True for r in tokens}
    return jsonify({'connected': connected, 'recent_syncs': [dict(r) for r in log]})


@sync_bp.route('/api/sync/suunto/connect')
@jwt_required()
def suunto_connect():
    # Requires SUUNTO_CLIENT_ID — set after developer.suunto.com registration
    client_id = current_app.config.get('SUUNTO_CLIENT_ID', '')
    if not client_id:
        return jsonify({'error': 'Suunto not configured. Register at developer.suunto.com'}), 503
    from urllib.parse import urlencode
    params = {
        'client_id': client_id,
        'redirect_uri': f"{current_app.config.get('FRONTEND_URL', '')}/api/sync/suunto/callback",
        'response_type': 'code',
        'scope': 'workouts',
    }
    return redirect(f"https://cloudapi-oauth.suunto.com/oauth/authorize?{urlencode(params)}")


@sync_bp.route('/api/sync/strava/connect')
@jwt_required()
def strava_connect():
    client_id = current_app.config.get('STRAVA_CLIENT_ID', '')
    if not client_id:
        return jsonify({'error': 'Strava not configured. Register at strava.com/settings/api'}), 503
    from urllib.parse import urlencode
    params = {
        'client_id': client_id,
        'redirect_uri': f"{current_app.config['FRONTEND_URL']}/api/sync/strava/callback",
        'response_type': 'code',
        'scope': 'activity:read_all',
        'approval_prompt': 'auto',
    }
    return redirect(f"https://www.strava.com/oauth/authorize?{urlencode(params)}")


@sync_bp.route('/api/sync/disconnect', methods=['POST'])
@jwt_required()
def disconnect():
    user_id = get_jwt_identity()
    provider = request.get_json().get('provider')
    if provider not in ('suunto', 'strava'):
        return jsonify({'error': 'Invalid provider'}), 400
    execute_write(
        'DELETE FROM training.sync_tokens WHERE user_id = %s AND provider = %s',
        (user_id, provider)
    )
    return jsonify({'message': f'Disconnected from {provider}'})
