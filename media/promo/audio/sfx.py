"""Procedural sound effects for the Slana promo (paper, ink, coins, stamps).

Every cue in ../timeline.json "sfx" is synthesised here and laid onto one
stereo track.   python sfx.py OUT.wav
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

import music as M
from music import SR, bp, hp, lp, tvec

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
rs = np.random.default_rng(99)


def noise(dur):
    return rs.standard_normal(int(dur * SR))


def bell_env(n, peak=0.5, p=2.0):
    x = np.linspace(0, 1, n)
    return np.where(x < peak, (x / peak) ** p, ((1 - x) / (1 - peak)) ** p)


def sweep_band(x, f0, f1, width=0.6, blk=1024):
    out = np.zeros_like(x)
    n = len(x)
    for i in range(0, n, blk):
        k = i / max(1, n - 1)
        fc = f0 * (f1 / f0) ** k if f0 > 0 and f1 > 0 else f0
        lo, hi = max(40, fc * (1 - width)), min(20000, fc * (1 + width))
        seg = x[max(0, i - blk): i + blk]
        y = bp(seg, lo, hi)
        take = min(blk, n - i)
        out[i: i + take] = y[-take:] if i else y[:take]
    return out


def whoosh(dur, f0, f1, gain=1.0, peak=0.55):
    x = sweep_band(noise(dur), f0, f1, 0.5)
    e = bell_env(len(x), peak, 2.2)
    return x * e * gain * 0.9


def pan_sweep(x, a=-0.8, b=0.8):
    p = np.linspace(a, b, len(x))
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)])


def thump(f0=95, f1=45, dur=0.22, gain=1.0):
    t = tvec(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur * 0.35)) * gain


def click(dur=0.006, f=4000, gain=1.0):
    t = tvec(dur)
    return hp(rs.standard_normal(len(t)), f) * np.exp(-t / (dur * 0.3)) * gain


def ping(f, dur=0.25, gain=1.0, ratio=2.76):
    t = tvec(dur)
    mod = np.sin(2 * np.pi * f * ratio * t) * 1.5 * np.exp(-t / 0.02)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t / (dur * 0.3)) * gain


def coins(dur, n, gain=1.0, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros((2, int((dur + 0.4) * SR)))
    times = np.sort(r.uniform(0, dur, n) ** 1.6 / dur ** 0.6)
    for t0 in times:
        f = r.uniform(2400, 5200)
        x = ping(f, 0.22, r.uniform(0.25, 0.6))
        x[: int(0.12 * SR)] += ping(f * 1.52, 0.12, 0.2)
        x[: len(click())] += click(gain=0.4)
        M.place(out, x, t0, 1.0, r.uniform(-0.7, 0.7))
    return out * gain


def stamp(gain=1.0, light=False):
    body = thump(110 if not light else 150, 48, 0.25, 1.0 if not light else 0.6)
    slap = bp(noise(0.06), 250, 2600) * np.exp(-tvec(0.06) / 0.012) * 0.9
    crinkle = hp(noise(0.12), 3000) * np.exp(-tvec(0.12) / 0.03) * 0.25
    x = np.zeros(int(0.3 * SR))
    x[: len(body)] += body
    x[: len(slap)] += slap
    i = int(0.008 * SR)
    x[i: i + len(crinkle)] += crinkle
    return np.tanh(x * 1.5) * gain


def gulp(low=False):
    t = tvec(0.42)
    out = np.zeros(len(t))
    for k, (t0, f0, f1) in enumerate([(0.0, 520, 160), (0.13, 380, 110)]):
        if low:
            f0, f1 = f0 * 0.55, f1 * 0.55
        tt = tvec(0.14)
        f = f1 + (f0 - f1) * np.exp(-tt / 0.035)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * np.clip(tt / 0.14, 0, 1)) ** 0.6
        x = bp(x + 0.3 * rs.standard_normal(len(tt)) * np.exp(-tt / 0.01), 90, 2400)
        i = int(t0 * SR)
        out[i: i + len(x)] += x * (1.0 if k == 0 else 0.7)
    if low:
        out = np.tanh(out * 2.2) * 0.8
        out[: int(0.3 * SR)] += thump(80, 35, 0.3, 0.8)
    return out


def printer(dur, gain=1.0):
    n = int(dur * SR)
    out = np.zeros(n)
    steps = 26
    for s in range(steps):
        t0 = s * dur / steps
        burst = int(dur / steps * SR * 0.6)
        tt = np.arange(burst) / SR
        pulses = (np.sin(2 * np.pi * 210 * tt) > 0.6).astype(float)
        x = bp(pulses + 0.4 * rs.standard_normal(burst), 900, 5200) * np.sin(np.pi * tt / tt[-1]) ** 0.5
        i = int(t0 * SR)
        out[i: i + burst] += x[: n - i]
    whine = np.sin(2 * np.pi * 2350 * tvec(dur)) * 0.04 * (1 + 0.5 * np.sin(2 * np.pi * 7 * tvec(dur)))
    return (out * 0.45 + whine[:n]) * gain


def roll(dur, gain=1.0):
    n = int(dur * SR)
    out = np.zeros(n)
    t = 0.0
    while t < dur:
        k = t / dur
        rate = 26 * (1 - k) + 6
        c = click(0.004, 2500, 0.6) + ping(1800 + 600 * k, 0.03, 0.15)[: len(click(0.004))]
        i = int(t * SR)
        out[i: i + len(c)] += c[: n - i]
        t += 1 / rate
    return out * gain


def tape(gain=1.0):
    dur = 0.32
    t = tvec(dur)
    crackle = (rs.random(len(t)) > 0.985).astype(float) * rs.uniform(-1, 1, len(t))
    x = bp(crackle * 3 + 0.5 * rs.standard_normal(len(t)), 900, 7000)
    e = np.clip(t / 0.03, 0, 1) * np.exp(-np.clip(t - 0.2, 0, None) / 0.04)
    am = 0.6 + 0.4 * np.sin(2 * np.pi * 55 * t)
    return x * e * am * gain * 0.8


def punch(gain=1.0):
    x = np.zeros(int(0.4 * SR))
    c = click(0.004, 3000, 1.0)
    x[: len(c)] += c
    p = ping(1850, 0.18, 0.5, 1.41)
    x[: len(p)] += p
    th = thump(140, 60, 0.12, 0.7)
    i = int(0.012 * SR)
    x[i: i + len(th)] += th
    c2 = click(0.005, 2000, 0.6)
    i = int(0.06 * SR)
    x[i: i + len(c2)] += c2
    return x * gain


def fire(dur, gain=1.0):
    n = int(dur * SR)
    t = tvec(dur)
    roar = lp(rs.standard_normal(n), 500) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 1.3 * t)))
    crack = np.zeros(n)
    for _ in range(int(dur * 38)):
        i = rs.integers(0, n - 2000)
        c = click(rs.uniform(0.002, 0.01), rs.uniform(1500, 5000), rs.uniform(0.2, 1.0))
        crack[i: i + len(c)] += c
    e = np.clip(t / 0.4, 0, 1) * np.clip((dur - t) / 0.5, 0, 1)
    return (roar * 0.9 + crack * 0.6) * e * gain


def page(gain=1.0):
    dur = 0.65
    t = tvec(dur)
    x = bp(rs.standard_normal(len(t)), 1500, 9000)
    flutter = 0.55 + 0.45 * np.sin(2 * np.pi * (12 + 10 * t / dur) * t)
    return x * flutter * bell_env(len(t), 0.6, 1.6) * gain * 0.7


def seal(gain=1.0):
    x = np.zeros(int(0.35 * SR))
    for k in range(5):
        c = click(rs.uniform(0.002, 0.006), 1800, rs.uniform(0.4, 1.0))
        i = int(rs.uniform(0, 0.07) * SR)
        x[i: i + len(c)] += c
    th = thump(220, 90, 0.08, 0.6)
    x[: len(th)] += th
    return x * gain


def pop(gain=1.0):
    t = tvec(0.09)
    f = 300 + 900 * (1 - np.exp(-t / 0.02))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.03)
    x[: len(click())] += click(gain=0.3)
    return x * gain * 0.8


def boing(gain=1.0):
    t = tvec(0.45)
    f = 260 + 70 * np.sin(2 * np.pi * 16 * t) * np.exp(-t / 0.15)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12) * gain * 0.6


def pickup(gain=1.0):
    t = tvec(0.12)
    f = 900 + 900 * (t / 0.12)
    x = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)) * np.exp(-t / 0.05)
    return x * gain * 0.5


def ink(gain=1.0):
    dur = 0.7
    t = tvec(dur)
    swell = lp(rs.standard_normal(len(t)), 700) * (t / dur) ** 1.5 * 1.4
    bub = np.zeros(len(t))
    for _ in range(14):
        t0 = rs.uniform(0, dur - 0.08)
        f = rs.uniform(180, 520)
        tt = tvec(0.07)
        b = np.sin(2 * np.pi * np.cumsum(f * (1 + 2 * tt / 0.07)) / SR) * np.sin(np.pi * tt / 0.07)
        i = int(t0 * SR)
        bub[i: i + len(b)] += b * 0.3
    return (swell + bub) * gain


def type_(dur, gain=1.0):
    n = int(dur * SR)
    out = np.zeros(n)
    t = 0.0
    while t < dur:
        c = click(0.003, 3500, rs.uniform(0.2, 0.5))
        i = int(t * SR)
        out[i: i + len(c)] += c[: n - i]
        t += rs.uniform(0.022, 0.04)
    return out * gain


def shutter(gain=1.0):
    x = np.zeros(int(0.08 * SR))
    for t0 in (0.0, 0.032):
        c = click(0.005, 2500, 0.8)
        i = int(t0 * SR)
        x[i: i + len(c)] += c
    return x * gain


def hit(gain=1.0):
    k = M.kick(0.8)
    c = M.clap(0.5)
    x = np.zeros(max(len(k), len(c)))
    x[: len(k)] += k
    x[: len(c)] += c
    return x * gain


def book(gain=1.0):
    w = whoosh(0.4, 300, 1200, 0.5)
    th = thump(90, 50, 0.18, 0.6)
    x = np.zeros(int(0.5 * SR))
    x[: len(w)] += w
    i = int(0.32 * SR)
    x[i: i + len(th)] += th[: len(x) - i]
    return x * gain


def round_bell(gain=1.0):
    """The round bell, after the game's own (apps/web/src/audio/sfx.ts): two strikes of a small
    brass bell, inharmonic partials over a 659 Hz fundamental with a long ring."""
    partials = ((1, 0.09, 2.2), (2.01, 0.05, 1.6), (2.42, 0.035, 1.2), (3.03, 0.025, 0.9), (4.17, 0.015, 0.6))
    out = np.zeros(int(2.8 * SR))
    for i, at in enumerate((0.0, 0.34)):
        soft = 1.0 if i == 0 else 0.8
        o = int(at * SR)
        hit = bp(noise(0.03), 1800, 5400) * np.exp(-tvec(0.03) / 0.008) * 0.05 * soft
        out[o:o + len(hit)] += hit
        for ratio, g, dur in partials:
            t = tvec(dur)
            env = np.minimum(1, t / 0.004) * np.exp(-t / (dur * 0.28))
            x = np.sin(2 * np.pi * 659 * ratio * t) * env * g * soft
            out[o:o + len(x)] += x
    return out / max(1e-9, np.max(np.abs(out))) * gain


def make(cue):
    ty = cue["type"]
    d = cue.get("dur", 0)
    if ty == "tick":
        x = ping(2200, 0.03, 0.3)
        x[: len(click(0.004))] += click(0.004, 3000, 0.6)
        return x
    if ty == "whoosh_s":
        return pan_sweep(whoosh(0.45, 500, 3500), -0.6, 0.6)
    if ty == "whoosh_l":
        return pan_sweep(whoosh(0.95, 250, 2600, 1.0, 0.65), 0.6, -0.6)
    if ty == "whip":
        return pan_sweep(whoosh(0.5, 900, 7000, 1.2, 0.5), -1, 1)
    if ty == "dive":
        w = whoosh(1.2, 200, 5000, 1.0, 0.88)
        w += lp(rs.standard_normal(len(w)), 160) * np.linspace(0, 1, len(w)) ** 2 * 0.8
        return w
    if ty == "gulp":
        return gulp(False)
    if ty == "gulp_low":
        return gulp(True)
    if ty == "coins_s":
        return coins(0.35, 9, 1.0, 1)
    if ty == "coins_l":
        return coins(1.0, 34, 1.0, 2)
    if ty == "roll":
        return roll(d)
    if ty == "impact":
        return M.impact(1.0)
    if ty == "stamp":
        return stamp()
    if ty == "stamp_l":
        return stamp(0.8, True)
    if ty == "type":
        return type_(d)
    if ty == "tape":
        return tape()
    if ty == "punch":
        return punch()
    if ty == "hit":
        return hit()
    if ty == "shutter":
        return shutter()
    if ty == "printer":
        return printer(d)
    if ty == "ink":
        return ink()
    if ty == "sub":
        return thump(60, 28, 1.4, 1.0)
    if ty == "pickup":
        return pickup()
    if ty == "page":
        return pan_sweep(page(), 0.7, -0.7)
    if ty == "thud":
        return thump(85, 45, 0.25, 0.8) + np.pad(bp(noise(0.05), 300, 3000) * 0.3, (0, int(0.2 * SR)))[: int(0.25 * SR)]
    if ty == "seal":
        return seal()
    if ty == "slide":
        return whoosh(0.4, 1200, 3500, 0.7)
    if ty == "book":
        return book()
    if ty == "pop":
        return pop()
    if ty == "fire":
        return fire(d)
    if ty == "boing":
        return boing()
    if ty == "bell":
        return round_bell()
    raise ValueError(ty)


def main():
    out = sys.argv[1]
    # --cues sfx2: the cut's own cues (film time) instead of the scene timeline's
    key = sys.argv[sys.argv.index("--cues") + 1] if "--cues" in sys.argv else "sfx"
    n = int((TL["duration"] + 1.2) * SR)
    buf = np.zeros((2, n))
    for cue in TL[key]:
        x = make(cue)
        g = cue.get("gain", 1.0)
        if x.ndim == 2:
            i = int(cue["at"] * SR)
            m = min(x.shape[1], n - i)
            buf[:, i: i + m] += x[:, :m] * g
        else:
            M.place(buf, x, cue["at"], g, cue.get("pan", 0.0))
    buf *= 10 ** (-3 / 20) / max(1e-9, np.max(np.abs(buf)))
    sf.write(out, buf.T.astype(np.float32), SR, subtype="FLOAT")
    print("sfx written", out)


if __name__ == "__main__":
    main()
