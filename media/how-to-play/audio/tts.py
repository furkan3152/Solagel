"""Voiceover for the how-to-play video (Kokoro TTS, local ONNX).

  python tts.py --models DIR --out DIR [--voice af_heart] [--speed 1.0] [--only id,id]

Same voice and brand pronunciation as the promo (media/promo/audio/tts.py): voice af_heart,
"Slana" forced to /slˈɑːnə/. Reads vo-lines.json next to this file and writes one 24 kHz mono
wav per line (<id>.wav, near-silence trimmed) plus durations.json.
"""
import argparse
import json
import os
import re

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
# Words the G2P should not guess.
FIXED = {
    "Slana": "slˈɑːnə",
}
# Per-line speed tweaks (1.0 = the global speed).
SPEED = {"intro": 0.98, "c3a": 0.96, "c3c": 0.96, "outro": 0.9}


def phonemes_for(k: Kokoro, text: str, lang: str) -> str:
    pat = "(" + "|".join(re.escape(w) for w in FIXED) + ")"
    out = []
    for p in re.split(pat, text):
        if p in FIXED:
            out.append(FIXED[p])
        elif p:
            ph = k.tokenizer.phonemize(p, lang)
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
    dp = os.path.join(a.out, "durations.json")
    durs = json.load(open(dp)) if os.path.exists(dp) else {}
    for ln in lines:
        if a.only and ln["id"] not in a.only.split(","):
            continue
        ph = phonemes_for(k, ln["text"], "en-us")
        samples, sr = k.create(ph, voice=a.voice, speed=a.speed * SPEED.get(ln["id"], 1.0), lang="en-us", is_phonemes=True)
        samples = np.asarray(samples, dtype=np.float32)
        idx = np.nonzero(np.abs(samples) > 0.01)[0]
        if len(idx):
            samples = samples[max(0, idx[0] - int(0.03 * sr)): min(len(samples), idx[-1] + int(0.08 * sr))]
        sf.write(os.path.join(a.out, ln["id"] + ".wav"), samples, sr)
        durs[ln["id"]] = round(len(samples) / sr, 3)
        print(f'{ln["id"]:6s} {durs[ln["id"]]:5.2f}s')
    json.dump(durs, open(dp, "w"), indent=1)
    print("total", round(sum(durs.values()), 1))


if __name__ == "__main__":
    main()
