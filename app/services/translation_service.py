"""
Background translation of workout descriptions.
Called after plan generation — runs in a daemon thread so it never blocks the response.
"""
import os
import json
import time
import logging
import threading
import psycopg2
import psycopg2.extras
import requests

log = logging.getLogger(__name__)

COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions'
MODEL = 'claude-sonnet-4.6'
BATCH = 6


def _translate_batch(descs: dict, token: str) -> dict:
    prompt = (
        'You are a sports training translator. Translate each numbered description to '
        'German (de), Chinese Simplified (zh), Polish (pl), and Spanish (es). '
        'Preserve all numbers, pace values (e.g. 5:30/km), watt values, distances, '
        'rep counts (e.g. 3×10), and training terms exactly. '
        'Return ONLY valid JSON, no markdown, no explanation.\n\n'
        'Format: {"0": {"de": "...", "zh": "...", "pl": "...", "es": "..."}, "1": {...}}\n\n'
        'Descriptions:\n' +
        '\n'.join(f'{j}: {json.dumps(d)}' for j, d in descs.items())
    )
    resp = requests.post(COPILOT_API_URL, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
    }, json={
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        'max_tokens': 6000,
    }, timeout=120)
    resp.raise_for_status()
    content = resp.json()['choices'][0]['message']['content'].strip()
    if content.startswith('```'):
        content = content.split('\n', 1)[1].rsplit('```', 1)[0]
    return json.loads(content)


def _run(user_id: str, plan_id: str, db_url: str, token: str):
    """Translate all descriptions for a newly generated plan. Runs in a background thread."""
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Set RLS context so erp_app can see this user's rows
        cur.execute("SELECT set_config('training.current_user_id', %s, false)", (user_id,))

        cur.execute("""
            SELECT w.id, w.description
            FROM training.workouts w
            JOIN training.plan_days pd ON pd.id = w.plan_day_id
            WHERE pd.plan_id = %s
              AND w.user_id = %s
              AND w.description IS NOT NULL
              AND w.description != ''
              AND (w.description_translations IS NULL OR w.description_translations = '{}'::jsonb)
        """, (plan_id, user_id))
        rows = cur.fetchall()

        if not rows:
            cur.close()
            conn.close()
            return

        log.info('Translating %d workout descriptions for plan %s', len(rows), plan_id)

        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            desc_map = {str(j): row['description'] for j, row in enumerate(chunk)}
            try:
                translations = _translate_batch(desc_map, token)
                for j, row in enumerate(chunk):
                    t = translations.get(str(j), {})
                    if t:
                        cur.execute(
                            "UPDATE training.workouts SET description_translations = %s WHERE id = %s",
                            (json.dumps({'de': t.get('de', ''), 'zh': t.get('zh', ''),
                                         'pl': t.get('pl', ''), 'es': t.get('es', '')}),
                             str(row['id']))
                        )
                conn.commit()
            except Exception as e:
                conn.rollback()
                log.warning('Translation batch %d failed: %s', i // BATCH, e)
            time.sleep(0.3)

        cur.close()
        conn.close()
        log.info('Translation complete for plan %s', plan_id)
    except Exception as e:
        log.error('Translation thread error for plan %s: %s', plan_id, e)


def translate_plan_async(user_id: str, plan_id: str):
    """Kick off background translation for a newly created plan."""
    token = os.getenv('GITHUB_COPILOT_TOKEN', '')
    db_url = os.getenv('DATABASE_URL', '')
    if not token or not db_url:
        return
    t = threading.Thread(
        target=_run, args=(user_id, plan_id, db_url, token), daemon=True
    )
    t.start()
