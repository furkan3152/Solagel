"""Procedural sound effects for the gameplay film (numpy only), after media/promo/audio/sfx.py and
the game's own kit (apps/web/src/audio/sfx.ts): a chomp, a rubber-stamp thump, a ticket punch, the
round bell and whooshes. Every cue in ../cues.json "sfx" is synthesised and laid on one stereo
track; each sound is also written on its own for the editor.

  python3 sfx.py OUT_DIR        -> OUT_DIR/sfx.wav (the cue track) and OUT_DIR/sfx/<name>.wav
"""
import json
import os
import sys

import numpy as np

import dsp
from dsp import SR, bp, hp, lp, place, t_

HERE = os.path.dirname(os.path.abspath(__file__))
CUES = json.load(open(os.path.join(HERE, "..", "cues.json")))


def _rng(seed):
    return np.random.default_rng(seed)


def bell_env(n, peak=0.5, p=2.0):
    x = np.linspace(0, 1, n)
    return np.where(x < peak, (x / peak) ** p, ((1 - x) / (1 - peak)) ** p)


def pan_sweep(x, a=-0.6, b=0.6):
    p = np.linspace(a, b, len(x))
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)]) * np.sqrt(2)


def whoosh(dur=0.6, up=True, pan=0.0, seed=1):
    """Air past the camera: a band of noise gliding up (or down), a soft low body, a pan drift."""
    r = _rng(seed)
    n = r.standard_normal(int(dur * SR))
    f0, f1 = (350, 4200) if up else (3600, 260)
    x = dsp.sweep(n, f0, f1, "bp", 1.4, 1.0)
    body = lp(r.standard_normal(len(n)), 220) * 0.6
    e = bell_env(len(n), 0.62 if up else 0.4, 2.0)
    y = (x + body * (0.3 if up else 0.6)) * e
    y = y / max(1e-9, np.max(np.abs(y))) * 0.8
    return pan_sweep(y, pan - 0.35, pan + 0.35)


def thump(f0=110, f1=48, dur=0.25, gain=1.0):
    t = t_(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur * 0.35)) * gain


def chomp(small=False, seed=17):
    """A cartoon bite: the jaw (two quick crunchy clicks), a wet downward bloop, a tiny swallow."""
    r = _rng(seed)
    out = np.zeros(int(0.5 * SR))
    for k, at in enumerate((0.0, 0.055)):
        t = t_(0.05)
        crunch = bp(r.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.014) * 1.6
        crunch += bp(r.standard_normal(len(t)), 400, 1500) * np.exp(-t / 0.012) * 0.6
        i = int(at * SR)
        out[i:i + len(t)] += crunch * (2.6 if k == 0 else 1.9)
    t = t_(0.24)
    f = 150 + (560 if not small else 820) * np.exp(-t / 0.05)
    bloop = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07) * np.minimum(1, t / 0.004)
    i = int(0.07 * SR)
    out[i:i + len(t)] += bloop * 0.6
    t = t_(0.12)
    f = 260 * np.exp(-t / 0.04) + 120
    gulp = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.12) ** 2
    i = int(0.27 * SR)
    out[i:i + len(t)] += gulp * 0.35
    out = np.tanh(out * 1.6) / np.tanh(1.6)
    if small:
        out = hp(out, 300) * 0.6
    return out / max(1e-9, np.max(np.abs(out))) * 0.7


def stamp(heavy=False, seed=3):
    """A rubber stamp: the wooden handle's thump, the rubber slapping paper, the paper's crinkle."""
    r = _rng(seed)
    body = thump(170 if heavy else 200, 95 if heavy else 110, 0.3 if heavy else 0.2, 1.0 if heavy else 0.7)
    slap = bp(r.standard_normal(int(0.06 * SR)), 300, 3000) * np.exp(-t_(0.06) / 0.018) * 4.0
    crinkle = hp(r.standard_normal(int(0.14 * SR)), 3200) * np.exp(-t_(0.14) / 0.035) * 0.5
    x = np.zeros(int(0.42 * SR))
    x[:len(body)] += body
    x[:len(slap)] += slap
    i = int(0.009 * SR)
    x[i:i + len(crinkle)] += crinkle
    if heavy:  # a table knock under it
        k = thump(110, 62, 0.28, 0.55)
        x[:len(k)] += k
    x = np.tanh(x * 1.5) / np.tanh(1.5)
    return x / max(1e-9, np.max(np.abs(x))) * 0.7


def punch(seed=5):
    """A ticket punch: the lever's spring click, the die going through card, a small metal ring,
    the chad falling (a light tick)."""
    r = _rng(seed)
    x = np.zeros(int(0.5 * SR))
    t = t_(0.012)
    click = hp(r.standard_normal(len(t)), 2500) * np.exp(-t / 0.002)
    x[:len(t)] += click * 0.7
    t = t_(0.07)
    card = bp(r.standard_normal(len(t)), 600, 4200) * np.exp(-t / 0.014)
    i = int(0.03 * SR)
    x[i:i + len(t)] += card
    t = t_(0.3)
    ring = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((3150, 0.3, 0.07), (4890, 0.18, 0.05), (7340, 0.1, 0.03)))
    x[i:i + len(t)] += ring
    k = thump(180, 90, 0.08, 0.5)
    x[i:i + len(k)] += k
    t = t_(0.02)
    chad = bp(r.standard_normal(len(t)), 3000, 9000) * np.exp(-t / 0.004) * 0.25
    j = int(0.21 * SR)
    x[j:j + len(t)] += chad
    return x / max(1e-9, np.max(np.abs(x))) * 0.7


def bell(seed=7):
    """The round bell, after the game's own: two strikes of a small brass bell, inharmonic partials
    over 659 Hz with a long ring, plus a soft lower hum so it reads as the end of something."""
    r = _rng(seed)
    partials = ((1, 0.09, 2.6), (2.01, 0.05, 1.8), (2.42, 0.035, 1.3), (3.03, 0.025, 0.95), (4.17, 0.015, 0.6), (0.5, 0.03, 3.0))
    out = np.zeros(int(3.4 * SR))
    for i, at in enumerate((0.0, 0.34)):
        soft = 1.0 if i == 0 else 0.8
        o = int(at * SR)
        hit = bp(r.standard_normal(int(0.03 * SR)), 1800, 5400) * np.exp(-t_(0.03) / 0.008) * 0.05 * soft
        out[o:o + len(hit)] += hit
        for ratio, g, dur in partials:
            t = t_(dur)
            env = np.minimum(1, t / 0.004) * np.exp(-t / (dur * 0.28))
            beat = 1 + 0.04 * np.sin(2 * np.pi * 2.3 * t)  # the bell's slow shimmer
            out[o:o + len(t)] += np.sin(2 * np.pi * 659 * ratio * t + ratio) * env * g * soft * beat
    return out / max(1e-9, np.max(np.abs(out))) * 0.7


def tick(seed=9):
    t = t_(0.04)
    x = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / 0.012) for f in (1650, 2900))
    x += hp(_rng(seed).standard_normal(len(t)), 3000) * np.exp(-t / 0.002) * 0.3
    return x / max(1e-9, np.max(np.abs(x))) * 0.6


def make(cue):
    ty = cue["type"]
    if ty == "whoosh":
        return whoosh(cue.get("dur", 0.6), cue.get("up", True), cue.get("pan", 0.0), seed=int(cue["at"] * 100))
    if ty == "chomp":
        return chomp(cue.get("small", False), seed=int(cue["at"] * 100))
    if ty == "stamp":
        return stamp(cue.get("heavy", False), seed=int(cue["at"] * 100))
    if ty == "punch":
        return punch()
    if ty == "bell":
        return bell()
    if ty == "tick":
        return tick()
    raise ValueError(ty)


def main():
    out = sys.argv[1]
    os.makedirs(os.path.join(out, "sfx"), exist_ok=True)
    # the kit, one file each, for the editor
    kit = {"chomp": chomp(), "chomp-small": chomp(True), "stamp": stamp(), "stamp-heavy": stamp(True), "punch": punch(),
           "bell": bell(), "whoosh-up": whoosh(), "whoosh-down": whoosh(0.75, False), "tick": tick()}
    for k, v in kit.items():
        dsp.write_wav(os.path.join(out, "sfx", k + ".wav"), v.astype(np.float32))
    n = int((CUES["duration"] + 0.5) * SR)
    buf = np.zeros((2, n))
    reverb = np.stack([dsp.reverb_ir(0.9, 0.18, 21), dsp.reverb_ir(0.9, 0.18, 22)])
    for cue in CUES["sfx"]:
        x = make(cue)
        place(buf, x, cue["at"], cue.get("gain", 1.0), cue.get("pan", 0.0))
    # a small shared room so the sounds sit in one space
    wet = np.stack([dsp.fftconv(buf[0], reverb[0])[:n], dsp.fftconv(buf[1], reverb[1])[:n]])
    buf = buf + 0.12 * wet
    buf *= 10 ** (-3 / 20) / max(1e-9, np.max(np.abs(buf)))
    dsp.write_wav(os.path.join(out, "sfx.wav"), buf.astype(np.float32))
    print("sfx written", os.path.join(out, "sfx.wav"), "and", len(kit), "kit sounds in", os.path.join(out, "sfx"))


if __name__ == "__main__":
    main()
