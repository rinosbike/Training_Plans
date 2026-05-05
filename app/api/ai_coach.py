import json
import logging
from datetime import date, datetime
from flask import Blueprint, request, jsonify, Response, stream_with_context
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
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
    today_str = date.today().isoformat()
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

    history = execute_query(
        '''SELECT role, content FROM training.ai_messages
           WHERE session_id = %s AND user_id = %s
           ORDER BY created_at DESC LIMIT 20''',
        (session_id, user_id)
    )
    history_msgs = [{'role': r['role'], 'content': r['content']} for r in reversed(list(history))]

    system_prompt = svc.build_system_prompt(
        user, goal, profile, day_context, weekly_workouts, today_nutrition
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
                        if actions.get('plan_changes'):
                            proposed = _resolve_plan_changes(user_id, actions['plan_changes'])
                            if proposed:
                                yield f'data: {json.dumps({"proposed_actions": proposed})}\n\n'
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
        # Find the plan_day for this date and update day_type
        execute_write(
            '''UPDATE training.plan_days SET day_type = 'rest', ai_adjusted = TRUE
               WHERE user_id = %s AND date = %s''',
            (user_id, action_date)
        )
        return jsonify({'status': 'applied'})

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


def _log_food_items(user_id: str, food_items: list, log_date: str) -> list:
    logged = []
    for item in food_items:
        name = item.get('name', '')
        amount_g = float(item.get('amount_g') or 100)
        meal_type = item.get('meal_type', 'snack')
        if meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout'):
            meal_type = 'snack'

        food = _fuzzy_match_food(name)
        if food:
            factor = amount_g / 100.0
            execute_write(
                '''INSERT INTO training.food_log
                     (user_id, log_date, meal_type, food_id, food_name, amount_g,
                      calories, protein_g, carbs_g, fat_g, fiber_g)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
                (user_id, log_date, meal_type, food['id'], food['name'], amount_g,
                 food['calories_per_100g'] * factor,
                 food['protein_per_100g'] * factor,
                 food['carbs_per_100g'] * factor,
                 food['fat_per_100g'] * factor,
                 (food['fiber_per_100g'] or 0) * factor)
            )
            logged.append({
                'name': food['name'],
                'amount_g': amount_g,
                'meal_type': meal_type,
                'calories': round(food['calories_per_100g'] * factor),
            })
        else:
            # Log with zero macros but record the name (user can edit later)
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
