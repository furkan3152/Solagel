"""Voiceover generator (Kokoro TTS, local ONNX).

Usage:
  python tts.py --models DIR --out DIR [--voice af_heart] [--speed 1.0]

Reads vo-lines.json next to this file and writes one 24 kHz mono wav per
line (<id>.wav) plus durations.json. "Slana" is forced to the phonemes
/slˈɑːnə/ so every line says the brand the same way.
"""
import argparse
import json
import os
import re

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))

# Per-line voice tuning: speed tweaks so each line lands inside its scene.
SPEED = {
    "hook_a": 0.92,
    "hook_b": 0.95,
    "end": 0.86,
    "logo": 1.0,
    "ticket": 1.04,
    "play": 1.0,
    "rounds_a": 0.98,
    "rounds_b": 1.04,
    "bots": 1.08,
    "pass": 1.06,
    "season": 1.0,
    "split": 1.04,
}

BRAND = "slˈɑːnə"


def phonemes_for(kokoro: Kokoro, text: str, lang: str) -> str:
    # Phonemize each chunk around the brand name and splice the fixed
    # pronunciation in, so the G2P never guesses "Slana".
    parts = re.split(r"(Slana)", text)
    out = []
    for p in parts:
        if p == "Slana":
            out.append(BRAND)
        elif p:
            ph = kokoro.tokenizer.phonemize(p, lang)
            # keep the space boundaries the text had
            if p.startswith(" "):
                ph = " " + ph.lstrip()
            if p.endswith(" "):
                ph = ph.rstrip() + " "
            out.append(ph)
    return "".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--only", default="")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    k = Kokoro(os.path.join(a.models, "kokoro-v1.0.onnx"), os.path.join(a.models, "voices-v1.0.bin"))
    lines = json.load(open(os.path.join(HERE, "vo-lines.json")))
    durs = {}
    for ln in lines:
        if a.only and ln["id"] not in a.only.split(","):
            continue
        ph = phonemes_for(k, ln["text"], "en-us")
        sp = a.speed * SPEED.get(ln["id"], 1.0)
        samples, sr = k.create(ph, voice=a.voice, speed=sp, lang="en-us", is_phonemes=True)
        samples = np.asarray(samples, dtype=np.float32)
        # trim leading / trailing near-silence (keeps a 30 ms cushion)
        env = np.abs(samples) > 0.01
        idx = np.nonzero(env)[0]
        if len(idx):
            s0 = max(0, idx[0] - int(0.03 * sr))
            s1 = min(len(samples), idx[-1] + int(0.06 * sr))
            samples = samples[s0:s1]
        sf.write(os.path.join(a.out, ln["id"] + ".wav"), samples, sr)
        durs[ln["id"]] = round(len(samples) / sr, 3)
        print(f'{ln["id"]:8s} {durs[ln["id"]]:5.2f}s  {ph}')
    json.dump(durs, open(os.path.join(a.out, "durations.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
