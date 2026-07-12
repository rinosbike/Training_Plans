#!/usr/bin/env python3
"""
Standalone voice-cloning inference script — run by the isolated OpenVoice
Python 3.9 venv, NOT importable from the main app's Python 3.12 venv.
OpenVoice's dependency chain (MeloTTS) is only tested on Python 3.9, so this
runs as a subprocess (invoked by app/services/voiceover_service.py) the same
way ffmpeg is already invoked as an external process from this codebase.

Usage:
  <isolated-venv>/bin/python voiceover_infer.py \
    --text "..." --reference /path/to/ref.wav --output /path/to/out.wav \
    [--speaker EN-US] [--speed 1.0]
"""
import argparse
import glob
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--text', required=True)
    parser.add_argument('--reference', required=True, help='Path to reference voice wav')
    parser.add_argument('--output', required=True, help='Path to write cloned wav')
    parser.add_argument('--speaker', default='EN-US')
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()

    import torch
    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter
    from melo.api import TTS

    ckpt_dir = os.environ.get('OPENVOICE_CKPT_DIR')
    if not ckpt_dir:
        matches = glob.glob(os.path.expanduser(
            '~/.cache/huggingface/hub/models--myshell-ai--OpenVoiceV2/snapshots/*'
        ))
        if not matches:
            raise RuntimeError('OpenVoice V2 checkpoint not found — set OPENVOICE_CKPT_DIR or download it first')
        ckpt_dir = matches[0]

    device = 'cpu'

    tone_color_converter = ToneColorConverter(f'{ckpt_dir}/converter/config.json', device=device)
    tone_color_converter.load_ckpt(f'{ckpt_dir}/converter/checkpoint.pth')

    target_se, _ = se_extractor.get_se(args.reference, tone_color_converter, vad=True)

    model = TTS(language='EN', device=device)
    speaker_ids = model.hps.data.spk2id
    if args.speaker not in speaker_ids:
        raise RuntimeError(f'Unknown speaker {args.speaker!r} — available: {list(speaker_ids.keys())}')

    base_path = args.output + '.base.wav'
    model.tts_to_file(args.text, speaker_ids[args.speaker], base_path, speed=args.speed)

    speaker_key = args.speaker.lower().replace('_', '-')
    source_se = torch.load(f'{ckpt_dir}/base_speakers/ses/{speaker_key}.pth', map_location=device)

    tone_color_converter.convert(
        audio_src_path=base_path,
        src_se=source_se,
        tgt_se=target_se,
        output_path=args.output,
    )
    os.unlink(base_path)
    print('OK')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
