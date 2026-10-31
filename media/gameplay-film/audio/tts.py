"""Voiceover takes for the gameplay film (Kokoro, local ONNX). See voice.py for how a line is read.

  python tts.py --models DIR [--out out/work/voice/takes] [--voice af_heart] [--speed 1.0]
                [--takes 4] [--only id,id] [--blend af_nicole] [--model-file kokoro-v1.0.onnx]
  python tts.py audition --models DIR [--out out/work/voice/audition] [--voices a,b,c]
  python tts.py pick ID TAKE [--out ...]       lock a take by ear (the mixer uses the picks)

Reads ../vo-lines.json (the script, spoken-rhythm marks) and ../cues.json (the time each line has
before the next one, used to score the takes). Writes OUT/<id>/take<k>.wav (24 kHz mono) with a
layout .json each, and OUT/takes.json with every take's duration, pitch movement, words per
minute and score, and the pick. Then run mix.py.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import voice  # noqa: E402

FILM = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FILM, "..", ".."))
DEF_OUT = os.path.join(ROOT, "out", "work", "voice", "takes")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "pick":
        ap = argparse.ArgumentParser()
        ap.add_argument("cmd")
        ap.add_argument("id")
        ap.add_argument("take", type=int)
        ap.add_argument("--out", default=DEF_OUT)
        a = ap.parse_args()
        p = os.path.join(a.out, "takes.json")
        sel = json.load(open(p))
        sel[a.id]["pick"], sel[a.id]["locked"] = a.take, True
        json.dump(sel, open(p, "w"), indent=1)
        print(f"{a.id}: take{a.take} (locked)")
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "audition":
        ap = argparse.ArgumentParser()
        ap.add_argument("cmd")
        ap.add_argument("--models", required=True)
        ap.add_argument("--out", default=os.path.join(ROOT, "out", "work", "voice", "audition"))
        ap.add_argument("--voices", default="")
        ap.add_argument("--model-file", default=None)
        ap.add_argument("--backend", default="auto", choices=["auto", "onnx", "torch"])
        a = ap.parse_args()
        voice.audition(a.models, a.out, [v for v in a.voices.split(",") if v] or None, a.model_file, a.backend)
        sys.exit(0)
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", default=DEF_OUT)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--takes", type=int, default=4)
    ap.add_argument("--only", default="")
    ap.add_argument("--blend", default=None, help="a second voice blended in lightly on some takes")
    ap.add_argument("--model-file", default=None)
    ap.add_argument("--backend", default="auto", choices=["auto", "onnx", "torch"],
                    help="onnx: pip kokoro-onnx + kokoro-v1.0.onnx/voices-v1.0.bin; torch: pip kokoro + the Kokoro-82M folder")
    a = ap.parse_args()
    voice.render(os.path.join(FILM, "vo-lines.json"), os.path.join(FILM, "cues.json"), a.models, a.out,
                 a.voice, a.speed, a.takes, a.only, a.blend, a.model_file, a.backend)
