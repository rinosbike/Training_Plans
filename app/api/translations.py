"""
Admin-only translations endpoint.
Auto-translates missing locale keys using the Copilot API, one namespace at a time.
"""
import re
import json
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query
from app.services import ai_coach_service as svc

translations_bp = Blueprint('translations', __name__)
log = logging.getLogger(__name__)


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
    'es': 'Spanish',
}

SYSTEM_PROMPT = (
    'You are a professional UI translator. Translate English app strings to {lang_name}.\n'
    'Rules:\n'
    '1. Keep {{variable}} placeholders exactly as-is (e.g. {{count}}, {{provider}}, {{date}})\n'
    '2. Keep emoji, ✓, ✗, →, ← and other symbols exactly as-is\n'
    '3. Keep unit strings like "kcal", "bpm", "kg" exactly as-is\n'
    '4. Match the tone: short, friendly, professional UI text\n'
    '5. Flat key-value JSON input → flat key-value JSON output (same keys, translated values)\n'
    '6. Return ONLY the JSON object — no explanation, no markdown code fences'
)


def _extract_json(text: str) -> dict:
    """Extract a JSON object from model output, handling markdown fences."""
    text = text.strip()
    # Remove ```json ... ``` or ``` ... ``` fences
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()
    return json.loads(text)


def _flatten(obj: dict, prefix: str = '') -> dict:
    """Flatten nested dict to dotted keys."""
    out = {}
    for k, v in obj.items():
        full = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            out.update(_flatten(v, full))
        else:
            out[full] = v
    return out


def _translate_namespace(ns: str, keys: dict, lang_name: str) -> dict:
    """Translate one namespace's flat key→value dict. Returns translated flat dict."""
    if not keys:
        return {}

    keys_json = json.dumps(keys, ensure_ascii=False, indent=2)
    messages = [
        {
            'role': 'system',
            'content': SYSTEM_PROMPT.format(lang_name=lang_name),
        },
        {
            'role': 'user',
            'content': (
                f'Namespace: {ns}\n'
                f'Translate these English UI strings to {lang_name}.\n'
                f'Return a JSON object with the same keys and translated values:\n\n'
                f'{keys_json}'
            ),
        },
    ]
    # Allow up to 4096 tokens for larger namespaces
    result_text, _ = svc.chat_complete(messages, max_tokens=4096)
    return _extract_json(result_text)


@translations_bp.route('/api/translations/auto-translate', methods=['POST'])
@jwt_required()
def auto_translate():
    user_id = get_jwt_identity()
    if not _is_admin(user_id):
        return jsonify({'error': 'Admin only'}), 403

    data = request.get_json() or {}
    lang = data.get('lang', '')
    namespaces = data.get('namespaces', {})  # { ns: { dotted_key: english_value } }

    if lang not in LANG_NAMES:
        return jsonify({'error': f'Unsupported language: {lang}'}), 400
    if not namespaces:
        return jsonify({}), 200

    lang_name = LANG_NAMES[lang]
    results = {}
    errors = {}

    for ns, keys in namespaces.items():
        if not keys:
            continue
        try:
            translated = _translate_namespace(ns, keys, lang_name)
            results[ns] = translated
        except json.JSONDecodeError as e:
            log.error('Translation JSON parse error for ns=%s: %s', ns, e)
            errors[ns] = f'Model returned invalid JSON: {e}'
        except svc.CopilotAPIError as e:
            log.error('Copilot API error for ns=%s: %s', ns, e.message)
            errors[ns] = e.message
        except Exception as e:
            log.error('Translation error for ns=%s: %s', ns, e)
            errors[ns] = str(e)

    response = {'translated': results}
    if errors:
        response['errors'] = errors

    return jsonify(response)
