"""
One-time seeder: creates the agreed Instagram Reel story with 6 scenes.
Run as: python3 migrations/seed_content_story.py

Safe to run multiple times — skips creation if story with same title exists.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv()

import psycopg2
import psycopg2.extras
from psycopg2.extras import RealDictCursor
import json

conn = psycopg2.connect(os.environ['DATABASE_URL'], cursor_factory=RealDictCursor)
conn.autocommit = False
cur = conn.cursor()

TITLE = "1 Month. 0 Excuses."

# Find admin user
cur.execute("SELECT id FROM training.users WHERE role IN ('admin','super_admin') ORDER BY created_at LIMIT 1")
user = cur.fetchone()
if not user:
    print("ERROR: no admin user found")
    sys.exit(1)
user_id = str(user['id'])

# Skip if already exists
cur.execute("SELECT id FROM training.content_stories WHERE title = %s", (TITLE,))
if cur.fetchone():
    print(f"Story '{TITLE}' already exists — skipping.")
    conn.close()
    sys.exit(0)

# Create story
cur.execute("""
    INSERT INTO training.content_stories (user_id, title, theme, goal, status)
    VALUES (%s, %s, %s, %s, 'draft')
    RETURNING id
""", (
    user_id,
    TITLE,
    "After 1 month of building a fitness app + training — getting stronger, smarter, faster",
    "Grow triathlon channel followers; motivate athletes to seek discomfort and train with data"
))
story = cur.fetchone()
story_id = str(story['id'])
print(f"Created story: {story_id}")

SCENES = [
    {
        "position": 1,
        "description": "Extreme close-up of face mid-run or on the bike. Breathing hard, eyes forward. Ambient breath/effort sound for 1 sec then beat drops.",
        "overlay_text": "1 month. 0 excuses.",
        "duration_sec": 3,
    },
    {
        "position": 2,
        "description": "Screen recording of the app — workout detail page scrolling fast. Show TSS, zone breakdown, load chart. Move fast, don't linger.",
        "overlay_text": "I built my own AI training coach to stop guessing.",
        "duration_sec": 5,
    },
    {
        "position": 3,
        "description": "Rapid 4-clip sequence (~2s each): 1) Swimming — underwater or lane shot. 2) Cycling — road or indoor trainer, power meter visible. 3) Running — feet hitting pavement low angle. 4) Transition area or gear flat-lay.",
        "overlay_text": "Swim. Bike. Run. Every session tracked. Every watt. Every heartbeat. Nothing wasted.",
        "duration_sec": 10,
    },
    {
        "position": 4,
        "description": "Screen recording of the /progress page — scroll slowly through fitness/fatigue/form chart. Let the upward trend speak. Cut to single rising metric close-up.",
        "overlay_text": "Fitness is math. Recovery is discipline.",
        "duration_sec": 9,
    },
    {
        "position": 5,
        "description": "Screen of the AI coach recommendation — rest day call, intensity suggestion, or recovery score. Or text-message-style animation of an AI insight.",
        "overlay_text": "My coach doesn't sleep. Neither do I.",
        "duration_sec": 6,
    },
    {
        "position": 6,
        "description": "Back to you — finishing a run, crossing a line, or standing at the water's edge looking ahead. Calm after effort. Slow fade.",
        "overlay_text": "Seek discomfort. The data will follow.",
        "duration_sec": 7,
    },
]

for s in SCENES:
    cur.execute("""
        INSERT INTO training.content_scenes
          (story_id, position, description, overlay_text, duration_sec, clip_urls)
        VALUES (%s, %s, %s, %s, %s, '[]')
    """, (story_id, s['position'], s['description'], s['overlay_text'], s['duration_sec']))
    print(f"  Scene {s['position']}: {s['overlay_text'][:50]}")

conn.commit()
cur.close()
conn.close()
print(f"\nDone. Story ID: {story_id}")
print(f"View at: https://training.rinosbike.com/content/{story_id}")
