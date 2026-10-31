"""Voiceover for the promo: a punchier read (per-line speeds 1.0-1.12, emphasis chunks).

  python tts.py --models DIR --out DIR [--voice af_heart] [--speed 1.0] [--only id,id]

Reads vo-lines.json next to this file (spoken-rhythm script marks: | breath, || beat, {0.6} pause,
*emphasis*; per-line "speed") and writes one 24 kHz mono wav per line plus durations.json. The
voice, the fixed pronunciations (Elymum /ˈɛlɪməm/, Elysium, HYPE, @elymumio, $ELYMUM) and the chunked
synthesis are in media/gameplay/render/voice.py; the voice was chosen by audition (README).
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
