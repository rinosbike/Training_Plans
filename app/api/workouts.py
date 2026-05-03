from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError

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
             wl.source as log_source
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
