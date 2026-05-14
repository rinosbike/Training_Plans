from collections import defaultdict
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write, get_db
from app.services.plan_engine import generate_plan
from app.services.translation_service import translate_plan_async
from app.exceptions import NotFoundError, ValidationError

plans_bp = Blueprint('plans', __name__)


@plans_bp.route('/api/plans/generate', methods=['POST'])
@jwt_required()
def generate():
    user_id = get_jwt_identity()
    data = request.get_json()
    goal_id = data.get('goal_id')
    if not goal_id:
        raise ValidationError('goal_id required')

    goal = execute_query(
        'SELECT * FROM training.goals WHERE id = %s AND user_id = %s',
        (goal_id, user_id), fetch_one=True
    )
    if not goal:
        raise NotFoundError('Goal not found')

    profile = execute_query(
        'SELECT * FROM training.profiles WHERE user_id = %s', (user_id,), fetch_one=True
    )

    # Delete existing plan for this goal
    existing = execute_query(
        'SELECT id FROM training.training_plans WHERE goal_id = %s AND user_id = %s',
        (goal_id, user_id), fetch_one=True
    )
    if existing:
        execute_write('DELETE FROM training.training_plans WHERE goal_id = %s AND user_id = %s',
                      (goal_id, user_id))

    result = generate_plan(dict(goal), dict(profile) if profile else {})

    # Insert plan header
    plan_row = execute_write(
        '''INSERT INTO training.training_plans (user_id, goal_id, plan_start_date, plan_end_date)
           VALUES (%s, %s, %s::date, %s::date) RETURNING *''',
        (user_id, goal_id,
         result['days'][0]['date'] if result['days'] else str(goal['target_date']),
         str(goal['target_date'])),
        returning=True
    )
    plan_id = str(plan_row['id'])

    # Insert plan weeks
    for w in result['weeks']:
        execute_write(
            '''INSERT INTO training.plan_weeks
                 (plan_id, user_id, week_number, week_start, block_type,
                  weekly_hours_target, weekly_tss_target)
               VALUES (%s, %s, %s, %s::date, %s, %s, %s)''',
            (plan_id, user_id, w['week_number'], w['week_start'],
             w['block_type'], w['weekly_hours_target'], w['weekly_tss_target'])
        )

    # Insert plan days + workouts
    db = get_db()
    day_id_map = {}
    for d in result['days']:
        with db.cursor() as cur:
            cur.execute(
                '''INSERT INTO training.plan_days (plan_id, user_id, date, day_type, ai_adjusted, notes)
                   VALUES (%s, %s, %s::date, %s, %s, %s) RETURNING id''',
                (plan_id, user_id, d['date'], d['day_type'], d.get('ai_adjusted', False), d.get('notes'))
            )
            day_id = str(cur.fetchone()['id'])
            day_id_map[d['date']] = day_id
        db.commit()

    for wo in result['workouts']:
        workout_date = wo.pop('_workout_date', None)
        plan_day_id = day_id_map.get(workout_date)
        if not plan_day_id:
            continue
        execute_write(
            '''INSERT INTO training.workouts
                 (plan_day_id, user_id, sport, title, title_key, duration_min, distance_km,
                  intensity_zone, tss, description, structure)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (plan_day_id, user_id, wo['sport'], wo['title'], wo.get('title_key'),
             wo['duration_min'], wo.get('distance_km'), wo['intensity_zone'], wo.get('tss'),
             wo.get('description'), wo.get('structure'))
        )

    translate_plan_async(user_id, plan_id)

    return jsonify({
        'plan_id': plan_id,
        'weeks': len(result['weeks']),
        'days': len(result['days']),
        'workouts': len(result['workouts']),
    }), 201


@plans_bp.route('/api/plans', methods=['GET'])
@jwt_required()
def list_plans():
    user_id = get_jwt_identity()
    rows = execute_query(
        '''SELECT p.*, g.goal_name, g.goal_type, g.target_date
           FROM training.training_plans p
           JOIN training.goals g ON g.id = p.goal_id
           WHERE p.user_id = %s
           ORDER BY p.created_at DESC''',
        (user_id,)
    )
    return jsonify([dict(r) for r in rows])


@plans_bp.route('/api/plans/<plan_id>/weeks', methods=['GET'])
@jwt_required()
def get_plan_weeks(plan_id):
    user_id = get_jwt_identity()
    rows = execute_query(
        '''SELECT * FROM training.plan_weeks
           WHERE plan_id = %s AND user_id = %s
           ORDER BY week_number''',
        (plan_id, user_id)
    )
    return jsonify([dict(r) for r in rows])


@plans_bp.route('/api/plans/days', methods=['GET'])
@jwt_required()
def get_plan_days():
    """Returns plan days for a date range. ?start=YYYY-MM-DD&end=YYYY-MM-DD"""
    user_id = get_jwt_identity()
    start = request.args.get('start')
    end = request.args.get('end')
    goal_id = request.args.get('goal_id')

    query = '''
        SELECT pd.*, pw.block_type, pw.weekly_hours_target,
               json_agg(
                 json_build_object(
                   'id', w.id,
                   'sport', w.sport,
                   'title', w.title,
                   'title_key', w.title_key,
                   'duration_min', w.duration_min,
                   'distance_km', w.distance_km,
                   'intensity_zone', w.intensity_zone,
                   'tss', w.tss,
                   'description', w.description,
                   'description_translations', w.description_translations,
                   'log', CASE WHEN wl.id IS NOT NULL THEN json_build_object(
                     'id', wl.id,
                     'source', wl.source,
                     'actual_duration_min', wl.actual_duration_min,
                     'actual_distance_km', wl.actual_distance_km,
                     'avg_hr', wl.avg_hr,
                     'max_hr', wl.max_hr,
                     'avg_power_watts', wl.avg_power_watts,
                     'calories_burned', wl.calories_burned,
                     'perceived_effort', wl.perceived_effort,
                     'notes', wl.notes
                   ) ELSE NULL END
                 ) ORDER BY w.sort_order
               ) FILTER (WHERE w.id IS NOT NULL) as workouts
        FROM training.plan_days pd
        JOIN training.training_plans tp ON tp.id = pd.plan_id
        LEFT JOIN training.plan_weeks pw ON pw.plan_id = pd.plan_id
          AND pd.date >= pw.week_start AND pd.date < pw.week_start + interval '7 days'
        LEFT JOIN training.workouts w ON w.plan_day_id = pd.id
        LEFT JOIN training.workout_logs wl ON wl.workout_id = w.id
        WHERE pd.user_id = %s
    '''
    params = [user_id]
    if start:
        query += ' AND pd.date >= %s'
        params.append(start)
    if end:
        query += ' AND pd.date <= %s'
        params.append(end)
    if goal_id:
        query += ' AND tp.goal_id = %s'
        params.append(goal_id)
    query += ' GROUP BY pd.id, pw.block_type, pw.weekly_hours_target ORDER BY pd.date'

    rows = execute_query(query, params)
    plan_days = [dict(r) for r in rows]

    # Also include standalone synced activities (workout_id IS NULL — unmatched to any plan workout).
    # These appear when today is a rest day, sport/duration didn't match, or no plan covers the date.
    standalone_sql = '''
        SELECT id, log_date, source, sport,
               actual_duration_min, actual_distance_km, avg_hr, max_hr,
               avg_power_watts, calories_burned, perceived_effort, notes
        FROM training.workout_logs
        WHERE user_id = %s AND workout_id IS NULL
        AND source IN ('strava', 'suunto')
    '''
    standalone_params = [user_id]
    if start:
        standalone_sql += ' AND log_date >= %s'
        standalone_params.append(start)
    if end:
        standalone_sql += ' AND log_date <= %s'
        standalone_params.append(end)

    standalone_rows = execute_query(standalone_sql, standalone_params) or []

    if standalone_rows:
        logs_by_date = defaultdict(list)
        for log in standalone_rows:
            logs_by_date[str(log['log_date'])].append(dict(log))

        plan_day_dates = {str(d['date']) for d in plan_days}

        for day in plan_days:
            date_str = str(day['date'])
            if date_str in logs_by_date:
                if day['workouts'] is None:
                    day['workouts'] = []
                for log in logs_by_date[date_str]:
                    day['workouts'].append(_standalone_log_to_workout(log))

        # Create synthetic plan-day entries for dates with synced activities but no plan coverage
        for date_str, logs in logs_by_date.items():
            if date_str not in plan_day_dates:
                plan_days.append({
                    'id': None,
                    'plan_id': None,
                    'user_id': user_id,
                    'date': date_str,
                    'day_type': 'easy',
                    'ai_adjusted': False,
                    'notes': None,
                    'block_type': None,
                    'weekly_hours_target': None,
                    'workouts': [_standalone_log_to_workout(log) for log in logs],
                })

        plan_days.sort(key=lambda d: str(d['date']))

    return jsonify(plan_days)


def _standalone_log_to_workout(log):
    """Wrap a workout_log with no plan match into a synthetic workout dict for calendar display."""
    source = log.get('source') or 'activity'
    title = log.get('notes') or f'{source.title()} Activity'
    return {
        'id': str(log['id']),
        'sport': log.get('sport') or 'run',
        'title': title,
        'title_key': None,
        'duration_min': log.get('actual_duration_min'),
        'distance_km': log.get('actual_distance_km'),
        'intensity_zone': 2,
        'tss': None,
        'description': None,
        'description_translations': None,
        'is_unplanned': True,
        'log': {
            'id': str(log['id']),
            'source': source,
            'actual_duration_min': log.get('actual_duration_min'),
            'actual_distance_km': log.get('actual_distance_km'),
            'avg_hr': log.get('avg_hr'),
            'max_hr': log.get('max_hr'),
            'avg_power_watts': log.get('avg_power_watts'),
            'calories_burned': log.get('calories_burned'),
            'perceived_effort': log.get('perceived_effort'),
            'notes': log.get('notes'),
        },
    }
