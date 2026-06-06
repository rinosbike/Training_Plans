"""
Captures app screenshots for the Content Studio story and uploads them to R2.

For each scene:
  1  Dashboard (plan overview)
  2  Workout detail — TSS, zones, load chart
  3  Progress page — fitness/fatigue trend chart
  4  AI Coach — conversation + recommendation
  5  Sync page — connected platforms
  6  Settings / profile overview

Run: python3 migrations/capture_story_clips.py
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv()

# ─── 1. Get story + admin user, build JWT internally ─────────────────────────
from app import create_app
from flask_jwt_extended import create_access_token
import psycopg2, psycopg2.extras
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect(os.environ['DATABASE_URL'], cursor_factory=RealDictCursor)
cur = conn.cursor()

STORY_TITLE = "1 Month. 0 Excuses."
cur.execute("SELECT id FROM training.content_stories WHERE title = %s", (STORY_TITLE,))
story = cur.fetchone()
if not story:
    print("ERROR: story not found — run seed_content_story.py first")
    sys.exit(1)
story_id = str(story['id'])

cur.execute("""
    SELECT id, position, overlay_text FROM training.content_scenes
    WHERE story_id = %s ORDER BY position
""", (story_id,))
scenes = [dict(r) for r in cur.fetchall()]

cur.execute("SELECT id FROM training.users WHERE role IN ('admin','super_admin') ORDER BY created_at LIMIT 1")
user = cur.fetchone()
user_id = str(user['id'])
conn.close()

app = create_app('production')
with app.app_context():
    token = create_access_token(identity=user_id)

BASE_URL = "https://training.rinosbike.com"
WORKOUT_ID = "35b42078-4c69-4d58-91d5-b6feeb605bde"

# Pages to capture per scene position
SCENE_PAGES = {
    1: f"{BASE_URL}/",                         # Dashboard
    2: f"{BASE_URL}/workout/{WORKOUT_ID}",      # Workout detail
    3: f"{BASE_URL}/progress",                  # Progress / fitness chart
    4: f"{BASE_URL}/ai-coach",                  # AI Coach
    5: f"{BASE_URL}/nutrition",                 # Nutrition / food log
    6: f"{BASE_URL}/",                          # Dashboard again (closing shot)
}

# ─── 2. Take screenshots with Playwright ─────────────────────────────────────
from playwright.sync_api import sync_playwright
from app.services.storage_service import upload_file

conn2 = psycopg2.connect(os.environ['DATABASE_URL'], cursor_factory=RealDictCursor)
conn2.autocommit = False
cur2 = conn2.cursor()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844})  # iPhone 14 Pro viewport

    # Inject token once via a blank page, then navigate
    setup_page = ctx.new_page()
    setup_page.goto(BASE_URL)
    setup_page.evaluate(f"localStorage.setItem('access_token', '{token}')")
    setup_page.evaluate(f"localStorage.setItem('refresh_token', 'placeholder')")
    setup_page.close()

    for scene in scenes:
        pos = scene['position']
        scene_id = str(scene['id'])
        url = SCENE_PAGES.get(pos)
        if not url:
            continue

        print(f"Scene {pos}: capturing {url} ...")
        page = ctx.new_page()
        try:
            page.goto(url, wait_until="networkidle", timeout=20000)
            time.sleep(2)  # let charts animate in

            # Scroll to trigger lazy content on longer pages
            page.evaluate("window.scrollTo(0, 200)")
            time.sleep(0.5)
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.5)

            png_bytes = page.screenshot(full_page=False, type="png")

            folder = f"content/{story_id}/{scene_id}"
            url_r2 = upload_file(png_bytes, folder, "image/png",
                                 filename=f"scene_{pos}_screenshot.png")

            # Update clip_urls
            cur2.execute(
                "SELECT clip_urls FROM training.content_scenes WHERE id = %s", (scene_id,)
            )
            existing = cur2.fetchone()
            clips = list(existing['clip_urls'] or [])
            if url_r2 not in clips:
                clips.append(url_r2)
            cur2.execute(
                "UPDATE training.content_scenes SET clip_urls = %s WHERE id = %s",
                (json.dumps(clips), scene_id)
            )
            conn2.commit()
            print(f"  → uploaded: {url_r2}")
        except Exception as e:
            print(f"  ERROR: {e}")
        finally:
            page.close()

    browser.close()

cur2.close()
conn2.close()
print(f"\nDone. View story: {BASE_URL}/content/{story_id}")
