"""The Slana voice: Kokoro TTS (local ONNX) with fixed pronunciations, spoken rhythm and auditions.

Shared by the promo (media/promo/audio/tts.py) and the how-to-play video
(media/how-to-play/audio/tts.py); the gameplay mixer's VO chain (render/audio.py) and the promo's
(media/promo/audio/mix.py) process the lines afterwards.

A line in vo-lines.json:
  {"id": "c6e", "text": "The fee only touches profit. || It's a flat *five percent*, paid to the operator.",
   "speed": 1.04}
Script marks:
  |      a short breath (0.16 s), the chunk around it is read on its own
  ||     a beat (0.38 s)
  {0.6}  a pause of that many seconds
  *word* emphasis: the chunk is read a touch slower (x0.92) with a small lift-in pause before it
Each chunk is synthesised separately (Kokoro resets its prosody per chunk, which suits short
spoken sentences) and the chunks are joined with the pauses; the joins get 6 ms fades.
Pronunciations the G2P must not guess are spliced in as phonemes (FIXED).

  python voice.py audition --models DIR --out DIR      (three lines in several voices)
"""
import argparse
import json
import os
import re

import numpy as np
import soundfile as sf

# words the G2P must not guess (espeak IPA, as Kokoro expects)
FIXED = {
    "slana dot io": "slˈɑːnə dˈɑːt ˌaɪ ˈoʊ",
    "@slanaio": "æt slˈɑːnə ˌaɪ ˈoʊ",
    "$SLANA": "slˈɑːnə",
    "Slana's": "slˈɑːnəz",
    "Slana": "slˈɑːnə",
    "Solana": "soʊlˈɑːnə",
    "NFTs": "ˌɛnˌɛftˈiːz",  # the G2P drops the plural
}
PAUSE = {"|": 0.16, "||": 0.38}
SR = 24000


def phonemes(k, text, lang="en-us"):
    pat = "(" + "|".join(re.escape(w) for w in sorted(FIXED, key=len, reverse=True)) + ")"
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
    return "".join(out).strip()


def chunks(text):
    """-> [(kind, value)]: ('say', text, emphasis) and ('rest', seconds)."""
    toks = re.split(r"(\|\||\||\{[\d.]+\})", text)
    out = []
    for t in toks:
        t = t.strip()
        if not t:
            continue
        if t in PAUSE:
            out.append(("rest", PAUSE[t]))
        elif t.startswith("{"):
            out.append(("rest", float(t[1:-1])))
        else:
            # *emphasis*: its own chunk, read slower after a lift-in pause
            for i, part in enumerate(re.split(r"\*([^*]+)\*", t)):
                part = part.strip()
                if not part:
                    continue
                if i % 2:
                    out.append(("rest", 0.07))
                    out.append(("say", part, True))
                else:
                    out.append(("say", part, False))
    return out


def trim(x, lead=0.02, tail=0.07):
    idx = np.nonzero(np.abs(x) > 0.008)[0]
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(lead * SR)): min(len(x), idx[-1] + int(tail * SR))]


def speak(k, text, voice, speed):
    parts = []
    for c in chunks(text):
        if c[0] == "rest":
            parts.append(np.zeros(int(c[1] * SR), np.float32))
            continue
        _, say, emph = c
        sp = speed * (0.92 if emph else 1.0)
        x, sr = k.create(phonemes(k, say), voice=voice, speed=sp, lang="en-us", is_phonemes=True)
        x = trim(np.asarray(x, np.float32))
        f = int(0.006 * SR)
        if len(x) > 2 * f:
            x[:f] *= np.linspace(0, 1, f)
            x[-f:] *= np.linspace(1, 0, f)
        parts.append(x)
    y = np.concatenate(parts) if parts else np.zeros(1, np.float32)
    return trim(y, 0.03, 0.08)


def render(lines_path, models, out, voice, speed=1.0, only=""):
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    os.makedirs(out, exist_ok=True)
    lines = json.load(open(lines_path))
    dp = os.path.join(out, "durations.json")
    durs = json.load(open(dp)) if os.path.exists(dp) and only else {}
    for ln in lines:
        if only and ln["id"] not in only.split(","):
            continue
        y = speak(k, ln["text"], ln.get("voice", voice), speed * ln.get("speed", 1.0))
        sf.write(os.path.join(out, ln["id"] + ".wav"), y, SR)
        durs[ln["id"]] = round(len(y) / SR, 3)
        print(f'{ln["id"]:9s} {durs[ln["id"]]:5.2f}s  {ln["text"]}')
    json.dump(durs, open(dp, "w"), indent=1)
    print("total", round(sum(durs.values()), 1))


# ── audition ──
AUDITION_LINES = [
    ("hook", "Eat a player. | Keep their *tokens*."),
    ("rule", "Still standing at the bell? || You get *paid*."),
    ("fee", "Enter with one thousand, | finish on two thousand. || The fee is fifty, | so you get nineteen fifty."),
]
AUDITION_VOICES = [("af_heart", 1.0), ("af_bella", 1.0), ("af_nicole", 1.0), ("af_sarah", 1.0), ("am_michael", 1.0), ("am_fenrir", 1.0), ("bf_emma", 1.0), ("bm_george", 1.0)]


def f0_stats(y):
    """Rough pitch track (autocorrelation, 40 ms frames): median Hz and spread in semitones."""
    hop, win = int(0.02 * SR), int(0.04 * SR)
    f0 = []
    for i in range(0, len(y) - win, hop):
        w = y[i:i + win] * np.hanning(win)
        if np.sqrt(np.mean(w ** 2)) < 0.02:
            continue
        ac = np.correlate(w, w, "full")[win - 1:]
        lo, hi = int(SR / 400), int(SR / 70)
        j = lo + int(np.argmax(ac[lo:hi]))
        if ac[j] > 0.35 * ac[0]:
            f0.append(SR / j)
    if len(f0) < 5:
        return 0.0, 0.0
    f0 = np.array(f0)
    st = 12 * np.log2(f0 / np.median(f0))
    return float(np.median(f0)), float(np.std(st))


def audition(models, out):
    from kokoro_onnx import Kokoro
    k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
    os.makedirs(out, exist_ok=True)
    rows = []
    for v, sp in AUDITION_VOICES:
        for name, text in AUDITION_LINES:
            y = speak(k, text, v, sp)
            sf.write(os.path.join(out, f"{v}-{name}.wav"), y, SR)
            med, spread = f0_stats(y)
            words = len(re.sub(r"[|*{}\d.]", " ", text).split())
            rows.append({"voice": v, "line": name, "dur": round(len(y) / SR, 2), "wpm": round(words / (len(y) / SR) * 60), "f0": round(med), "pitch_spread_st": round(spread, 2)})
            print(rows[-1])
    json.dump(rows, open(os.path.join(out, "audition.json"), "w"), indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["audition"])
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    audition(a.models, a.out)
