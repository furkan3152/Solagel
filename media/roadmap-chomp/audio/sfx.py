"""Roadmap Chomp's own sounds (the mixer, media/free-mint/audio/mix.py, asks this module first and
falls back to the promo's SFX): the waka, the chomp, the grow pop. Clean and synthetic, to match the
minimal picture.

  make({"type": "waka", "pitch": 1.0}) -> mono float array at 48 kHz (None for an unknown type)
"""
import numpy as np
from scipy import signal

SR = 48000


def _t(d):
    return np.arange(int(d * SR)) / SR


def waka(pitch=1.0):
    # a short pitched-down square blip (the mouth closing on a pellet)
    t = _t(0.11)
    f = 520 * pitch * np.exp(-t * 9)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sign(np.sin(ph)) * 0.5 + np.sin(ph) * 0.5
    x = signal.lfilter(*signal.butter(2, 3200 / (SR / 2), "low"), x)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 26)
    return x * env * 0.5


def chomp(big=False):
    # a crunchy bite: a filtered noise crack, a pitched gulp and a low thump
    d = 0.4 if big else 0.28
    t = _t(d)
    r = np.random.default_rng(3 if big else 4)
    crack = signal.lfilter(*signal.butter(2, [900 / (SR / 2), 6000 / (SR / 2)], "band"), r.standard_normal(len(t)))
    crack *= np.exp(-t * (40 if not big else 28))
    f = (300 if big else 380) * np.exp(-t * 7) + 60
    gulp = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (9 if big else 13))
    thump = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-t * 12) + 40) / SR) * np.exp(-t * 14)
    x = crack * 0.6 + gulp * 0.7 + thump * (1.0 if big else 0.7)
    # two jaw clicks
    for k, at in enumerate((0.0, 0.07)):
        i = int(at * SR)
        n = int(0.006 * SR)
        x[i:i + n] += r.standard_normal(n) * np.exp(-np.arange(n) / (0.0015 * SR)) * 0.8
    return x * 0.7


def grow(pitch=1.0):
    # the pop: a bright rising bubble with a sparkle on top
    t = _t(0.32)
    f = 380 * pitch * (1 + 2.2 * (1 - np.exp(-t * 18)))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 10)
    sp = sum(np.sin(2 * np.pi * 2093 * pitch * m * t) * np.exp(-t * 20) / m for m in (1, 2.01, 3.03))
    return (x * 0.8 + sp * 0.25) * np.minimum(1, t / 0.003)


def bloop():
    t = _t(0.2)
    f = 300 + 700 * (1 - np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16) * 0.7


def make(cue):
    ty = cue["type"]
    if ty == "waka":
        return waka(cue.get("pitch", 1.0))
    if ty == "chomp":
        return chomp(cue.get("big", False))
    if ty == "grow":
        return grow(cue.get("pitch", 1.0))
    if ty == "bloop":
        return bloop()
    return None
