import json
from flask import Blueprint, request, jsonify, Response, stream_with_context, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.services import ai_coach_service as svc
from app.exceptions import NotFoundError

ai_coach_bp = Blueprint('ai_coach', __name__)


@ai_coach_bp.route('/api/ai-coach/sessions', methods=['POST'])
@jwt_required()
def create_session():
    user_id = get_jwt_identity()
    data = request.get_json()
    goal_id = data.get('goal_id')
    row = execute_write(
        'INSERT INTO training.ai_sessions (user_id, goal_id) VALUES (%s, %s) RETURNING *',
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
    data = request.get_json()
    message = data.get('message', '').strip()
    model = data.get('model', 'gpt-4o')
    day_context = data.get('day_context')  # optional: {date, day_type, block_type, workouts}

    if not message:
        return jsonify({'error': 'message required'}), 400

    session = execute_query(
        'SELECT * FROM training.ai_sessions WHERE id = %s AND user_id = %s',
        (session_id, user_id), fetch_one=True
    )
    if not session:
        raise NotFoundError('Session not found')

    # Load context
    goal = {}
    if session['goal_id']:
        g_row = execute_query(
            'SELECT * FROM training.goals WHERE id = %s', (session['goal_id'],), fetch_one=True
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

    # Build message history
    history = execute_query(
        '''SELECT role, content FROM training.ai_messages
           WHERE session_id = %s ORDER BY created_at DESC LIMIT 20''',
        (session_id,)
    )
    history_msgs = [{'role': r['role'], 'content': r['content']} for r in reversed(list(history))]

    system_prompt = svc.build_system_prompt(user, goal, profile, day_context)
    messages = [{'role': 'system', 'content': system_prompt}] + history_msgs + \
               [{'role': 'user', 'content': message}]

    # Save user message
    execute_write(
        '''INSERT INTO training.ai_messages (session_id, user_id, role, content, model)
           VALUES (%s, %s, 'user', %s, %s)''',
        (session_id, user_id, message, model)
    )

    def generate():
        full_response = []
        try:
            for line in svc.chat_stream(messages, model):
                token = svc.parse_sse_chunk(line)
                if token:
                    full_response.append(token)
                    yield f'data: {json.dumps({"token": token})}\n\n'
            yield 'data: [DONE]\n\n'
        except svc.CopilotAPIError as e:
            yield f'data: {json.dumps({"error": e.message})}\n\n'
            return
        finally:
            if full_response:
                assistant_content = ''.join(full_response)
                execute_write(
                    '''INSERT INTO training.ai_messages
                         (session_id, user_id, role, content, model)
                       VALUES (%s, %s, 'assistant', %s, %s)''',
                    (session_id, user_id, assistant_content, model)
                )

    return Response(stream_with_context(generate()), content_type='text/event-stream')
