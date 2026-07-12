"""
Multi-format ffmpeg export for tracks-mode Content stories.

Unlike legacy stories' export_story()/_ffmpeg_segment() (content.py), which
encodes each scene independently and stream-copy-concats the segments, a
multi-track timeline can have overlapping clips across z-indexed tracks —
the concat demuxer fundamentally can't express that. This builds a single
`ffmpeg -filter_complex` graph: one base color layer, each visual clip
trimmed/scaled/time-shifted then composited on top via `overlay` gated by
`enable='between(t,start,end)'`, captions layered on top via chained
`drawtext`, and all clip audio mixed via `amix`.

Effects (speed, filters, Ken Burns, fades, caption styling) mirror the
canvas preview's approximations in useCompositor.js — not pixel/sample
identical (different renderers), but the same intent.
"""
import os
import subprocess
import tempfile
import logging

from app.services.storage_service import download_file

log = logging.getLogger(__name__)

_FONT_PATH = '/usr/share/fonts/truetype/lato/Lato-Black.ttf'
_FPS = 30
_CRF = 22
_ENCODE_PRESET = 'fast'
_EXPORT_TIMEOUT_SEC = 280  # stay under gunicorn's 300s worker timeout
_ANIM_DURATION_SEC = 0.4  # matches ANIM_DURATION_SEC in useCompositor.js

PRESETS = {
    '9:16':   {'width': 1080, 'height': 1920, 'label': 'Reels / TikTok / Shorts'},
    '16:9':   {'width': 1920, 'height': 1080, 'label': 'YouTube'},
    '1:1':    {'width': 1080, 'height': 1080, 'label': 'Square'},
    '4:5':    {'width': 1080, 'height': 1350, 'label': 'IG Feed Portrait'},
    'wechat': {'width': 1080, 'height': 1080, 'label': 'WeChat Moments'},
}
PRESET_NOTES = {
    'wechat': "WeChat Moments has no single official spec — using 1:1 1080×1080 "
              "H.264 baseline profile for maximum device compatibility. Confirm against "
              "current WeChat requirements before publishing.",
}


class ExportError(Exception):
    pass


def _clip_duration(clip):
    return max(clip['timeline_end_sec'] - clip['timeline_start_sec'], 0.05)


def _ms(sec):
    return max(0, round(sec * 1000))


def _atempo_chain(speed):
    """atempo only accepts 0.5-2.0 per instance; chain multiple for wider ranges."""
    if not speed or speed == 1.0:
        return ''
    stages = []
    remaining = speed
    while remaining > 2.0:
        stages.append('atempo=2.0')
        remaining /= 2.0
    while remaining < 0.5:
        stages.append('atempo=0.5')
        remaining /= 0.5
    stages.append(f'atempo={remaining}')
    return ',' + ','.join(stages)


def _eq_filter(style):
    brightness = style.get('brightness', 0)
    contrast = style.get('contrast', 1)
    saturation = style.get('saturation', 1)
    if brightness == 0 and contrast == 1 and saturation == 1:
        return ''
    return f',eq=brightness={brightness}:contrast={contrast}:saturation={saturation}'


def _wrap_text_heuristic(text, fontsize, max_width_px):
    """Cheap character-count-based wrap, approximating useCompositor.js's
    canvas measureText() wrap without needing font-metrics access here."""
    avg_char_width = fontsize * 0.58
    max_chars = max(4, int(max_width_px / avg_char_width))
    words = text.split(' ')
    lines = []
    current = ''
    for w in words:
        test = f'{current} {w}'.strip()
        if len(test) > max_chars and current:
            lines.append(current)
            current = w
        else:
            current = test
    if current:
        lines.append(current)
    return '\n'.join(lines)


def build_filter_complex(tracks, clips, width, height, total_duration, local_paths):
    """
    Returns (input_args, filter_complex_str, map_args, text_files) for a
    single ffmpeg invocation. `local_paths` maps clip id -> downloaded local
    file path (already-downloaded, one entry per clip that has a source_url).
    """
    input_args = []
    filter_parts = []
    input_index = 0
    clip_input_index = {}  # clip id -> ffmpeg input index (lets a video clip's audio reuse its already-added video input instead of re-adding the file)

    def add_input(clip, extra_flags=None):
        nonlocal input_index
        idx = input_index
        input_args.extend(extra_flags or [])
        input_args.extend(['-i', local_paths[clip['id']]])
        input_index += 1
        clip_input_index[clip['id']] = idx
        return idx

    scale_crop = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}'

    filter_parts.append(f'color=black:size={width}x{height}:duration={total_duration}[base0]')
    base_label = 'base0'
    stage = 0

    visual_tracks = sorted(
        (t for t in tracks if t['kind'] in ('video', 'image')),
        key=lambda t: t['z_index']
    )
    for track in visual_tracks:
        track_clips = sorted(
            (c for c in clips if c['track_id'] == track['id']),
            key=lambda c: c['timeline_start_sec']
        )
        for clip in track_clips:
            duration = _clip_duration(clip)
            start = clip['timeline_start_sec']
            style = clip.get('style_json') or {}
            eq = _eq_filter(style)

            if clip['source_type'] == 'video':
                idx = add_input(clip)
                trim_start = clip.get('trim_start_sec') or 0
                speed = clip.get('speed') or 1.0
                trim_end = clip.get('trim_end_sec') or (trim_start + duration * speed)
                # normalize the trimmed segment to t=0, apply speed, then shift it forward to
                # its position on the OUTPUT timeline so overlay's enable=between(t,..) lines up
                vf = (
                    f'[{idx}:v]trim=start={trim_start}:end={trim_end},'
                    f'setpts=(PTS-STARTPTS)/{speed}+{start}/TB,{scale_crop}{eq}[v{stage}]'
                )
            else:  # image
                kb = style.get('ken_burns')
                if kb:
                    total_frames = max(1, round(duration * _FPS))
                    s0, s1 = kb['from']['scale'], kb['to']['scale']
                    x0, x1 = kb['from']['x'], kb['to']['x']
                    y0, y1 = kb['from']['y'], kb['to']['y']
                    idx = add_input(clip, extra_flags=['-loop', '1'])
                    zoompan = (
                        f"zoompan=z='{s0}+({s1}-{s0})*on/{total_frames}'"
                        f":x='(({x0}+({x1}-{x0})*on/{total_frames})*iw)-(iw/zoom/2)'"
                        f":y='(({y0}+({y1}-{y0})*on/{total_frames})*ih)-(ih/zoom/2)'"
                        f":d={total_frames}:s={width}x{height}:fps={_FPS}"
                    )
                    # cover-fill to the target size FIRST so zoompan's iw/ih are already
                    # correctly proportioned — matches useCompositor.js's drawCoverTransformed,
                    # which also applies the cover base-scale before the Ken Burns zoom
                    vf = f'[{idx}:v]{scale_crop},{zoompan},setpts=PTS-STARTPTS+{start}/TB{eq}[v{stage}]'
                else:
                    idx = add_input(clip, extra_flags=['-loop', '1', '-t', str(duration)])
                    vf = f'[{idx}:v]setpts=PTS-STARTPTS+{start}/TB,{scale_crop}{eq}[v{stage}]'
            filter_parts.append(vf)

            next_label = f'ov{stage}'
            end = clip['timeline_end_sec']
            filter_parts.append(
                f"[{base_label}][v{stage}]overlay=enable='between(t,{start},{end})'[{next_label}]"
            )
            base_label = next_label
            stage += 1

    caption_tracks = sorted(
        (t for t in tracks if t['kind'] == 'caption'),
        key=lambda t: t['z_index']
    )
    text_files = []
    for track in caption_tracks:
        track_clips = sorted(
            (c for c in clips if c['track_id'] == track['id']),
            key=lambda c: c['timeline_start_sec']
        )
        for clip in track_clips:
            if not (clip.get('text_content') or '').strip():
                continue
            style = clip.get('style_json') or {}
            fontsize = style.get('fontSize', 78)
            fontcolor = style.get('color', 'white')
            x_frac = style.get('x', 0.5)
            y_frac = style.get('y', 0.77)
            background = style.get('background', 'none')
            animation = style.get('animation') or {}
            start = clip['timeline_start_sec']
            end = clip['timeline_end_sec']

            wrapped = _wrap_text_heuristic(clip['text_content'], fontsize, width * 0.85)
            text_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8')
            text_file.write(wrapped)
            text_file.close()
            text_files.append(text_file.name)

            box_expr = ''
            if background in ('box', 'solid'):
                box_alpha = '1.0' if background == 'solid' else '0.55'
                box_expr = f':box=1:boxcolor=black@{box_alpha}:boxborderw=10'
            outline_expr = ':borderw=4:bordercolor=black' if background == 'outline' else ':shadowx=5:shadowy=5:shadowcolor=black@0.85'

            alpha_expr = ''
            if animation.get('in') == 'fade' or animation.get('out') == 'fade':
                fade_in_expr = f"(t-{start})/{_ANIM_DURATION_SEC}" if animation.get('in') == 'fade' else '1'
                fade_out_expr = f"({end}-t)/{_ANIM_DURATION_SEC}" if animation.get('out') == 'fade' else '1'
                alpha_expr = f":alpha='min(1,min({fade_in_expr},{fade_out_expr}))'"

            next_label = f'txt{stage}'
            filter_parts.append(
                f"[{base_label}]drawtext=fontfile={_FONT_PATH}:textfile={text_file.name}"
                f":fontsize={fontsize}:fontcolor={fontcolor}"
                f":x=(w*{x_frac})-text_w/2:y=(h*{y_frac})-text_h/2"
                f"{box_expr}{outline_expr}{alpha_expr}"
                f":enable='between(t,{start},{end})'[{next_label}]"
            )
            base_label = next_label
            stage += 1

    # rename whatever the last visual stage's output label is to a stable [vout]
    filter_parts[-1] = filter_parts[-1][:filter_parts[-1].rfind('[')] + '[vout]'

    # --- audio: audio-track clips + un-muted video-track clips with volume > 0 ---
    audio_labels = []
    audio_sources = [c for c in clips if c['track_id'] in
                      {t['id'] for t in tracks if t['kind'] == 'audio' and not t['muted']}]
    audio_sources += [c for c in clips if c['source_type'] == 'video'
                       and c['track_id'] in {t['id'] for t in tracks if t['kind'] == 'video' and not t['muted']}]

    for i, clip in enumerate(audio_sources):
        volume = clip.get('volume', 1.0)
        if not volume or clip['id'] not in local_paths:
            continue
        idx = clip_input_index.get(clip['id'])
        if idx is None:
            idx = add_input(clip)

        trim_start = clip.get('trim_start_sec') or 0
        speed = clip.get('speed') or 1.0
        clip_dur = _clip_duration(clip)
        trim_end = clip.get('trim_end_sec') or (trim_start + clip_dur * speed)
        start_ms = _ms(clip['timeline_start_sec'])

        style = clip.get('style_json') or {}
        fade_in = style.get('fade_in_sec') or 0
        fade_out = style.get('fade_out_sec') or 0
        fade_expr = ''
        if fade_in > 0:
            fade_expr += f',afade=t=in:st=0:d={fade_in}'
        if fade_out > 0:
            fade_expr += f',afade=t=out:st={max(0, clip_dur - fade_out)}:d={fade_out}'

        label = f'a{i}'
        filter_parts.append(
            f'[{idx}:a]atrim=start={trim_start}:end={trim_end},asetpts=PTS-STARTPTS,'
            f'aformat=sample_rates=44100:channel_layouts=stereo'
            f'{_atempo_chain(speed)},'
            f'volume={volume}{fade_expr},adelay={start_ms}|{start_ms}[{label}]'
        )
        audio_labels.append(label)

    if audio_labels:
        mix_inputs = ''.join(f'[{l}]' for l in audio_labels)
        filter_parts.append(f'{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0[aout]')
    else:
        filter_parts.append(f'anullsrc=channel_layout=stereo:sample_rate=44100:duration={total_duration}[aout]')

    filter_complex = ';'.join(filter_parts)
    map_args = ['-map', '[vout]', '-map', '[aout]']
    return input_args, filter_complex, map_args, text_files


def export_story_tracks(story_id, tracks, clips, preset='9:16'):
    if preset not in PRESETS:
        raise ExportError(f'Unknown preset {preset!r}. Available: {list(PRESETS.keys())}')
    if not clips:
        raise ExportError('No clips to export — add clips to your tracks first')

    dims = PRESETS[preset]
    total_duration = max((c['timeline_end_sec'] for c in clips), default=10)

    tmpdir = tempfile.mkdtemp(prefix='timeline_export_')
    text_files = []
    try:
        local_paths = {}
        distinct_urls = {}
        for clip in clips:
            url = clip.get('source_url')
            if not url:
                continue
            if url not in distinct_urls:
                ext = os.path.splitext(url)[1] or '.bin'
                path = os.path.join(tmpdir, f'src_{len(distinct_urls)}{ext}')
                data = download_file(url)
                with open(path, 'wb') as f:
                    f.write(data)
                distinct_urls[url] = path
            local_paths[clip['id']] = distinct_urls[url]

        input_args, filter_complex, map_args, text_files = build_filter_complex(
            tracks, clips, dims['width'], dims['height'], total_duration, local_paths
        )

        out_path = os.path.join(tmpdir, 'export.mp4')
        cmd = ['ffmpeg', '-y', *input_args,
               '-filter_complex', filter_complex, *map_args,
               '-c:v', 'libx264', '-preset', _ENCODE_PRESET, '-crf', str(_CRF),
               '-pix_fmt', 'yuv420p', '-r', str(_FPS),
               '-c:a', 'aac', '-shortest']
        if preset == 'wechat':
            cmd += ['-profile:v', 'baseline', '-level', '4.0']
        cmd.append(out_path)

        result = subprocess.run(cmd, capture_output=True, timeout=_EXPORT_TIMEOUT_SEC)
        if result.returncode != 0:
            stderr = result.stderr.decode('utf-8', errors='replace')
            log.error('Timeline export failed for story %s (preset %s)\ngraph: %s\nstderr: %s',
                       story_id, preset, filter_complex, stderr[-1500:])
            raise ExportError(f'Video export failed: {stderr[-300:]}')

        with open(out_path, 'rb') as f:
            return f.read(), PRESET_NOTES.get(preset)
    finally:
        for tf in text_files:
            try:
                os.unlink(tf)
            except OSError:
                pass
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)
