import json
import logging
from datetime import date, datetime
from flask import Blueprint, request, jsonify, Response, stream_with_context
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write, get_db
from app.services import ai_coach_service as svc
from app.exceptions import NotFoundError, ValidationError

ai_coach_bp = Blueprint('ai_coach', __name__)
log = logging.getLogger(__name__)


@ai_coach_bp.route('/api/ai-coach/sessions', methods=['GET'])
@jwt_required()
def list_sessions():
    user_id = get_jwt_identity()
    rows = execute_query(
        '''SELECT id, goal_id, title, created_at, updated_at
           FROM training.ai_sessions
           WHERE user_id = %s
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 20''',
        (user_id,)
    )
    return jsonify([dict(r) for r in rows])


@ai_coach_bp.route('/api/ai-coach/sessions', methods=['POST'])
@jwt_required()
def create_session():
    user_id = get_jwt_identity()
    data = request.get_json()
    goal_id = data.get('goal_id')

    if goal_id:
        goal = execute_query(
            'SELECT id FROM training.goals WHERE id = %s AND user_id = %s',
            (goal_id, user_id), fetch_one=True
        )
        if not goal:
            raise NotFoundError('Goal not found')

    row = execute_write(
        '''INSERT INTO training.ai_sessions (user_id, goal_id, updated_at)
           VALUES (%s, %s, NOW()) RETURNING *''',
        (user_id, goal_id), returning=True
    )
    return jsonify(dict(row)), 201


@ai_coach_bp.route('/api/ai-coach/sessions/<session_id>/messages', methods=['GET'])
@jwt_required()
def get_messages(session_id):
    user_id = get_jwt_identity()
    rows = execute_query(
        '''SELECT * FROM training.ai_messages
           WHERE session_id = %s AND user_id = %s
           ORDER BY created_at''',
        (session_id, user_id)
    )
    return jsonify([dict(r) for r in rows])


@ai_coach_bp.route('/api/ai-coach/sessions/<session_id>/chat', methods=['POST'])
@jwt_required()
def chat(session_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    raw_message = data.get('message', '')
    try:
        message = svc.validate_message(raw_message)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    day_context = data.get('day_context')

    # Use client-supplied date (respects user's local timezone) with strict validation.
    # Fallback to UTC server date only if missing/malformed.
    raw_client_date = data.get('client_date', '')
    try:
        parsed = date.fromisoformat(raw_client_date)
        today_str = parsed.isoformat()
    except (ValueError, TypeError):
        today_str = date.today().isoformat()

    session = execute_query(
        'SELECT * FROM training.ai_sessions WHERE id = %s AND user_id = %s',
        (session_id, user_id), fetch_one=True
    )
    if not session:
        raise NotFoundError('Session not found')

    goal = {}
    if session['goal_id']:
        g_row = execute_query(
            'SELECT * FROM training.goals WHERE id = %s AND user_id = %s',
            (session['goal_id'], user_id), fetch_one=True
        )
        goal = dict(g_row) if g_row else {}

    profile_row = execute_query(
        'SELECT * FROM training.profiles WHERE user_id = %s', (user_id,), fetch_one=True
    )
    profile = dict(profile_row) if profile_row else {}

    user_row = execute_query(
        'SELECT id, name, email FROM training.users WHERE id = %s', (user_id,), fetch_one=True
    )
    user = dict(user_row) if user_row else {}

    # Load upcoming workouts for plan-change context
    workout_rows = execute_query(
        '''SELECT w.id, w.sport, w.title, w.duration_min, w.intensity_zone, pd.date, pd.day_type
           FROM training.workouts w
           JOIN training.plan_days pd ON pd.id = w.plan_day_id
           WHERE w.user_id = %s AND pd.date >= %s AND pd.date <= (%s::date + interval '7 days')
           ORDER BY pd.date, w.sport''',
        (user_id, today_str, today_str)
    )
    weekly_workouts = [
        {'id': str(r['id']), 'date': str(r['date']), 'day_type': r['day_type'],
         'sport': r['sport'], 'title': r['title'],
         'duration_min': r['duration_min'], 'zone': r['intensity_zone']}
        for r in workout_rows
    ]

    # Today's logged nutrition totals
    nutrition_row = execute_query(
        '''SELECT COALESCE(SUM(calories),0) as calories,
                  COALESCE(SUM(protein_g),0) as protein,
                  COALESCE(SUM(carbs_g),0) as carbs,
                  COALESCE(SUM(fat_g),0) as fat
           FROM training.food_log
           WHERE user_id = %s AND log_date = %s''',
        (user_id, today_str), fetch_one=True
    )
    today_nutrition = dict(nutrition_row) if nutrition_row else {}

    # Today's logged activities
    log_rows = execute_query(
        '''SELECT wl.actual_duration_min, wl.actual_distance_km, wl.avg_hr,
                  wl.perceived_effort, wl.source, wl.log_date,
                  w.sport, w.title
           FROM training.workout_logs wl
           LEFT JOIN training.workouts w ON w.id = wl.workout_id
           WHERE wl.user_id = %s AND wl.log_date = %s''',
        (user_id, today_str)
    )
    today_logs = [
        {'sport': r['sport'], 'title': r['title'],
         'duration_min': r['actual_duration_min'],
         'distance_km': float(r['actual_distance_km']) if r['actual_distance_km'] else None,
         'avg_hr': r['avg_hr'], 'rpe': r['perceived_effort'], 'source': r['source']}
        for r in log_rows
    ] if log_rows else []

    history = execute_query(
        '''SELECT role, content FROM training.ai_messages
           WHERE session_id = %s AND user_id = %s
           ORDER BY created_at DESC LIMIT 20''',
        (session_id, user_id)
    )
    history_msgs = [{'role': r['role'], 'content': r['content']} for r in reversed(list(history))]

    system_prompt = svc.build_system_prompt(
        user, goal, profile, day_context, weekly_workouts, today_nutrition, today_logs,
        today=today_str
    )
    messages = [{'role': 'system', 'content': system_prompt}] + history_msgs + \
               [{'role': 'user', 'content': message}]

    execute_write(
        '''INSERT INTO training.ai_messages (session_id, user_id, role, content, model)
           VALUES (%s, %s, 'user', %s, %s)''',
        (session_id, user_id, message, svc.MODEL)
    )

    # Auto-title session from first user message
    if not session['title']:
        title = message[:60] + ('…' if len(message) > 60 else '')
        execute_write(
            'UPDATE training.ai_sessions SET title = %s WHERE id = %s AND user_id = %s',
            (title, session_id, user_id)
        )

    def generate():
        full_response = []
        try:
            for line in svc.chat_stream(messages):
                token = svc.parse_sse_chunk(line)
                if token:
                    full_response.append(token)
                    yield f'data: {json.dumps({"token": token})}\n\n'
            yield 'data: [DONE]\n\n'
        except svc.CopilotAPIError as e:
            log.error('Copilot API error for user %s: %s', user_id, e.message)
            yield f'data: {json.dumps({"error": e.message})}\n\n'
            return
        finally:
            if full_response:
                ai_text = ''.join(full_response)
                execute_write(
                    '''INSERT INTO training.ai_messages
                         (session_id, user_id, role, content, model)
                       VALUES (%s, %s, 'assistant', %s, %s)''',
                    (session_id, user_id, ai_text, svc.MODEL)
                )
                # Touch updated_at
                execute_write(
                    'UPDATE training.ai_sessions SET updated_at = NOW() WHERE id = %s',
                    (session_id,)
                )

                # Post-stream action extraction
                if svc.might_have_actions(message, ai_text):
                    try:
                        actions = svc.extract_actions(message, ai_text, today_str)
                        food_logged = []
                        if actions.get('food_items'):
                            food_logged += _log_food_items(user_id, actions['food_items'], today_str)
                        if actions.get('food_edits'):
                            food_logged += _edit_food_items(user_id, actions['food_edits'])
                        if food_logged:
                            yield f'data: {json.dumps({"food_logged": food_logged})}\n\n'
                        workout_results = []
                        if actions.get('workout_logs'):
                            workout_results = _handle_workout_logs(user_id, actions['workout_logs'])
                        if workout_results:
                            yield f'data: {json.dumps({"workout_logged": workout_results})}\n\n'
                        proposed = []
                        if actions.get('plan_changes'):
                            proposed += _resolve_plan_changes(user_id, actions['plan_changes'])
                        if actions.get('food_db_corrections'):
                            proposed += _resolve_food_db_corrections(actions['food_db_corrections'])
                        if proposed:
                            yield f'data: {json.dumps({"proposed_actions": proposed})}\n\n'
                        if actions.get('setup_actions'):
                            setup_result = _handle_setup_actions(user_id, actions['setup_actions'])
                            if setup_result:
                                yield f'data: {json.dumps({"setup_done": setup_result})}\n\n'
                    except Exception as ex:
                        log.warning('Action extraction failed: %s', ex)

    return Response(stream_with_context(generate()), content_type='text/event-stream')


@ai_coach_bp.route('/api/ai-coach/sessions/<session_id>/apply-action', methods=['POST'])
@jwt_required()
def apply_action(session_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    # Verify session belongs to user
    session = execute_query(
        'SELECT id FROM training.ai_sessions WHERE id = %s AND user_id = %s',
        (session_id, user_id), fetch_one=True
    )
    if not session:
        raise NotFoundError('Session not found')

    action = data.get('action', {})
    action_type = action.get('type')

    if action_type == 'modify_workout':
        workout_id = action.get('workout_id')
        if not workout_id:
            return jsonify({'error': 'workout_id required'}), 400
        updates = []
        params = []
        if action.get('new_duration_min'):
            updates.append('duration_min = %s')
            params.append(action['new_duration_min'])
        if action.get('new_zone'):
            updates.append('intensity_zone = %s')
            params.append(action['new_zone'])
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        params.extend([workout_id, user_id])
        execute_write(
            f'UPDATE training.workouts SET {", ".join(updates)} WHERE id = %s AND user_id = %s',
            tuple(params)
        )
        return jsonify({'status': 'applied'})

    elif action_type == 'mark_rest_day':
        action_date = action.get('date')
        if not action_date:
            return jsonify({'error': 'date required'}), 400
        execute_write(
            '''UPDATE training.plan_days SET day_type = 'rest', ai_adjusted = TRUE
               WHERE user_id = %s AND date = %s''',
            (user_id, action_date)
        )
        return jsonify({'status': 'applied'})

    elif action_type == 'update_food_db':
        food_id = action.get('food_id')
        nutrients = action.get('nutrients', {})
        if not food_id or not nutrients:
            return jsonify({'error': 'food_id and nutrients required'}), 400

        # Whitelist: only allow updating known nutrient columns
        ALLOWED = {
            'calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g',
            'fiber_per_100g', 'sodium_per_100g', 'iron_per_100g', 'calcium_per_100g',
            'vitamin_d_per_100g', 'vitamin_b12_per_100g', 'vitamin_c_per_100g',
            'magnesium_per_100g', 'potassium_per_100g', 'zinc_per_100g',
        }
        safe = {k: float(v) for k, v in nutrients.items() if k in ALLOWED and v is not None}
        if not safe:
            return jsonify({'error': 'No valid nutrient columns to update'}), 400

        set_clauses = ', '.join(f'{col} = %s' for col in safe)
        params = list(safe.values()) + [food_id]
        execute_write(
            f"UPDATE training.food_database SET {set_clauses}, source = 'user' WHERE id = %s",
            tuple(params)
        )

        # Recalculate food_log entries that reference this food
        log_rows = execute_query(
            'SELECT id, amount_g FROM training.food_log WHERE food_id = %s',
            (food_id,)
        )
        updated_food = execute_query(
            'SELECT * FROM training.food_database WHERE id = %s', (food_id,), fetch_one=True
        )
        if updated_food:
            for lr in log_rows:
                ratio = float(lr['amount_g']) / 100.0
                execute_write(
                    '''UPDATE training.food_log
                       SET calories  = %s, protein_g = %s, carbs_g = %s,
                           fat_g     = %s, fiber_g   = %s
                       WHERE id = %s''',
                    (updated_food['calories_per_100g'] * ratio,
                     updated_food['protein_per_100g'] * ratio,
                     updated_food['carbs_per_100g'] * ratio,
                     updated_food['fat_per_100g'] * ratio,
                     (updated_food['fiber_per_100g'] or 0) * ratio,
                     lr['id'])
                )

        return jsonify({'status': 'applied', 'logs_recalculated': len(list(log_rows))})

    return jsonify({'error': f'Unknown action type: {action_type}'}), 400


# ── helpers ──────────────────────────────────────────────────────────────────

def _fuzzy_match_food(name: str) -> dict | None:
    """Find closest food in food_database by name (case-insensitive substring)."""
    row = execute_query(
        '''SELECT id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
                  fat_per_100g, fiber_per_100g
           FROM training.food_database
           WHERE LOWER(name) LIKE %s
           ORDER BY LENGTH(name) ASC LIMIT 1''',
        (f'%{name.lower()}%',), fetch_one=True
    )
    return dict(row) if row else None


def _find_workout_log(user_id: str, log_date: str, sport: str,
                      duration_hint: float = None) -> dict | None:
    """
    Find a workout_log for user/date/sport.
    If duration_hint is given, pick the closest matching log by duration.
    If multiple logs exist with no hint, pick the most recent.
    """
    rows = execute_query(
        '''SELECT wl.id, wl.actual_duration_min FROM training.workout_logs wl
           LEFT JOIN training.workouts w ON w.id = wl.workout_id
           WHERE wl.user_id = %s AND wl.log_date = %s AND w.sport = %s
           ORDER BY wl.created_at DESC''',
        (user_id, log_date, sport)
    )
    if not rows:
        return None
    if duration_hint and len(rows) > 1:
        # Pick the log whose duration is closest to the hint
        best = min(rows, key=lambda r: abs((r['actual_duration_min'] or 0) - duration_hint))
        return dict(best)
    return dict(rows[0])


def _handle_workout_logs(user_id: str, workout_logs: list) -> list:
    """Add, update, or delete workout_log entries from AI coach instructions."""
    results = []
    SPORT_ALIASES = {
        'swimming': 'swim', 'running': 'run', 'cycling': 'cycle',
        'biking': 'cycle', 'bike': 'cycle', 'strength training': 'strength',
        'gym': 'strength', 'weights': 'strength', 'brick': 'brick',
        'core': 'core', 'walk': 'run',
    }

    for item in workout_logs:
        action = item.get('action', 'add')
        sport_raw = (item.get('sport') or '').lower()
        sport = SPORT_ALIASES.get(sport_raw, sport_raw)
        log_date = item.get('date')
        if not log_date or not sport:
            continue

        if action == 'add':
            # Find a planned workout for this date+sport to link against.
            # Multiple logs may link to the same planned workout (double sessions).
            plan_row = execute_query(
                '''SELECT w.id, w.sport, w.title, w.duration_min
                   FROM training.workouts w
                   JOIN training.plan_days pd ON pd.id = w.plan_day_id
                   WHERE w.user_id = %s AND pd.date = %s AND w.sport = %s
                   LIMIT 1''',
                (user_id, log_date, sport), fetch_one=True
            )
            workout_id = str(plan_row['id']) if plan_row else None

            execute_write(
                '''INSERT INTO training.workout_logs
                     (user_id, workout_id, log_date, source,
                      actual_duration_min, actual_distance_km,
                      avg_hr, max_hr, avg_power_watts, calories_burned,
                      perceived_effort, notes)
                   VALUES (%s, %s, %s::date, 'manual', %s, %s, %s, %s, %s, %s, %s, %s)''',
                (user_id, workout_id, log_date,
                 item.get('actual_duration_min'), item.get('actual_distance_km'),
                 item.get('avg_hr'), item.get('max_hr'),
                 item.get('avg_power_watts'), item.get('calories_burned'),
                 item.get('perceived_effort'), item.get('notes'))
            )
            label = plan_row['title'] if plan_row else sport
            log.info('AI logged workout: %s %s for user %s', sport, log_date, user_id)
            results.append({'action': 'added', 'sport': sport, 'date': log_date,
                            'title': label,
                            'duration_min': item.get('actual_duration_min')})

        elif action == 'update':
            duration_hint = item.get('duration_hint')
            existing = _find_workout_log(user_id, log_date, sport, duration_hint)
            if not existing:
                results.append({'action': 'not_found', 'sport': sport, 'date': log_date})
                continue

            updates = {k: item[k] for k in (
                'actual_duration_min', 'actual_distance_km', 'avg_hr',
                'max_hr', 'avg_power_watts', 'calories_burned', 'perceived_effort', 'notes'
            ) if item.get(k) is not None}
            if updates:
                set_clause = ', '.join(f'{col} = %s' for col in updates)
                execute_write(
                    f'UPDATE training.workout_logs SET {set_clause}, updated_at = NOW() WHERE id = %s',
                    list(updates.values()) + [existing['id']]
                )
            log.info('AI updated workout log %s for user %s', existing['id'], user_id)
            results.append({'action': 'updated', 'sport': sport, 'date': log_date, **updates})

        elif action == 'delete':
            duration_hint = item.get('duration_hint')
            existing = _find_workout_log(user_id, log_date, sport, duration_hint)
            if existing:
                execute_write('DELETE FROM training.workout_logs WHERE id = %s', (existing['id'],))
                log.info('AI deleted workout log %s for user %s', existing['id'], user_id)
                results.append({'action': 'deleted', 'sport': sport, 'date': log_date})
            else:
                results.append({'action': 'not_found', 'sport': sport, 'date': log_date})

    return results


def _log_food_items(user_id: str, food_items: list, log_date: str) -> list:
    logged = []
    for item in food_items:
        name = item.get('name', '')
        amount_g = float(item.get('amount_g') or 100)
        meal_type = item.get('meal_type', 'snack')
        if meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout'):
            meal_type = 'snack'

        food = _fuzzy_match_food(name)

        # If not in DB but extraction provided per_100g estimates, insert it now
        if not food and item.get('per_100g'):
            _ALLOWED_COLS = {
                'calories_per_100g', 'protein_per_100g', 'carbs_per_100g',
                'fat_per_100g', 'fiber_per_100g', 'sodium_per_100g',
            }
            safe = {k: float(v) for k, v in item['per_100g'].items()
                    if k in _ALLOWED_COLS and v is not None}
            if safe.get('calories_per_100g'):
                cols = ['name', 'source'] + list(safe.keys())
                vals = [name, 'ai_estimate'] + list(safe.values())
                placeholders = ', '.join(['%s'] * len(vals))
                new_row = execute_write(
                    f"INSERT INTO training.food_database ({', '.join(cols)}) "
                    f"VALUES ({placeholders}) RETURNING *",
                    vals, returning=True
                )
                if new_row:
                    food = dict(new_row)
                    log.info('Inserted AI-estimated food "%s" id=%s', name, food.get('id'))

        if food:
            factor = amount_g / 100.0
            cal   = float(food['calories_per_100g'] or 0) * factor
            prot  = float(food['protein_per_100g']  or 0) * factor
            carb  = float(food['carbs_per_100g']    or 0) * factor
            fat   = float(food['fat_per_100g']      or 0) * factor
            fiber = float(food['fiber_per_100g']    or 0) * factor
            execute_write(
                '''INSERT INTO training.food_log
                     (user_id, log_date, meal_type, food_id, food_name, amount_g,
                      calories, protein_g, carbs_g, fat_g, fiber_g)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
                (user_id, log_date, meal_type, food['id'], food['name'], amount_g,
                 cal, prot, carb, fat, fiber)
            )
            logged.append({
                'name': food['name'],
                'amount_g': amount_g,
                'meal_type': meal_type,
                'calories': round(cal),
            })
        else:
            # No DB match and no AI estimates — log with zero macros, user can correct
            execute_write(
                '''INSERT INTO training.food_log
                     (user_id, log_date, meal_type, food_name, amount_g,
                      calories, protein_g, carbs_g, fat_g, fiber_g)
                   VALUES (%s, %s, %s, %s, %s, 0, 0, 0, 0, 0)''',
                (user_id, log_date, meal_type, name, amount_g)
            )
            logged.append({
                'name': name,
                'amount_g': amount_g,
                'meal_type': meal_type,
                'calories': 0,
                'unknown': True,
            })
    return logged


def _edit_food_items(user_id: str, food_edits: list) -> list:
    """Apply UPDATE or DELETE to existing food_log entries by fuzzy name + date."""
    results = []
    for edit in food_edits:
        action = edit.get('action')
        food_name = edit.get('food_name', '')
        log_date = edit.get('log_date')
        if not food_name or not log_date:
            continue

        # Find the food_log row (most recent on that date matching name)
        row = execute_query(
            '''SELECT id, food_name, amount_g, calories, protein_g, carbs_g, fat_g
               FROM training.food_log
               WHERE user_id = %s AND log_date = %s AND LOWER(food_name) LIKE %s
               ORDER BY id DESC LIMIT 1''',
            (user_id, log_date, f'%{food_name.lower()}%'), fetch_one=True
        )
        if not row:
            results.append({'name': food_name, 'log_date': log_date, 'action': action, 'notFound': True})
            continue

        if action == 'delete':
            execute_write('DELETE FROM training.food_log WHERE id = %s AND user_id = %s',
                          (row['id'], user_id))
            results.append({'name': row['food_name'], 'log_date': log_date, 'action': 'deleted'})

        elif action == 'update':
            new_amount = float(edit.get('new_amount_g') or row['amount_g'])
            old_amount = float(row['amount_g']) if row['amount_g'] else 100.0
            factor = new_amount / old_amount if old_amount else 1.0
            execute_write(
                '''UPDATE training.food_log
                   SET amount_g = %s,
                       calories = %s,
                       protein_g = %s,
                       carbs_g = %s,
                       fat_g = %s
                   WHERE id = %s AND user_id = %s''',
                (new_amount,
                 (row['calories'] or 0) * factor,
                 (row['protein_g'] or 0) * factor,
                 (row['carbs_g'] or 0) * factor,
                 (row['fat_g'] or 0) * factor,
                 row['id'], user_id)
            )
            results.append({
                'name': row['food_name'],
                'log_date': log_date,
                'action': 'updated',
                'amount_g': new_amount,
                'calories': round((row['calories'] or 0) * factor),
            })
    return results


def _resolve_food_db_corrections(corrections: list) -> list:
    """Look up current DB values so the frontend can show old→new diff."""
    ALLOWED = {
        'calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g',
        'fiber_per_100g', 'sodium_per_100g', 'iron_per_100g', 'calcium_per_100g',
        'vitamin_d_per_100g', 'vitamin_b12_per_100g', 'vitamin_c_per_100g',
        'magnesium_per_100g', 'potassium_per_100g', 'zinc_per_100g',
    }
    resolved = []
    for c in corrections:
        food_name = c.get('food_name', '')
        nutrients = {k: float(v) for k, v in (c.get('nutrients') or {}).items() if k in ALLOWED}
        if not food_name or not nutrients:
            continue
        food = execute_query(
            '''SELECT id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
                      fat_per_100g, fiber_per_100g, sodium_per_100g, source
               FROM training.food_database
               WHERE LOWER(name) LIKE %s
               ORDER BY LENGTH(name) ASC LIMIT 1''',
            (f'%{food_name.lower()}%',), fetch_one=True
        )
        if not food:
            continue
        # Build old/new diff only for nutrients being changed
        diff = {}
        for col, new_val in nutrients.items():
            old_val = float(food.get(col) or 0)
            diff[col] = {'old': old_val, 'new': new_val}

        resolved.append({
            'type': 'update_food_db',
            'food_id': food['id'],
            'food_name': food['name'],
            'description': c.get('description', f'Correct {food["name"]} per-100g values from food label'),
            'nutrients': nutrients,
            'diff': diff,
        })
    return resolved


def _handle_setup_actions(user_id: str, setup_actions) -> list:
    """Handle update_profile, create_goal, and generate_plan actions from AI coach.
    Accepts either a list of {type, ...} objects or a dict keyed by action type.
    """
    from app.services.plan_engine import generate_plan as _gen_plan

    # Normalise: model sometimes returns a dict instead of a list
    if isinstance(setup_actions, dict):
        normalised = []
        for atype, fields in setup_actions.items():
            if isinstance(fields, dict):
                normalised.append({'type': atype, **fields})
            else:
                normalised.append({'type': atype})
        setup_actions = normalised

    # Field aliases the model may use → canonical DB column names
    _ALIASES = {
        'available_hours_per_week': 'current_weekly_hours',
        'weekly_hours': 'current_weekly_hours',
        'weekly_training_hours': 'current_weekly_hours',
        'resting_heart_rate': 'resting_hr',
        'max_heart_rate': 'max_hr',
    }

    results = []
    goal_id = None

    for action in setup_actions:
        # Apply aliases
        action = {_ALIASES.get(k, k): v for k, v in action.items()}
        atype = action.get('type')
        atype = action.get('type')

        if atype == 'update_profile':
            _NUMERIC = {'weight_kg', 'height_cm', 'resting_hr', 'max_hr', 'ftp_watts',
                        'css_per_100m', 'running_threshold_pace_sec_km',
                        'current_weekly_hours', 'vo2max_estimate'}
            _TEXT = {'gender', 'fitness_level', 'date_of_birth'}
            col_vals = {}
            for k, v in action.items():
                if k == 'type' or v is None or v == '':
                    continue
                if k in _NUMERIC:
                    try:
                        col_vals[k] = float(v)
                    except (ValueError, TypeError):
                        pass
                elif k in _TEXT:
                    col_vals[k] = str(v)
            if not col_vals:
                continue
            existing = execute_query(
                'SELECT user_id FROM training.profiles WHERE user_id = %s',
                (user_id,), fetch_one=True
            )
            if existing:
                sets = ', '.join(f'{k}=%s' for k in col_vals)
                execute_write(
                    f'UPDATE training.profiles SET {sets} WHERE user_id=%s',
                    list(col_vals.values()) + [user_id]
                )
            else:
                cols = ', '.join(['user_id'] + list(col_vals.keys()))
                phs = ', '.join(['%s'] * (1 + len(col_vals)))
                execute_write(
                    f'INSERT INTO training.profiles ({cols}) VALUES ({phs})',
                    [user_id] + list(col_vals.values())
                )
            results.append({'type': 'profile_updated', 'fields': list(col_vals.keys())})
            log.info('AI setup: profile updated for %s: %s', user_id, list(col_vals.keys()))

        elif atype == 'create_goal':
            goal_type = action.get('goal_type', '')
            goal_name = action.get('goal_name', goal_type.replace('_', ' ').title())
            target_date = action.get('target_date', '')
            if not goal_type or not target_date:
                continue
            # Deactivate old goals
            execute_write(
                "UPDATE training.goals SET status='paused' WHERE user_id=%s AND status='active'",
                (user_id,)
            )
            row = execute_write(
                '''INSERT INTO training.goals
                     (user_id, goal_type, goal_name, target_date, event_name, status)
                   VALUES (%s, %s, %s, %s::date, %s, 'active') RETURNING id''',
                (user_id, goal_type, goal_name,
                 target_date, action.get('event_name', '')),
                returning=True
            )
            goal_id = str(row['id']) if row else None
            results.append({'type': 'goal_created', 'goal_id': goal_id,
                            'goal_type': goal_type, 'target_date': target_date})
            log.info('AI setup: goal created for %s: %s %s', user_id, goal_type, target_date)

        elif atype == 'generate_plan':
            # Use newly created goal_id or fetch the active one
            if not goal_id:
                g_row = execute_query(
                    "SELECT id FROM training.goals WHERE user_id=%s AND status='active' ORDER BY created_at DESC LIMIT 1",
                    (user_id,), fetch_one=True
                )
                goal_id = str(g_row['id']) if g_row else None
            if not goal_id:
                results.append({'type': 'plan_error', 'reason': 'no active goal'})
                continue
            goal_row = execute_query(
                'SELECT * FROM training.goals WHERE id=%s AND user_id=%s',
                (goal_id, user_id), fetch_one=True
            )
            profile_row = execute_query(
                'SELECT * FROM training.profiles WHERE user_id=%s', (user_id,), fetch_one=True
            )
            if not goal_row:
                results.append({'type': 'plan_error', 'reason': 'goal not found'})
                continue
            # Delete existing plan for this goal
            execute_write(
                'DELETE FROM training.training_plans WHERE goal_id=%s AND user_id=%s',
                (goal_id, user_id)
            )
            plan_data = _gen_plan(dict(goal_row), dict(profile_row) if profile_row else {})
            plan_row = execute_write(
                '''INSERT INTO training.training_plans (user_id, goal_id, plan_start_date, plan_end_date)
                   VALUES (%s, %s, %s::date, %s::date) RETURNING id''',
                (user_id, goal_id,
                 plan_data['days'][0]['date'] if plan_data['days'] else str(goal_row['target_date']),
                 str(goal_row['target_date'])),
                returning=True
            )
            plan_id = str(plan_row['id'])
            for w in plan_data['weeks']:
                execute_write(
                    '''INSERT INTO training.plan_weeks
                         (plan_id, user_id, week_number, week_start, block_type,
                          weekly_hours_target, weekly_tss_target)
                       VALUES (%s, %s, %s, %s::date, %s, %s, %s)''',
                    (plan_id, user_id, w['week_number'], w['week_start'],
                     w['block_type'], w['weekly_hours_target'], w['weekly_tss_target'])
                )
            db = get_db()
            day_id_map = {}
            for d in plan_data['days']:
                with db.cursor() as cur:
                    cur.execute(
                        '''INSERT INTO training.plan_days
                             (plan_id, user_id, date, day_type, ai_adjusted)
                           VALUES (%s, %s, %s::date, %s, %s) RETURNING id''',
                        (plan_id, user_id, d['date'], d['day_type'], False)
                    )
                    day_id_map[d['date']] = str(cur.fetchone()['id'])
                db.commit()
            for wo in plan_data['workouts']:
                workout_date = wo.pop('_workout_date', None)
                day_id = day_id_map.get(workout_date)
                if not day_id:
                    continue
                cols = ['plan_day_id', 'user_id'] + [k for k in wo if k != '_workout_date']
                vals = [day_id, user_id] + [wo[k] for k in wo if k != '_workout_date']
                phs = ', '.join(['%s'] * len(vals))
                execute_write(
                    f'INSERT INTO training.workouts ({", ".join(cols)}) VALUES ({phs})',
                    vals
                )
            weeks = len(plan_data['weeks'])
            results.append({'type': 'plan_generated', 'plan_id': plan_id, 'weeks': weeks})
            log.info('AI setup: plan generated for %s, %d weeks', user_id, weeks)

    return results


def _resolve_plan_changes(user_id: str, plan_changes: list) -> list:
    """Attach workout_id from DB for modify_workout changes where date is known."""
    resolved = []
    for change in plan_changes:
        c = dict(change)
        if c.get('type') == 'modify_workout' and c.get('date') and not c.get('workout_id'):
            # Find the first workout on that date for this user
            row = execute_query(
                '''SELECT w.id, w.sport, w.title, w.duration_min
                   FROM training.workouts w
                   JOIN training.plan_days pd ON pd.id = w.plan_day_id
                   WHERE w.user_id = %s AND pd.date = %s
                   ORDER BY w.sport LIMIT 1''',
                (user_id, c['date']), fetch_one=True
            )
            if row:
                c['workout_id'] = str(row['id'])
                c['workout_title'] = row['title']
        resolved.append(c)
    return resolved
