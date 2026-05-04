"""
Admin-only translations endpoint.
Auto-translates missing locale keys using the Copilot API.
"""
import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query
from app.services import ai_coach_service as svc

translations_bp = Blueprint('translations', __name__)


def _is_admin(user_id: str) -> bool:
    row = execute_query(
        'SELECT is_admin FROM training.users WHERE id = %s',
        (user_id,), fetch_one=True
    )
    return bool(row and row.get('is_admin'))


LANG_NAMES = {
    'de': 'German',
    'pl': 'Polish',
    'zh': 'Chinese (Simplified)',
}


@translations_bp.route('/api/translations/auto-translate', methods=['POST'])
@jwt_required()
def auto_translate():
    user_id = get_jwt_identity()
    if not _is_admin(user_id):
        return jsonify({'error': 'Admin only'}), 403

    data = request.get_json() or {}
    lang = data.get('lang', '')
    namespaces = data.get('namespaces', {})  # { ns: { key: english_value } }

    if lang not in LANG_NAMES:
        return jsonify({'error': f'Unsupported lang: {lang}'}), 400
    if not namespaces:
        return jsonify({}), 200

    lang_name = LANG_NAMES[lang]

    # Build a single prompt with all keys to translate
    keys_text = json.dumps(namespaces, ensure_ascii=False, indent=2)

    messages = [
        {
            'role': 'system',
            'content': (
                f'You are a professional translator. Translate English UI strings to {lang_name}. '
                'Rules:\n'
                '- Keep {{variable}} placeholders exactly as-is\n'
                '- Keep ✓ ✗ → ← and emoji as-is\n'
                '- Match the tone (UI text is short, friendly, professional)\n'
                '- Return ONLY valid JSON, no explanation\n'
                '- Output structure must match input structure exactly'
            )
        },
        {
            'role': 'user',
            'content': (
                f'Translate these English UI strings to {lang_name}. '
                f'Return JSON with the same structure:\n{keys_text}'
            )
        }
    ]

    try:
        result_text, _ = svc.chat_complete(messages)
        # Extract JSON from response (model may wrap in markdown)
        result_text = result_text.strip()
        if result_text.startswith('```'):
            lines = result_text.split('\n')
            result_text = '\n'.join(l for l in lines if not l.startswith('```'))
        translated = json.loads(result_text)
        return jsonify(translated)
    except json.JSONDecodeError:
        return jsonify({'error': 'Model returned invalid JSON'}), 500
    except svc.CopilotAPIError as e:
        return jsonify({'error': str(e.message)}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500
