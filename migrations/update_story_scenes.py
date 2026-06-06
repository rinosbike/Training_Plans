"""
Updates scene descriptions and overlays to match the app-only story direction.
Run: python3 migrations/update_story_scenes.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv()
import psycopg2
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect(os.environ['DATABASE_URL'], cursor_factory=RealDictCursor)
conn.autocommit = False
cur = conn.cursor()

cur.execute("SELECT id FROM training.content_stories WHERE title = %s", ("1 Month. 0 Excuses.",))
story = cur.fetchone()
if not story:
    print("Story not found"); sys.exit(1)
story_id = str(story['id'])

SCENES = [
    {
        "position": 1,
        "description": "Dashboard overview — training plan for the week laid out. Shows the structure: swim, bike, run sessions planned. First impression of the app.",
        "overlay_text": "1 month. Built from scratch.",
        "duration_sec": 3,
    },
    {
        "position": 2,
        "description": "Workout detail page — full view of a session: TSS score, zone breakdown, load contribution to fitness curve. The data behind every single session.",
        "overlay_text": "Every session. Quantified.",
        "duration_sec": 5,
    },
    {
        "position": 3,
        "description": "Progress page — the fitness/fatigue/form chart showing CTL rising over the month. The upward trend is the story. Let it breathe.",
        "overlay_text": "Fitness is math. The numbers don't lie.",
        "duration_sec": 9,
    },
    {
        "position": 4,
        "description": "AI Coach page — an actual coaching conversation. The AI analysing load, suggesting recovery, adjusting the plan. Not generic — specific to your data.",
        "overlay_text": "Your coach. Always on.",
        "duration_sec": 6,
    },
    {
        "position": 5,
        "description": "Nutrition / food log — macro tracking tied to training load. Recovery starts with what you eat. The app connects the dots.",
        "overlay_text": "Train hard. Recover smarter.",
        "duration_sec": 5,
    },
    {
        "position": 6,
        "description": "Back to the dashboard — the week ahead, planned and ready. End on the forward-looking view. This is just the beginning.",
        "overlay_text": "Seek discomfort. The data will follow.",
        "duration_sec": 7,
    },
]

cur.execute("SELECT id, position FROM training.content_scenes WHERE story_id = %s ORDER BY position", (story_id,))
db_scenes = {r['position']: str(r['id']) for r in cur.fetchall()}

for s in SCENES:
    scene_id = db_scenes.get(s['position'])
    if not scene_id:
        continue
    cur.execute("""
        UPDATE training.content_scenes
        SET description = %s, overlay_text = %s, duration_sec = %s
        WHERE id = %s
    """, (s['description'], s['overlay_text'], s['duration_sec'], scene_id))
    print(f"Scene {s['position']}: {s['overlay_text']}")

conn.commit()
cur.close()
conn.close()
print("Scenes updated.")
