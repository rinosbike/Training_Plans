"""
AI voiceover generation via a self-hosted cloned voice (OpenVoice V2 +
MeloTTS). Unlike transcription, this can't run in the main app's Python 3.12
venv — OpenVoice's dependency chain (MeloTTS) is only tested on Python 3.9
and conflicts with newer library versions on this platform. Runs as a
subprocess in an isolated Python 3.9 venv instead (scripts/voiceover_infer.py),
the same way ffmpeg is already invoked as an external process — a bad
install/crash in that venv can never touch the main app.

Follows content_transcript_jobs' background-thread + polling-status pattern
exactly (own DB connection, manual RLS, status transitions), and shares
ai_inference.inference_lock with transcription since both are CPU-bound work
on the same 8-core box that also serves regular requests.
"""
import io
import os
import logging
import subprocess
import tempfile
import threading
import uuid
import psycopg2
import psycopg2.extras

from app.services.storage_service import download_file, upload_fileobj_streaming
from app.services.timeline_service import probe_media
from app.services.ai_inference import inference_lock

log = logging.getLogger(__name__)

_SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'scripts')

_REPO_ROOT = os.path.dirname(_SCRIPTS_DIR)
_DEFAULT_REFERENCE_PATH = os.path.join(_REPO_ROOT, 'resources', 'voiceover_reference_placeholder.wav')

OPENVOICE_VENV_PYTHON = os.getenv('OPENVOICE_VENV_PYTHON', '')
OPENVOICE_SCRIPT_PATH = os.getenv('OPENVOICE_SCRIPT_PATH', os.path.join(_SCRIPTS_DIR, 'voiceover_infer.py'))
# Defaults to the committed placeholder voice so this works out of the box —
# override with a real recording later via VOICEOVER_REFERENCE_PATH, no code change needed.
VOICEOVER_REFERENCE_PATH = os.getenv('VOICEOVER_REFERENCE_PATH', _DEFAULT_REFERENCE_PATH)
VOICEOVER_TIMEOUT_SEC = 300


def is_available() -> bool:
    return (
        bool(OPENVOICE_VENV_PYTHON) and os.path.exists(OPENVOICE_VENV_PYTHON)
        and os.path.exists(OPENVOICE_SCRIPT_PATH)
        and bool(VOICEOVER_REFERENCE_PATH) and os.path.exists(VOICEOVER_REFERENCE_PATH)
    )


def generate(text: str, reference_path: str, speaker: str = 'EN-US') -> bytes:
    """Run the isolated-venv subprocess to clone `text` in the reference
    voice. Returns wav bytes. Raises RuntimeError on failure."""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        out_path = tmp.name

    try:
        with inference_lock:
            result = subprocess.run(
                [OPENVOICE_VENV_PYTHON, OPENVOICE_SCRIPT_PATH,
                 '--text', text, '--reference', reference_path,
                 '--output', out_path, '--speaker', speaker],
                capture_output=True, timeout=VOICEOVER_TIMEOUT_SEC,
            )
        if result.returncode != 0:
            stderr = result.stderr.decode('utf-8', errors='replace')
            raise RuntimeError(f'voiceover_infer.py failed: {stderr[-500:]}')

        with open(out_path, 'rb') as f:
            data = f.read()
        if not data:
            raise RuntimeError('voiceover_infer.py produced an empty file')
        return data
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def _run(job_id: str, user_id: str, db_url: str):
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT set_config('training.current_user_id', %s, false)", (user_id,))

        cur.execute('SELECT * FROM training.content_voiceover_jobs WHERE id = %s', (job_id,))
        job = cur.fetchone()
        if not job:
            return

        cur.execute(
            "UPDATE training.content_voiceover_jobs SET status = 'processing', updated_at = now() WHERE id = %s",
            (job_id,)
        )
        conn.commit()

        # voice_ref_url is either a local server path (today's placeholder) or
        # an R2 URL (once a real recording replaces it) — handle both.
        ref_url = job['voice_ref_url'] or VOICEOVER_REFERENCE_PATH
        local_ref_path = ref_url
        tmp_ref_path = None
        if ref_url.startswith('http'):
            ref_bytes = download_file(ref_url)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_ref:
                tmp_ref.write(ref_bytes)
                tmp_ref_path = tmp_ref.name
            local_ref_path = tmp_ref_path

        try:
            audio_bytes = generate(job['text_content'], local_ref_path)
        finally:
            if tmp_ref_path:
                try:
                    os.unlink(tmp_ref_path)
                except OSError:
                    pass

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_probe:
            tmp_probe.write(audio_bytes)
            probe_path = tmp_probe.name
        try:
            probed = probe_media(probe_path)
        finally:
            os.unlink(probe_path)
        duration = probed['duration_sec'] or 5.0

        folder = f"content/voiceover/{job['story_id']}"
        filename = f'{uuid.uuid4().hex}.wav'
        clip_url = upload_fileobj_streaming(io.BytesIO(audio_bytes), folder, 'audio/wav', filename=filename)

        cur.execute(
            'SELECT COALESCE(MAX(timeline_end_sec), 0) AS max_end FROM training.content_clips WHERE track_id = %s',
            (job['target_track_id'],)
        )
        start = cur.fetchone()['max_end'] or 0

        cur.execute(
            'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
            (job['target_track_id'],)
        )
        next_pos = cur.fetchone()['mp'] + 1

        cur.execute(
            '''INSERT INTO training.content_clips
                 (track_id, source_url, source_type, source_duration_sec,
                  trim_start_sec, trim_end_sec, timeline_start_sec, timeline_end_sec, position)
               VALUES (%s, %s, 'audio', %s, 0, %s, %s, %s, %s)''',
            (job['target_track_id'], clip_url, duration, duration, start, start + duration, next_pos)
        )

        cur.execute(
            "UPDATE training.content_voiceover_jobs SET status = 'completed', updated_at = now() WHERE id = %s",
            (job_id,)
        )
        conn.commit()
        log.info('Voiceover job %s completed (%.1fs clip)', job_id, duration)

    except Exception as e:
        log.error('Voiceover job %s failed: %s', job_id, e, exc_info=True)
        if conn:
            try:
                conn.rollback()
                with conn.cursor() as cur2:
                    cur2.execute(
                        "UPDATE training.content_voiceover_jobs SET status = 'failed', error_message = %s, updated_at = now() WHERE id = %s",
                        (str(e)[:500], job_id)
                    )
                conn.commit()
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


def start_voiceover_job(job_id: str, user_id: str) -> bool:
    """Kick off background voiceover generation for a pending job row.
    Returns False if OpenVoice isn't configured/installed."""
    db_url = os.getenv('DATABASE_URL', '')
    if not is_available() or not db_url:
        return False
    t = threading.Thread(target=_run, args=(job_id, user_id, db_url), daemon=True)
    t.start()
    return True
