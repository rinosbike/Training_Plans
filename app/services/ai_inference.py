"""
Shared coordination for CPU-bound local model inference (Whisper transcription,
voiceover generation). Both run as background threads on the same 8-core box
that also serves gunicorn's regular request workers — this lock keeps two
inference jobs from running concurrently and starving everything else.
"""
import threading

inference_lock = threading.Lock()
