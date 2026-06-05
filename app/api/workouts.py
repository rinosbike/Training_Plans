from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError
from app.services.load_service import compute_load_for_user
from app.services.sync import strava as strava_svc
from app.services.credential_service import get_credential

workouts_bp = Blueprint('workouts', __name__)


@workouts_bp.route('/api/workouts/<workout_id>', methods=['GET'])
@jwt_required()
def get_workout(workout_id):
    user_id = get_jwt_identity()
    row = execute_query(
        '''SELECT w.*, pd.date, pd.day_type,
             wl.actual_duration_min, wl.actual_distance_km, wl.avg_hr,
             wl.max_hr, wl.perceived_effort, wl.calories_burned,
             wl.avg_power_watts, wl.notes as log_notes, wl.id as log_id,
             wl.source as log_source, wl.external_id as strava_activity_id
           FROM training.workouts w
           JOIN training.plan_days pd ON pd.id = w.plan_day_id
           LEFT JOIN training.workout_logs wl ON wl.workout_id = w.id
           WHERE w.id = %s AND w.user_id = %s''',
        (workout_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Workout not found')
    return jsonify(dict(row))


@workouts_bp.route('/api/workouts/<workout_id>', methods=['PUT'])
@jwt_required()
def update_workout(workout_id):
    user_id = get_jwt_identity()
    data = request.get_json()

    existing = execute_query(
        'SELECT id FROM training.workouts WHERE id = %s AND user_id = %s',
        (workout_id, user_id), fetch_one=True
    )
    if not existing:
        raise NotFoundError('Workout not found')

    fields = ['title', 'duration_min', 'distance_km', 'intensity_zone', 'description', 'structure']
    updates, vals = [], []
    for f in fields:
        if f in data:
            updates.append(f'{f} = %s')
            vals.append(data[f])
    if not updates:
        raise ValidationError('No fields to update')
    vals.append(workout_id)

    row = execute_write(
        f"UPDATE training.workouts SET {', '.join(updates)} WHERE id = %s RETURNING *",
        vals, returning=True
    )
    return jsonify(dict(row))


@workouts_bp.route('/api/workouts/<workout_id>/log', methods=['POST'])
@jwt_required()
def log_workout(workout_id):
    user_id = get_jwt_identity()
    data = request.get_json()

    workout = execute_query(
        'SELECT id, user_id FROM training.workouts WHERE id = %s AND user_id = %s',
        (workout_id, user_id), fetch_one=True
    )
    if not workout:
        raise NotFoundError('Workout not found')

    # Upsert log
    existing_log = execute_query(
        'SELECT id FROM training.workout_logs WHERE workout_id = %s AND user_id = %s',
        (workout_id, user_id), fetch_one=True
    )

    fields = {
        'actual_duration_min': data.get('actual_duration_min'),
        'actual_distance_km': data.get('actual_distance_km'),
        'avg_hr': data.get('avg_hr'),
        'max_hr': data.get('max_hr'),
        'avg_power_watts': data.get('avg_power_watts'),
        'calories_burned': data.get('calories_burned'),
        'perceived_effort': data.get('perceived_effort'),
        'notes': data.get('notes'),
    }
    fields = {k: v for k, v in fields.items() if v is not None}

    if existing_log:
        sets = ', '.join(f'{k}=%s' for k in fields)
        vals = list(fields.values()) + [str(existing_log['id'])]
        row = execute_write(
            f'UPDATE training.workout_logs SET {sets} WHERE id=%s RETURNING *',
            vals, returning=True
        )
    else:
        log_date = data.get('log_date') or execute_query(
            'SELECT date FROM training.plan_days pd JOIN training.workouts w ON w.plan_day_id = pd.id WHERE w.id = %s',
            (workout_id,), fetch_one=True
        )['date']
        cols = ', '.join(['workout_id', 'user_id', 'log_date', 'source'] + list(fields.keys()))
        placeholders = ', '.join(['%s'] * (4 + len(fields)))
        row = execute_write(
            f'INSERT INTO training.workout_logs ({cols}) VALUES ({placeholders}) RETURNING *',
            [workout_id, user_id, log_date, 'manual'] + list(fields.values()),
            returning=True
        )

    compute_load_for_user(user_id)
    return jsonify(dict(row)), 201


@workouts_bp.route('/api/workouts/<workout_id>/log', methods=['DELETE'])
@jwt_required()
def delete_log(workout_id):
    user_id = get_jwt_identity()
    execute_write(
        'DELETE FROM training.workout_logs WHERE workout_id = %s AND user_id = %s',
        (workout_id, user_id)
    )
    return jsonify({'message': 'Log deleted'})


# ---------------------------------------------------------------------------
# Strava rich analysis — fetched on demand when viewing a synced workout
# ---------------------------------------------------------------------------

@workouts_bp.route('/api/workouts/<workout_id>/strava-analysis')
@jwt_required()
def strava_analysis(workout_id):
    user_id = get_jwt_identity()

    log_row = execute_query(
        "SELECT external_id FROM training.workout_logs WHERE workout_id = %s AND user_id = %s AND source = 'strava'",
        (workout_id, user_id), fetch_one=True
    )
    if not log_row or not log_row['external_id']:
        return jsonify({'error': 'No Strava activity linked to this workout'}), 404

    activity_id = log_row['external_id']

    token_row = execute_query(
        "SELECT * FROM training.sync_tokens WHERE user_id = %s AND provider = 'strava'",
        (user_id,), fetch_one=True
    )
    if not token_row:
        return jsonify({'error': 'Strava not connected'}), 400

    client_id     = get_credential('strava', 'client_id') or current_app.config.get('STRAVA_CLIENT_ID', '')
    client_secret = get_credential('strava', 'client_secret') or current_app.config.get('STRAVA_CLIENT_SECRET', '')

    try:
        access_token, refreshed = strava_svc.get_valid_token(dict(token_row), client_id, client_secret)
        if refreshed:
            from app.db import execute_write as _ew
            from datetime import datetime, timezone, timedelta
            expires_at = None
            if refreshed.get('expires_at'):
                expires_at = datetime.fromtimestamp(refreshed['expires_at'], tz=timezone.utc)
            elif refreshed.get('expires_in'):
                expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(refreshed['expires_in']))
            _ew(
                '''UPDATE training.sync_tokens SET access_token=%s, refresh_token=%s, expires_at=%s, updated_at=NOW()
                   WHERE user_id=%s AND provider='strava' ''',
                (refreshed.get('access_token'), refreshed.get('refresh_token'), expires_at, user_id)
            )

        detail      = strava_svc.fetch_activity_detail(access_token, activity_id)
        try:
            zones = strava_svc.fetch_activity_zones(access_token, activity_id)
        except Exception:
            zones = []
        try:
            streams_raw = strava_svc.fetch_activity_streams(access_token, activity_id)
        except Exception:
            streams_raw = {}

        def _downsample(arr, max_pts=500):
            if not arr or len(arr) <= max_pts:
                return arr
            step = max(1, len(arr) // max_pts)
            return arr[::step]

        streams = {
            key: _downsample(streams_raw[key]['data'])
            for key in ('heartrate', 'time', 'distance', 'altitude', 'cadence')
            if key in streams_raw
        }

        return jsonify({
            'activity_id':            activity_id,
            'sport_type':             detail.get('sport_type') or detail.get('type'),
            'name':                   detail.get('name'),
            'splits_metric':          detail.get('splits_metric', []),
            'laps':                   detail.get('laps', []),
            'zones':                  zones,
            'total_elevation_gain':   detail.get('total_elevation_gain'),
            'elev_high':              detail.get('elev_high'),
            'elev_low':               detail.get('elev_low'),
            'average_cadence':        detail.get('average_cadence'),
            'average_watts':          detail.get('average_watts'),
            'weighted_average_watts': detail.get('weighted_average_watts'),
            'max_watts':              detail.get('max_watts'),
            'kilojoules':             detail.get('kilojoules'),
            'device_watts':           detail.get('device_watts', False),
            'suffer_score':           detail.get('suffer_score'),
            'pr_count':               detail.get('pr_count', 0),
            'achievement_count':      detail.get('achievement_count', 0),
            'kudos_count':            detail.get('kudos_count', 0),
            'average_temp':           detail.get('average_temp'),
            'map_polyline':           detail.get('map', {}).get('summary_polyline'),
            'streams':                streams,
        })
    except Exception as e:
        import logging
        logging.getLogger(__name__).error('Strava analysis fetch failed: %s', e)
        return jsonify({'error': str(e)}), 500
