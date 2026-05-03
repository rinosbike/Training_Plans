from flask import Blueprint, request, jsonify, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.exceptions import NotFoundError, ValidationError

goals_bp = Blueprint('goals', __name__)

VALID_GOAL_TYPES = {
    'marathon', 'half_marathon', '5k', '10k',
    'ironman', 'half_ironman', 'sprint_triathlon',
    'cycling_event', 'strength', 'general_fitness'
}


@goals_bp.route('/api/goals', methods=['GET'])
@jwt_required()
def list_goals():
    user_id = get_jwt_identity()
    rows = execute_query(
        '''SELECT g.*, p.plan_start_date, p.plan_end_date
           FROM training.goals g
           LEFT JOIN training.training_plans p ON p.goal_id = g.id
           WHERE g.user_id = %s
           ORDER BY g.created_at DESC''',
        (user_id,)
    )
    return jsonify([dict(r) for r in rows])


@goals_bp.route('/api/goals', methods=['POST'])
@jwt_required()
def create_goal():
    user_id = get_jwt_identity()
    data = request.get_json()

    goal_type = data.get('goal_type')
    if goal_type not in VALID_GOAL_TYPES:
        raise ValidationError(f'Invalid goal_type. Must be one of: {", ".join(VALID_GOAL_TYPES)}')
    if not data.get('goal_name'):
        raise ValidationError('goal_name is required')
    if not data.get('target_date'):
        raise ValidationError('target_date is required')

    row = execute_write(
        '''INSERT INTO training.goals
             (user_id, goal_type, goal_name, target_date, event_name, target_time_seconds)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING *''',
        (user_id, goal_type, data['goal_name'], data['target_date'],
         data.get('event_name'), data.get('target_time_seconds')),
        returning=True
    )
    return jsonify(dict(row)), 201


@goals_bp.route('/api/goals/<goal_id>', methods=['GET'])
@jwt_required()
def get_goal(goal_id):
    user_id = get_jwt_identity()
    row = execute_query(
        'SELECT * FROM training.goals WHERE id = %s AND user_id = %s',
        (goal_id, user_id), fetch_one=True
    )
    if not row:
        raise NotFoundError('Goal not found')
    return jsonify(dict(row))


@goals_bp.route('/api/goals/<goal_id>', methods=['PUT'])
@jwt_required()
def update_goal(goal_id):
    user_id = get_jwt_identity()
    data = request.get_json()

    existing = execute_query(
        'SELECT id FROM training.goals WHERE id = %s AND user_id = %s',
        (goal_id, user_id), fetch_one=True
    )
    if not existing:
        raise NotFoundError('Goal not found')

    fields = ['goal_name', 'target_date', 'event_name', 'target_time_seconds', 'status']
    updates, vals = [], []
    for f in fields:
        if f in data:
            updates.append(f'{f} = %s')
            vals.append(data[f])
    if not updates:
        raise ValidationError('No fields to update')

    vals.append(goal_id)
    row = execute_write(
        f"UPDATE training.goals SET {', '.join(updates)} WHERE id = %s RETURNING *",
        vals, returning=True
    )
    return jsonify(dict(row))


@goals_bp.route('/api/goals/<goal_id>', methods=['DELETE'])
@jwt_required()
def delete_goal(goal_id):
    user_id = get_jwt_identity()
    existing = execute_query(
        'SELECT id FROM training.goals WHERE id = %s AND user_id = %s',
        (goal_id, user_id), fetch_one=True
    )
    if not existing:
        raise NotFoundError('Goal not found')
    execute_write('DELETE FROM training.goals WHERE id = %s', (goal_id,))
    return jsonify({'message': 'Deleted'})


@goals_bp.route('/api/profile', methods=['GET'])
@jwt_required()
def get_profile():
    user_id = get_jwt_identity()
    row = execute_query(
        'SELECT * FROM training.profiles WHERE user_id = %s', (user_id,), fetch_one=True
    )
    return jsonify(dict(row) if row else {})


@goals_bp.route('/api/profile', methods=['PUT'])
@jwt_required()
def upsert_profile():
    user_id = get_jwt_identity()
    data = request.get_json()

    fields = [
        'date_of_birth', 'gender', 'weight_kg', 'height_cm', 'resting_hr', 'max_hr',
        'ftp_watts', 'css_per_100m', 'running_threshold_pace_sec_km',
        'current_weekly_hours', 'fitness_level', 'vo2max_estimate'
    ]
    col_vals = {f: data[f] for f in fields if f in data}

    existing = execute_query(
        'SELECT user_id FROM training.profiles WHERE user_id = %s', (user_id,), fetch_one=True
    )
    if existing:
        if not col_vals:
            return jsonify({'message': 'No changes'})
        sets = ', '.join(f'{k}=%s' for k in col_vals)
        row = execute_write(
            f'UPDATE training.profiles SET {sets} WHERE user_id=%s RETURNING *',
            list(col_vals.values()) + [user_id], returning=True
        )
    else:
        cols = ', '.join(['user_id'] + list(col_vals.keys()))
        placeholders = ', '.join(['%s'] * (1 + len(col_vals)))
        row = execute_write(
            f'INSERT INTO training.profiles ({cols}) VALUES ({placeholders}) RETURNING *',
            [user_id] + list(col_vals.values()), returning=True
        )
    return jsonify(dict(row))
