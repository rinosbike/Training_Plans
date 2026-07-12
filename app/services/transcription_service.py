"""
Auto-transcription for the Content timeline editor's caption tracks, via a
self-hosted faster-whisper model (CPU inference, zero per-minute cost —
avoids the ElevenLabs/cloud-STT pricing exposure this was originally built
with). Runs in a daemon thread (like translation_service.py's plan
translation) since transcription time is unpredictable and the user should
be able to keep editing while it runs — unlike translate_plan_async this
also tracks a polling status (content_transcript_jobs) since the user is
actively waiting on this one result, not a fire-and-forget batch job.
"""
import os
import json
import logging
import tempfile
import threading
import psycopg2
import psycopg2.extras

from app.services.storage_service import download_file
from app.services.ai_inference import inference_lock

log = logging.getLogger(__name__)

WHISPER_MODEL_SIZE = os.getenv('WHISPER_MODEL_SIZE', 'small')
WHISPER_DEVICE = os.getenv('WHISPER_DEVICE', 'cpu')
WHISPER_COMPUTE_TYPE = os.getenv('WHISPER_COMPUTE_TYPE', 'int8')
MAX_CAPTION_CHARS = 42
MAX_CAPTION_DURATION_SEC = 5.0

_model = None
_model_lock = threading.Lock()


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                log.info('Loading Whisper model %s (device=%s, compute_type=%s)…',
                          WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE)
                _model = WhisperModel(WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
    return _model


def transcribe(audio_bytes: bytes, filename: str, language: str = None) -> dict:
    """Run local Whisper inference. Returns {'text', 'words', 'language',
    'language_probability'} — `words` matches build_caption_clips()'s
    expected shape: [{'text','start','end','type':'word'}, ...]."""
    ext = os.path.splitext(filename)[1] or '.mp4'
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        model = _get_model()
        with inference_lock:
            segments, info = model.transcribe(
                tmp_path, language=language, word_timestamps=True, vad_filter=True,
            )
            words = []
            full_text = []
            for segment in segments:
                full_text.append(segment.text.strip())
                for w in (segment.words or []):
                    words.append({'text': w.word, 'start': w.start, 'end': w.end, 'type': 'word'})

        return {
            'text': ' '.join(full_text),
            'words': words,
            'language': info.language,
            'language_probability': info.language_probability,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def build_caption_clips(transcript: dict, max_chars: int = MAX_CAPTION_CHARS,
                        max_duration_sec: float = MAX_CAPTION_DURATION_SEC) -> list:
    """Group word-level timestamps into subtitle cues: break on sentence-ending
    punctuation, a max character count, or a max duration."""
    words = [
        w for w in (transcript.get('words') or [])
        if w.get('type') == 'word' and (w.get('text') or '').strip()
        and w.get('start') is not None and w.get('end') is not None
    ]
    if not words:
        return []

    cues = []
    current = []

    def flush():
        if not current:
            return
        cues.append({
            'text_content': ' '.join(w['text'].strip() for w in current),
            'timeline_start_sec': current[0]['start'],
            'timeline_end_sec': current[-1]['end'],
        })

    for w in words:
        text = w['text'].strip()
        candidate_text = ' '.join([*(c['text'].strip() for c in current), text])
        candidate_duration = w['end'] - current[0]['start'] if current else 0

        if current and (len(candidate_text) > max_chars or candidate_duration > max_duration_sec):
            flush()
            current = [w]
        else:
            current.append(w)

        if text.endswith(('.', '!', '?')):
            flush()
            current = []

    flush()
    return cues


def _run(job_id: str, user_id: str, db_url: str):
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT set_config('training.current_user_id', %s, false)", (user_id,))

        cur.execute(
            '''SELECT j.id AS job_id, c.source_url, t.story_id
               FROM training.content_transcript_jobs j
               JOIN training.content_clips c ON c.id = j.source_clip_id
               JOIN training.content_tracks t ON t.id = c.track_id
               WHERE j.id = %s''',
            (job_id,)
        )
        job = cur.fetchone()
        if not job or not job['source_url']:
            cur.execute(
                "UPDATE training.content_transcript_jobs SET status = 'failed', error_message = %s, updated_at = now() WHERE id = %s",
                ('Source clip not found', job_id)
            )
            conn.commit()
            return

        cur.execute("UPDATE training.content_transcript_jobs SET status = 'processing', updated_at = now() WHERE id = %s", (job_id,))
        conn.commit()

        audio_bytes = download_file(job['source_url'])
        filename = job['source_url'].split('/')[-1]
        transcript = transcribe(audio_bytes, filename)
        cues = build_caption_clips(transcript)

        if not cues:
            cur.execute(
                "UPDATE training.content_transcript_jobs SET status = 'failed', error_message = %s, raw_response = %s, updated_at = now() WHERE id = %s",
                ('No speech detected in this clip', json.dumps(transcript), job_id)
            )
            conn.commit()
            return

        cur.execute(
            "SELECT id FROM training.content_tracks WHERE story_id = %s AND kind = 'caption' AND name = 'Captions (auto)'",
            (job['story_id'],)
        )
        existing_track = cur.fetchone()
        if existing_track:
            caption_track_id = existing_track['id']
        else:
            cur.execute(
                '''SELECT COALESCE(MAX(z_index), -1) + 1 AS z, COALESCE(MAX(position), -1) + 1 AS p
                   FROM training.content_tracks WHERE story_id = %s''',
                (job['story_id'],)
            )
            nxt = cur.fetchone()
            cur.execute(
                '''INSERT INTO training.content_tracks (story_id, kind, name, z_index, position)
                   VALUES (%s, 'caption', 'Captions (auto)', %s, %s) RETURNING id''',
                (job['story_id'], nxt['z'], nxt['p'])
            )
            caption_track_id = cur.fetchone()['id']

        cur.execute(
            'SELECT COALESCE(MAX(position), -1) AS mp FROM training.content_clips WHERE track_id = %s',
            (caption_track_id,)
        )
        next_pos = cur.fetchone()['mp'] + 1

        for i, cue in enumerate(cues):
            cur.execute(
                '''INSERT INTO training.content_clips
                     (track_id, source_type, text_content, timeline_start_sec, timeline_end_sec, position)
                   VALUES (%s, 'text', %s, %s, %s, %s)''',
                (caption_track_id, cue['text_content'], cue['timeline_start_sec'], cue['timeline_end_sec'], next_pos + i)
            )

        cur.execute(
            "UPDATE training.content_transcript_jobs SET status = 'completed', raw_response = %s, updated_at = now() WHERE id = %s",
            (json.dumps(transcript), job_id)
        )
        conn.commit()
        log.info('Transcription job %s completed with %d captions', job_id, len(cues))

    except Exception as e:
        log.error('Transcription job %s failed: %s', job_id, e, exc_info=True)
        if conn:
            try:
                conn.rollback()
                with conn.cursor() as cur2:
                    cur2.execute(
                        "UPDATE training.content_transcript_jobs SET status = 'failed', error_message = %s, updated_at = now() WHERE id = %s",
                        (str(e)[:500], job_id)
                    )
                conn.commit()
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


def start_transcription_job(job_id: str, user_id: str) -> bool:
    """Kick off background transcription for a pending job row. Returns False
    (caller should surface a config error rather than leave the job pending
    forever) if faster-whisper isn't installed or DATABASE_URL is missing."""
    db_url = os.getenv('DATABASE_URL', '')
    if not is_available() or not db_url:
        return False
    t = threading.Thread(target=_run, args=(job_id, user_id, db_url), daemon=True)
    t.start()
    return True
