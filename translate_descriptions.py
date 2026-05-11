"""One-shot script to translate all workout descriptions to DE/ZH/PL/ES."""
import os, sys, json, time
import psycopg2
import psycopg2.extras
import requests

# Load .env for Copilot token
for line in open('/home/app/training-plans/.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# erp_app has BYPASSRLS for this backfill run
ADMIN_DB = 'postgresql://erp_app:b8LZdZdH3hM0dAEaAa4pGwvaoRQMs9PcF30OvP5wpmA@localhost:5432/neondb'
COPILOT_TOKEN = os.environ.get('GITHUB_COPILOT_TOKEN', '')
API_URL = 'https://api.githubcopilot.com/chat/completions'
MODEL = 'claude-sonnet-4.6'
BATCH = 6

conn = psycopg2.connect(ADMIN_DB)
conn.autocommit = False
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

cur.execute("""
    SELECT id, description FROM training.workouts
    WHERE description IS NOT NULL AND description != ''
      AND (description_translations IS NULL OR description_translations = '{}'::jsonb)
    ORDER BY id
""")
rows = cur.fetchall()
print(f"Found {len(rows)} workouts to translate")

if not rows:
    print("Nothing to do.")
    sys.exit(0)


def translate_batch(descs):
    prompt = (
        'You are a sports training translator. Translate each numbered description to '
        'German (de), Chinese Simplified (zh), Polish (pl), and Spanish (es). '
        'Preserve all numbers, pace values (e.g. 5:30/km), watt values (e.g. 150-180 W), '
        'distances, rep counts (e.g. 3×10), and training terms exactly. '
        'Return ONLY valid JSON, no markdown, no explanation.\n\n'
        'Format: {"0": {"de": "...", "zh": "...", "pl": "...", "es": "..."}, "1": {...}}\n\n'
        'Descriptions:\n' +
        '\n'.join(f'{j}: {json.dumps(d)}' for j, d in descs.items())
    )
    resp = requests.post(API_URL, headers={
        'Authorization': f'Bearer {COPILOT_TOKEN}',
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
    }, json={
        'model': MODEL,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        'max_tokens': 6000,
    }, timeout=90)
    resp.raise_for_status()
    content = resp.json()['choices'][0]['message']['content'].strip()
    if content.startswith('```'):
        content = content.split('\n', 1)[1].rsplit('```', 1)[0]
    return json.loads(content)


total = 0
errors = []
batches = (len(rows) + BATCH - 1) // BATCH

for i in range(0, len(rows), BATCH):
    chunk = rows[i:i + BATCH]
    desc_map = {str(j): row['description'] for j, row in enumerate(chunk)}
    print(f"  Batch {i//BATCH + 1}/{batches} ({len(chunk)} items)...", end=' ', flush=True)
    try:
        translations = translate_batch(desc_map)
        for j, row in enumerate(chunk):
            t = translations.get(str(j), {})
            if t:
                cur.execute(
                    "UPDATE training.workouts SET description_translations = %s WHERE id = %s",
                    (json.dumps({'de': t.get('de', ''), 'zh': t.get('zh', ''),
                                 'pl': t.get('pl', ''), 'es': t.get('es', '')}),
                     str(row['id']))
                )
                total += 1
        conn.commit()
        print(f"OK ({total} total)")
    except Exception as e:
        conn.rollback()
        errors.append(f"Batch {i//BATCH + 1}: {e}")
        print(f"ERROR: {e}")
    time.sleep(0.3)

cur.close()
conn.close()
print(f"\nDone. Translated: {total}, Errors: {len(errors)}")
for e in errors:
    print(f"  {e}")
