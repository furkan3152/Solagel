"""Voiceover for the Free Mint film: the promo's punchy read (Kokoro af_heart, per-line speeds).

  python tts.py --models DIR --out DIR [--voice af_heart] [--only id,id]

Reads vo-lines.json next to this file and writes one 24 kHz wav per line plus durations.json
through the shared voice kit (media/gameplay/render/voice.py: script marks, fixed pronunciations).
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "gameplay", "render"))
import voice  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    voice.render(os.path.join(HERE, "vo-lines.json"), a.models, a.out, a.voice, a.speed, a.only)
