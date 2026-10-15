"""Procedural sound design for the Slana videos (numpy only, 48 kHz stereo).

Every sound is synthesised from noise, sines and envelopes with a fixed seed, so a re-render is
bit-identical. `make(name, **kw)` returns a float32 array of shape (n, 2).

  python sfx.py OUT_DIR   writes every sound as a wav for auditioning
"""
import os
import sys

import numpy as np
from scipy import signal

SR = 48000
_rng = np.random.default_rng(11)


def _t(d):
    return np.arange(int(d * SR)) / SR


def _env(n, a, d, curve=4.0):
    """Attack (s) then exponential-ish decay over the rest."""
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na) ** 1.5
    rest = n - na
    if rest > 0:
        e[na:] = np.exp(-curve * np.linspace(0, 1, rest) * (d / max(d, 1e-3)))
    return e


def _bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(0.99, hi / (SR / 2))], "band")
    return signal.lfilter(b, a, x)


def _lp(x, f, order=2):
    b, a = signal.butter(order, min(0.99, f / (SR / 2)), "low")
    return signal.lfilter(b, a, x)


def _hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def _sweep_filter(x, f0, f1, q=1.2, curve=1.0):
    """A state-variable band-pass whose centre glides f0 -> f1 (log)."""
    n = len(x)
    p = np.linspace(0, 1, n) ** curve
    fc = f0 * (f1 / f0) ** p
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1 / q
    y = np.zeros(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        gi = g[i]
        a1 = 1 / (1 + gi * (gi + k))
        v3 = x[i] - ic2
        v1 = a1 * ic1 + gi * a1 * v3
        v2 = ic2 + gi * v1
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        y[i] = v1
    return y


def _st(m, width=0.0, delay_ms=0.0):
    """Mono -> stereo with an optional Haas-style width."""
    m = np.asarray(m, dtype=np.float64)
    if width <= 0:
        return np.stack([m, m], 1)
    d = int(delay_ms * SR / 1000)
    r = np.concatenate([np.zeros(d), m])[: len(m)]
    return np.stack([m * (1 - width * 0.3) + r * width * 0.3, r * (1 - width * 0.3) + m * width * 0.3], 1)


def _norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return (x / m * peak).astype(np.float32)


def whoosh(dur=0.55, up=True, bright=1.0, seed=1):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    x = r.standard_normal(n)
    f0, f1 = (300 * bright, 5200 * bright) if up else (5200 * bright, 260 * bright)
    y = _sweep_filter(x, f0, f1, q=1.6, curve=0.8)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * np.clip(t, 0, 1)) ** 1.6 if up else np.sin(np.pi * np.clip(t, 0, 1)) ** 1.2
    env *= (0.6 + 0.4 * t) if up else (1 - 0.4 * t)
    y *= env
    # a soft tonal body (air moving past)
    body = _lp(r.standard_normal(n), 400) * env * 0.6
    return _norm(_st(y + body, 1.0, 9), 0.8)


def impact(dur=1.1, weight=1.0, seed=2):
    r = np.random.default_rng(seed)
    t = _t(dur)
    f = 38 + 70 * np.exp(-t / 0.05)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / (0.32 * weight))
    knock = _lp(r.standard_normal(len(t)), 900) * np.exp(-t / 0.03) * 1.2
    crack = _bp(r.standard_normal(len(t)), 1800, 7000) * np.exp(-t / 0.012) * 0.5
    tail = _bp(r.standard_normal(len(t)), 120, 900) * np.exp(-t / 0.35) * 0.18
    y = sub * 1.1 + knock + crack + tail
    return _norm(_st(np.tanh(y * 1.4), 0.6, 7), 0.95)


def stamp(dur=0.45, seed=3):
    """A rubber stamp on paper: a woody thud and a paper slap."""
    r = np.random.default_rng(seed)
    t = _t(dur)
    f = 95 + 120 * np.exp(-t / 0.02)
    thud = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)
    slap = _bp(r.standard_normal(len(t)), 700, 4200) * np.exp(-t / 0.018)
    rattle = _bp(r.standard_normal(len(t)), 2500, 6000) * np.exp(-((t - 0.05) ** 2) / 0.0004) * 0.2
    y = thud * 1.0 + slap * 0.9 + rattle
    return _norm(_st(np.tanh(y * 1.3), 0.3, 5), 0.9)


def paper(dur=0.6, seed=4):
    """A sheet sliding fast across the frame (the wipes)."""
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    x = r.standard_normal(n)
    y = _sweep_filter(x, 900, 3800, q=0.9, curve=1.0)
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t) ** 1.3
    crinkle = np.zeros(n)
    for _ in range(int(40 * dur)):
        i = r.integers(0, n - 400)
        crinkle[i: i + 300] += _bp(r.standard_normal(300), 2000, 8000) * np.exp(-np.arange(300) / 40) * r.uniform(0.2, 0.7)
    return _norm(_st(y * env + crinkle * env * 0.5, 1.0, 11), 0.75)


def tick(seed=5):
    r = np.random.default_rng(seed)
    t = _t(0.05)
    y = _bp(r.standard_normal(len(t)), 1500, 6500) * np.exp(-t / 0.006) + np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.004) * 0.4
    return _norm(_st(y), 0.6)


def pop(pitch=1.0, seed=6):
    t = _t(0.16)
    f = (380 + 900 * (1 - np.exp(-t / 0.03))) * pitch
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.045)
    y += _bp(np.random.default_rng(seed).standard_normal(len(t)), 2000, 6000) * np.exp(-t / 0.004) * 0.3
    return _norm(_st(y), 0.7)


def coin(pitch=1.0, seed=7):
    """A small bright coin ting (FM bell)."""
    t = _t(0.7)
    f = 2093 * pitch
    mod = np.sin(2 * np.pi * f * 1.41 * t) * 2.2 * np.exp(-t / 0.08)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.18)
    y += np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.06) * 0.3
    return _norm(_st(y, 0.5, 4), 0.55)


def coins(n=9, spread=0.5, seed=8):
    r = np.random.default_rng(seed)
    out = np.zeros((int((spread + 0.8) * SR), 2))
    for i in range(n):
        at = int(r.uniform(0, spread) * SR)
        c = coin(r.uniform(0.85, 1.35), seed=seed + i) * r.uniform(0.4, 1.0)
        pan = r.uniform(-0.6, 0.6)
        c[:, 0] *= 1 - max(0, pan)
        c[:, 1] *= 1 + min(0, pan)
        out[at: at + len(c)] += c[: len(out) - at]
    return _norm(out, 0.7)


def riser(dur=1.6, seed=9):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = r.standard_normal(n)
    y = _sweep_filter(x, 200, 7000, q=2.2, curve=1.6) * t ** 2.2
    f = 110 * 2 ** (t * 2.0)
    saw = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR) * t ** 2 * 0.25
    return _norm(_st(y + _lp(saw, 3000), 1.0, 13), 0.7)


def printer(dur=1.6, seed=10):
    """A thermal receipt printer: line feeds at ~16 Hz with a motor whine."""
    r = np.random.default_rng(seed)
    t = _t(dur)
    gate = (np.sin(2 * np.pi * 15.5 * t) > 0.2).astype(float)
    gate = _lp(gate, 120)
    buzz = signal.square(2 * np.pi * 210 * t) * 0.15 + _bp(r.standard_normal(len(t)), 1200, 5000) * 0.6
    motor = np.sin(2 * np.pi * 820 * t) * 0.08
    env = np.clip(t / 0.03, 0, 1) * np.clip((dur - t) / 0.05, 0, 1)
    return _norm(_st((buzz * gate + motor) * env, 0.4, 6), 0.55)


def kaching(seed=12):
    t = _t(1.4)
    y = np.zeros(len(t))
    for f, a, d in ((1568, 1.0, 0.5), (2093, 0.8, 0.45), (2637, 0.55, 0.35), (3136, 0.4, 0.3)):
        y += np.sin(2 * np.pi * f * t + 1.5 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.05)) * a * np.exp(-t / d)
    drawer = np.zeros(len(t))
    i = int(0.02 * SR)
    drawer[i:] = (_bp(np.random.default_rng(seed).standard_normal(len(t) - i), 300, 2500) * np.exp(-np.arange(len(t) - i) / SR / 0.06))
    out = _st(y * 0.6 + drawer * 0.5, 0.6, 5)
    c = coins(7, 0.35, seed=seed + 3)
    out[int(0.08 * SR): int(0.08 * SR) + len(c)] += c[: len(out) - int(0.08 * SR)] * 0.6
    return _norm(out, 0.8)


def sub(dur=1.4):
    t = _t(dur)
    f = 55 * np.exp(-t / 1.2) + 30
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5) * np.clip(t / 0.01, 0, 1)
    return _norm(_st(np.tanh(y * 1.5)), 0.9)


def swell(dur=0.9, seed=13):
    """A reverse-cymbal swell into a cut."""
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    y = _hp(r.standard_normal(n), 3000) * t ** 3
    return _norm(_st(y, 1.0, 12), 0.6)


def kick(seed=14):
    t = _t(0.45)
    f = 48 + 110 * np.exp(-t / 0.035)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    y += _lp(np.random.default_rng(seed).standard_normal(len(t)), 3000) * np.exp(-t / 0.004) * 0.35
    return _norm(_st(np.tanh(y * 1.6)), 0.9)


def snare(seed=15):
    r = np.random.default_rng(seed)
    t = _t(0.35)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.6
    noise = _bp(r.standard_normal(len(t)), 1200, 9000) * np.exp(-t / 0.09)
    clap = np.zeros(len(t))
    for d in (0.0, 0.009, 0.019):
        i = int(d * SR)
        clap[i:] += _bp(r.standard_normal(len(t) - i), 900, 3500) * np.exp(-np.arange(len(t) - i) / SR / 0.012)
    return _norm(_st(body + noise * 0.8 + clap * 0.5, 0.4, 3), 0.85)


def hat(open_=False, seed=16):
    t = _t(0.25 if open_ else 0.06)
    y = _hp(np.random.default_rng(seed).standard_normal(len(t)), 7000) * np.exp(-t / (0.08 if open_ else 0.015))
    return _norm(_st(y), 0.5)


def gulp(seed=17):
    """The eat: a quick downward bloop with a wet click."""
    t = _t(0.3)
    f = 520 * np.exp(-t / 0.06) + 140
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.08)
    y += _bp(np.random.default_rng(seed).standard_normal(len(t)), 1500, 5000) * np.exp(-t / 0.006) * 0.4
    return _norm(_st(y, 0.3, 4), 0.85)


SOUNDS = {
    "whoosh": lambda **k: whoosh(**k),
    "whoosh_down": lambda **k: whoosh(up=False, **k),
    "impact": impact,
    "stamp": stamp,
    "paper": paper,
    "tick": tick,
    "pop": pop,
    "coin": coin,
    "coins": coins,
    "riser": riser,
    "printer": printer,
    "kaching": kaching,
    "sub": sub,
    "swell": swell,
    "kick": kick,
    "snare": snare,
    "hat": hat,
    "ohat": lambda **k: hat(open_=True, **k),
    "gulp": gulp,
}
_cache = {}


def make(name, **kw):
    key = (name, tuple(sorted(kw.items())))
    if key not in _cache:
        _cache[key] = SOUNDS[name](**kw).astype(np.float32)
    return _cache[key]


if __name__ == "__main__":
    import soundfile as sf

    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for n in SOUNDS:
        sf.write(os.path.join(out, n + ".wav"), make(n), SR)
        print(n)
