"""
Sync API — Strava + Suunto OAuth, manual sync, and webhook endpoints.
"""
import json
import logging
import secrets
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify, redirect, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask import g
from app.db import execute_query, execute_write, set_user_context
from app.services.sync import strava as strava_svc
from app.services.sync import suunto as suunto_svc
from app.services.credential_service import get_credential
from app.services.load_service import compute_load_for_user

sync_bp = Blueprint('sync', __name__)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _upsert_token(user_id, provider, data, provider_user_id=None):
    from datetime import datetime, timezone
    expires_at = None
    if data.get('expires_at'):
        expires_at = datetime.fromtimestamp(data['expires_at'], tz=timezone.utc)
    elif data.get('expires_in'):
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data['expires_in']))

    execute_write(
        '''INSERT INTO training.sync_tokens
             (user_id, provider, access_token, refresh_token, expires_at, provider_user_id)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (user_id, provider) DO UPDATE
             SET access_token=EXCLUDED.access_token,
                 refresh_token=EXCLUDED.refresh_token,
                 expires_at=EXCLUDED.expires_at,
                 updated_at=NOW()''',
        (user_id, provider, data.get('access_token'), data.get('refresh_token'),
         expires_at, str(provider_user_id) if provider_user_id else None)
    )


def _upsert_log(user_id, provider, imported, status, error=None):
    execute_write(
        '''INSERT INTO training.sync_log
             (user_id, provider, synced_at, activities_imported, status, error_msg)
           VALUES (%s, %s, NOW(), %s, %s, %s)''',
        (user_id, provider, imported, status, error)
    )


def _import_mapped(mapped_list, user_id):
    """Upsert workout_logs for a list of mapped activities. Returns count imported."""
    imported = 0
    for m in mapped_list:
        if not m.get('log_date'):
            continue

        # Skip if already imported (by external_id + source)
        existing_log = execute_query(
            'SELECT id FROM training.workout_logs WHERE external_id = %s AND source = %s AND user_id = %s',
            (m['external_id'], m['source'], user_id), fetch_one=True
        )

        # Try to match to a planned workout
        workout_id = strava_svc.match_to_plan(m, user_id, execute_query)

        raw_json = json.dumps(m.get('raw_data', {})) if m.get('raw_data') else None

        if existing_log:
            # Update existing log with latest data; also re-link workout_id in case
            # the activity was imported before the plan existed or plan was regenerated.
            execute_write(
                '''UPDATE training.workout_logs SET
                     workout_id=%s, sport=%s,
                     actual_duration_min=%s, actual_distance_km=%s, avg_hr=%s, max_hr=%s,
                     avg_power_watts=%s, calories_burned=%s, perceived_effort=%s, notes=%s,
                     raw_data=%s, updated_at=NOW()
                   WHERE id=%s''',
                (workout_id, m.get('sport'),
                 m.get('actual_duration_min'), m.get('actual_distance_km'),
                 m.get('avg_hr'), m.get('max_hr'), m.get('avg_power_watts'),
                 m.get('calories_burned'), m.get('perceived_effort'), m.get('notes'),
                 raw_json, str(existing_log['id']))
            )
        else:
            execute_write(
                '''INSERT INTO training.workout_logs
                     (user_id, workout_id, log_date, source, external_id, sport,
                      actual_duration_min, actual_distance_km, avg_hr, max_hr,
                      avg_power_watts, calories_burned, perceived_effort, notes, raw_data)
                   VALUES (%s, %s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
                (user_id, workout_id, m['log_date'], m['source'], m['external_id'], m.get('sport'),
                 m.get('actual_duration_min'), m.get('actual_distance_km'),
                 m.get('avg_hr'), m.get('max_hr'), m.get('avg_power_watts'),
                 m.get('calories_burned'), m.get('perceived_effort'), m.get('notes'),
                 raw_json)
            )
            imported += 1
    return imported


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/status')
@jwt_required()
def sync_status():
    user_id = get_jwt_identity()
    tokens = execute_query(
        'SELECT provider, provider_user_id, updated_at FROM training.sync_tokens WHERE user_id = %s',
        (user_id,)
    )
    log_rows = execute_query(
        '''SELECT provider, synced_at, activities_imported, status, error_msg
           FROM training.sync_log WHERE user_id = %s
           ORDER BY synced_at DESC LIMIT 20''',
        (user_id,)
    )
    # Recent imported activities
    recent = execute_query(
        '''SELECT source, log_date, actual_duration_min, actual_distance_km,
                  avg_hr, calories_burned, notes, created_at
           FROM training.workout_logs
           WHERE user_id = %s AND source IN ('strava','suunto')
           ORDER BY log_date DESC, created_at DESC LIMIT 20''',
        (user_id,)
    )
    connected = {r['provider']: {'provider_user_id': r['provider_user_id'],
                                  'updated_at': r['updated_at']} for r in tokens}
    return jsonify({
        'connected': connected,
        'recent_syncs': [dict(r) for r in log_rows],
        'recent_activities': [dict(r) for r in recent],
    })


# ---------------------------------------------------------------------------
# Strava OAuth
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/strava/connect')
@jwt_required()
def strava_connect():
    user_id   = get_jwt_identity()
    client_id = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
    if not client_id:
        return jsonify({'error': 'Strava not configured. Add client_id on the Credentials page'}), 503
    nonce = secrets.token_urlsafe(32)
    execute_write(
        "INSERT INTO training.oauth_nonces (nonce, user_id, provider) VALUES (%s, %s, 'strava')",
        (nonce, user_id)
    )
    redirect_uri = f"{current_app.config.get('FRONTEND_URL','')}/api/sync/strava/callback"
    url = strava_svc.get_auth_url(client_id, redirect_uri, state=nonce)
    return jsonify({'url': url})


@sync_bp.route('/api/sync/strava/callback')
def strava_callback():
    code  = request.args.get('code')
    error = request.args.get('error')
    if error or not code:
        return redirect('/sync?error=strava_denied')

    nonce = request.args.get('state', '')
    user_id = _user_id_from_nonce(nonce)
    if not user_id:
        log.error('Strava callback: nonce not found or expired: %r', nonce)
        return redirect('/sync?error=no_state')

    # Set DB user context so RLS-protected tables (sync_tokens) allow writes
    g.user_id = user_id
    set_user_context(user_id)

    client_id     = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
    client_secret = get_credential('strava', 'client_secret') or current_app.config.get('STRAVA_CLIENT_SECRET', '')
    try:
        data = strava_svc.exchange_code(client_id, client_secret, code)
    except Exception as e:
        log.error('Strava token exchange failed: %s', e)
        return redirect('/sync?error=strava_token')

    provider_user_id = data.get('athlete', {}).get('id')
    _upsert_token(user_id, 'strava', data, provider_user_id)
    return redirect('/sync?connected=strava')


# ---------------------------------------------------------------------------
# Strava manual sync
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/strava/run', methods=['POST'])
@jwt_required()
def strava_run():
    user_id       = get_jwt_identity()
    client_id     = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
    client_secret = get_credential('strava', 'client_secret') or current_app.config.get('STRAVA_CLIENT_SECRET', '')

    token_row = execute_query(
        'SELECT * FROM training.sync_tokens WHERE user_id = %s AND provider = %s',
        (user_id, 'strava'), fetch_one=True
    )
    if not token_row:
        return jsonify({'error': 'Strava not connected'}), 400

    try:
        access_token, refreshed = strava_svc.get_valid_token(dict(token_row), client_id, client_secret)
        if refreshed:
            _upsert_token(user_id, 'strava', refreshed)

        # Fetch since 2 days ago (manual trigger — catches anything missed since last auto-sync)
        after = (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()

        activities = strava_svc.fetch_activities(access_token, after_epoch=after)
        mapped     = [strava_svc.map_activity(a) for a in activities]
        imported   = _import_mapped(mapped, user_id)
        if imported:
            compute_load_for_user(user_id)
        _upsert_log(user_id, 'strava', imported, 'success')
        return jsonify({'imported': imported, 'total_fetched': len(activities)})

    except Exception as e:
        log.error('Strava sync error: %s', e)
        _upsert_log(user_id, 'strava', 0, 'error', str(e))
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Strava webhook
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/strava/webhook', methods=['GET'])
def strava_webhook_verify():
    """Strava webhook verification challenge."""
    verify_token = get_credential('strava', 'webhook_verify_token') or current_app.config.get('STRAVA_WEBHOOK_VERIFY_TOKEN', 'training_strava_hook_2026')
    if request.args.get('hub.verify_token') == verify_token:
        return jsonify({'hub.challenge': request.args.get('hub.challenge')})
    return jsonify({'error': 'forbidden'}), 403


@sync_bp.route('/api/sync/strava/webhook', methods=['POST'])
def strava_webhook_push():
    """Handle Strava webhook push for new activity."""
    data = request.get_json(silent=True) or {}
    if data.get('object_type') != 'activity' or data.get('aspect_type') != 'create':
        return jsonify({'status': 'ignored'}), 200

    activity_id = data.get('object_id')
    owner_id    = str(data.get('owner_id', ''))

    # Find user by Strava provider_user_id via SECURITY DEFINER function
    # (bypasses RLS bootstrap — webhook requests carry no JWT so
    #  training.current_user_id is unset when the connection is first opened)
    token_row = execute_query(
        "SELECT * FROM training.find_sync_token_by_provider('strava', %s)",
        (owner_id,), fetch_one=True
    )
    if not token_row:
        return jsonify({'status': 'user_not_found'}), 200

    user_id = str(token_row['user_id'])
    # Set DB user context so RLS-protected tables (workout_logs, sync_log) allow writes
    g.user_id = user_id
    set_user_context(user_id)

    client_id     = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
    client_secret = get_credential('strava', 'client_secret') or current_app.config.get('STRAVA_CLIENT_SECRET', '')
    try:
        access_token, refreshed = strava_svc.get_valid_token(dict(token_row), client_id, client_secret)
        if refreshed:
            _upsert_token(user_id, 'strava', refreshed)
        activity = strava_svc.fetch_activity_detail(access_token, activity_id)
        mapped   = strava_svc.map_activity(activity)
        imported = _import_mapped([mapped], user_id)
        _upsert_log(user_id, 'strava', imported, 'success')
    except Exception as e:
        log.error('Strava webhook import error: %s', e)
        return jsonify({'status': 'error'}), 500
    return jsonify({'status': 'ok'}), 200


# ---------------------------------------------------------------------------
# Suunto OAuth
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/suunto/connect')
@jwt_required()
def suunto_connect():
    user_id   = get_jwt_identity()
    client_id = get_credential('suunto', 'client_id') or current_app.config.get('SUUNTO_CLIENT_ID', '')
    if not client_id:
        return jsonify({'error': 'Suunto not configured. Add credentials on the Credentials page'}), 503
    nonce = secrets.token_urlsafe(32)
    execute_write(
        "INSERT INTO training.oauth_nonces (nonce, user_id, provider) VALUES (%s, %s, 'suunto')",
        (nonce, user_id)
    )
    redirect_uri = f"{current_app.config.get('FRONTEND_URL','')}/api/sync/suunto/callback"
    url = suunto_svc.get_auth_url(client_id, redirect_uri, state=nonce)
    return jsonify({'url': url})


@sync_bp.route('/api/sync/suunto/callback')
def suunto_callback():
    code  = request.args.get('code')
    error = request.args.get('error')
    if error or not code:
        return redirect('/sync?error=suunto_denied')

    nonce = request.args.get('state', '')
    user_id = _user_id_from_nonce(nonce)
    if not user_id:
        return redirect('/sync?error=no_state')
    g.user_id = user_id
    set_user_context(user_id)
    client_id     = get_credential('suunto', 'client_id') or current_app.config.get('SUUNTO_CLIENT_ID', '')
    client_secret = get_credential('suunto', 'client_secret') or current_app.config.get('SUUNTO_CLIENT_SECRET', '')
    redirect_uri  = f"{current_app.config.get('FRONTEND_URL','')}/api/sync/suunto/callback"
    try:
        data = suunto_svc.exchange_code(client_id, client_secret, code, redirect_uri)
    except Exception as e:
        log.error('Suunto token exchange failed: %s', e)
        return redirect('/sync?error=suunto_token')
    _upsert_token(user_id, 'suunto', data)
    return redirect('/sync?connected=suunto')


# ---------------------------------------------------------------------------
# Suunto manual sync
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/suunto/run', methods=['POST'])
@jwt_required()
def suunto_run():
    user_id       = get_jwt_identity()
    client_id     = get_credential('suunto', 'client_id') or current_app.config.get('SUUNTO_CLIENT_ID', '')
    client_secret = get_credential('suunto', 'client_secret') or current_app.config.get('SUUNTO_CLIENT_SECRET', '')
    sub_key       = get_credential('suunto', 'subscription_key') or current_app.config.get('SUUNTO_SUBSCRIPTION_KEY', '')

    token_row = execute_query(
        'SELECT * FROM training.sync_tokens WHERE user_id = %s AND provider = %s',
        (user_id, 'suunto'), fetch_one=True
    )
    if not token_row:
        return jsonify({'error': 'Suunto not connected'}), 400

    try:
        access_token, refreshed = suunto_svc.get_valid_token(dict(token_row), client_id, client_secret)
        if refreshed:
            _upsert_token(user_id, 'suunto', refreshed)

        last_sync = execute_query(
            "SELECT synced_at FROM training.sync_log WHERE user_id=%s AND provider='suunto' AND status='success' ORDER BY synced_at DESC LIMIT 1",
            (user_id,), fetch_one=True
        )
        since_ms = None
        if last_sync and last_sync['synced_at']:
            since_ms = int(last_sync['synced_at'].timestamp() * 1000)
        else:
            since_ms = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp() * 1000)

        workouts = suunto_svc.fetch_workouts(access_token, sub_key, since_epoch_ms=since_ms)
        mapped   = [suunto_svc.map_workout(w) for w in workouts]
        imported = _import_mapped(mapped, user_id)
        if imported:
            compute_load_for_user(user_id)
        _upsert_log(user_id, 'suunto', imported, 'success')
        return jsonify({'imported': imported, 'total_fetched': len(workouts)})

    except Exception as e:
        log.error('Suunto sync error: %s', e)
        _upsert_log(user_id, 'suunto', 0, 'error', str(e))
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Suunto webhook
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/suunto/webhook', methods=['POST'])
def suunto_webhook_push():
    """Handle Suunto real-time workout notification."""
    secret = get_credential('suunto', 'webhook_secret') or current_app.config.get('SUUNTO_WEBHOOK_SECRET', '')
    sig    = request.headers.get('X-HMAC-SHA256-Signature', '')
    if secret and not suunto_svc.verify_webhook_signature(request.data, sig, secret):
        return jsonify({'error': 'invalid signature'}), 401

    data = request.get_json(silent=True) or {}
    workout_key = data.get('workoutKey') or data.get('workoutkey')
    owner_token = data.get('username') or data.get('userId', '')

    token_row = execute_query(
        "SELECT * FROM training.find_sync_token_by_provider('suunto', %s)",
        (str(owner_token),), fetch_one=True
    )
    if not token_row or not workout_key:
        return jsonify({'status': 'ignored'}), 200

    user_id = str(token_row['user_id'])
    # Set DB user context so RLS-protected tables (workout_logs, sync_log) allow writes
    g.user_id = user_id
    set_user_context(user_id)

    client_id     = get_credential('suunto', 'client_id') or current_app.config.get('SUUNTO_CLIENT_ID', '')
    client_secret = get_credential('suunto', 'client_secret') or current_app.config.get('SUUNTO_CLIENT_SECRET', '')
    sub_key       = get_credential('suunto', 'subscription_key') or current_app.config.get('SUUNTO_SUBSCRIPTION_KEY', '')
    try:
        access_token, refreshed = suunto_svc.get_valid_token(dict(token_row), client_id, client_secret)
        if refreshed:
            _upsert_token(user_id, 'suunto', refreshed)
        workout = suunto_svc.fetch_workout_detail(access_token, sub_key, workout_key)
        mapped  = suunto_svc.map_workout(workout)
        imported = _import_mapped([mapped], user_id)
        _upsert_log(user_id, 'suunto', imported, 'success')
    except Exception as e:
        log.error('Suunto webhook error: %s', e)
        return jsonify({'status': 'error'}), 500
    return jsonify({'status': 'ok'}), 200


# ---------------------------------------------------------------------------
# Disconnect
# ---------------------------------------------------------------------------

@sync_bp.route('/api/sync/disconnect', methods=['POST'])
@jwt_required()
def disconnect():
    user_id  = get_jwt_identity()
    provider = request.get_json().get('provider')
    if provider not in ('suunto', 'strava'):
        return jsonify({'error': 'Invalid provider'}), 400
    execute_write(
        'DELETE FROM training.sync_tokens WHERE user_id = %s AND provider = %s',
        (user_id, provider)
    )
    return jsonify({'message': f'Disconnected from {provider}'})


# ---------------------------------------------------------------------------
# Helper: look up short-lived nonce → user_id
# ---------------------------------------------------------------------------

def _user_id_from_nonce(nonce: str) -> str | None:
    if not nonce:
        return None
    row = execute_query(
        "SELECT user_id FROM training.oauth_nonces WHERE nonce=%s AND expires_at > NOW()",
        (nonce,), fetch_one=True
    )
    if row:
        execute_write("DELETE FROM training.oauth_nonces WHERE nonce=%s", (nonce,))
        return str(row['user_id'])
    return None
