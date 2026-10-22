"""Original score for the Slana promo, synthesised from scratch with numpy.

Playful lo-fi electronic at 100 BPM (one beat = 0.6 s = 36 video frames), scored
to the cut list in ../timeline.json: a held breath before the logo drop, a
drop-out when the bots arrive, a whip crash into the join desk, a second breath
before the end card and a final sting.

  python music.py OUT.wav
"""
import json
import os
import sys

import numpy as np
from scipy import signal

SR = 48000
BEAT = 0.6
BAR = BEAT * 4
HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
DUR = TL["duration"] + 1.2
N = int(DUR * SR)
rs = np.random.default_rng(1234)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def place(buf, x, at, gain=1.0, pan=0.0):
    """Mix mono x into stereo buf at time `at` with constant-power pan."""
    i = int(round(at * SR))
    if i >= buf.shape[1]:
        return
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), buf.shape[1] - i)
    l = np.cos((pan + 1) * np.pi / 4) * gain
    r = np.sin((pan + 1) * np.pi / 4) * gain
    buf[0, i:i + n] += x[:n] * l
    buf[1, i:i + n] += x[:n] * r


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), "low")
    return signal.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], "band")
    return signal.lfilter(b, a, x)


def env_exp(n, decay):
    return np.exp(-np.arange(n) / SR / decay)


def adsr(n, a, d, s, r, hold=None):
    t = np.arange(n) / SR
    e = np.ones(n) * s
    e[t < a] = t[t < a] / a
    m = (t >= a) & (t < a + d)
    e[m] = 1 - (1 - s) * (t[m] - a) / d
    rel_start = (hold if hold is not None else n / SR - r)
    m = t >= rel_start
    e[m] *= np.clip(1 - (t[m] - rel_start) / r, 0, 1)
    return e


def biquad(x, kind, f0, gain_db, q):
    """RBJ cookbook peaking / high-shelf filter applied along the last axis."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == "peak":
        b = [1 + alpha * A, -2 * c, 1 - alpha * A]
        a = [1 + alpha / A, -2 * c, 1 - alpha / A]
    else:  # highshelf
        sq = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
        a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)


# ───────────── instruments ─────────────
def kick(gain=1.0, dur=0.45):
    t = tvec(dur)
    f = 46 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t / 0.16)
    x += 0.35 * np.sin(ph * 2) * np.exp(-t / 0.03)
    click = hp(rs.standard_normal(len(t)), 3000) * np.exp(-t / 0.004) * 0.25
    return np.tanh((x + click) * 1.6) * gain


def clap(gain=1.0):
    t = tvec(0.5)
    n = rs.standard_normal(len(t))
    e = np.zeros(len(t))
    for k, d in enumerate([0, 0.011, 0.022, 0.031]):
        i = int(d * SR)
        e[i:] += np.exp(-(t[: len(t) - i]) / (0.006 if k < 3 else 0.12)) * (0.8 if k < 3 else 1.0)
    x = bp(n, 900, 5200) * e
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.4
    return (x + body) * gain * 0.7


def hat(open_=False, gain=1.0):
    t = tvec(0.35 if open_ else 0.09)
    n = rs.standard_normal(len(t))
    metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (3200, 4570, 6230, 8120)) * 0.15
    x = hp(n * 0.7 + metal, 7000, 4) * np.exp(-t / (0.11 if open_ else 0.022))
    return x * gain * 0.55


def shaker(gain=1.0):
    t = tvec(0.12)
    x = bp(rs.standard_normal(len(t)), 5000, 11000) * np.sin(np.pi * np.clip(t / 0.12, 0, 1)) ** 2
    return x * gain * 0.3


def bass_note(m, dur, gain=1.0, dark=False):
    t = tvec(dur + 0.08)
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    e = adsr(len(t), 0.006, 0.12, 0.7, 0.06, hold=dur)
    x = np.tanh(x * (1.8 if not dark else 1.3)) * e
    x = lp(x, 900 if not dark else 420)
    return x * gain * 0.5


def saw_add(f, t, maxh=40):
    x = np.zeros(len(t))
    for h in range(1, maxh + 1):
        if f * h > 14000:
            break
        x += np.sin(2 * np.pi * f * h * t) / h
    return x


def chord_stab(ms, dur, gain=1.0, cutoff=2200):
    t = tvec(dur + 0.25)
    x = np.zeros(len(t))
    for m in ms:
        for det in (-0.09, 0.0, 0.08):
            x += saw_add(mtof(m + det), t, 24)
    e = adsr(len(t), 0.004, 0.18, 0.35, 0.2, hold=dur)
    x = lp(x * e, cutoff, 2)
    return x * gain * 0.06


def pad(ms, dur, gain=1.0, bright=900):
    t = tvec(dur + 1.0)
    x = np.zeros(len(t))
    for m in ms:
        for det in (-0.12, 0.11):
            f = mtof(m + det)
            x += np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.4 * t)) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    e = adsr(len(t), 0.6, 0.5, 0.8, 0.9, hold=dur)
    return lp(x * e, bright) * gain * 0.05


def bell(m, dur=0.9, gain=1.0, ratio=3.5, index=2.2):
    t = tvec(dur)
    f = mtof(m)
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t / 0.18)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / (dur * 0.35))
    x *= np.clip(t / 0.002, 0, 1)
    return x * gain * 0.22


def pluck(m, gain=1.0):
    # soft marimba-ish FM pluck
    t = tvec(0.5)
    f = mtof(m)
    mod = np.sin(2 * np.pi * f * 4.0 * t) * 1.3 * np.exp(-t / 0.03)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.16) * np.clip(t / 0.003, 0, 1)
    return x * gain * 0.25


def noise_riser(dur, gain=1.0, f0=400, f1=9000):
    t = tvec(dur)
    n = rs.standard_normal(len(t))
    # sweep a band through the noise in short blocks
    out = np.zeros(len(t))
    blk = 2048
    for i in range(0, len(t), blk):
        k = i / len(t)
        fc = f0 * (f1 / f0) ** k
        seg = n[max(0, i - blk): i + blk]
        y = bp(seg, fc * 0.7, min(fc * 1.4, 20000))
        out[i: i + blk] = y[-min(blk, len(t) - i):] if i else y[:blk]
    sweep = np.sin(2 * np.pi * np.cumsum(220 * (8 ** (t / dur))) / SR) * 0.25
    e = (t / dur) ** 2.2
    return (out * 0.8 + sweep) * e * gain * 0.6


def crash(gain=1.0, dur=2.2):
    t = tvec(dur)
    n = hp(rs.standard_normal(len(t)), 4500, 2)
    ring = sum(np.sin(2 * np.pi * f * t + rs.uniform(0, 6)) for f in (5170, 6810, 7930, 9450, 11300)) * 0.06
    return (n * 0.5 + ring) * np.exp(-t / 0.55) * gain * 0.5


def reverse_crash(dur=0.6, gain=1.0):
    return crash(gain, dur)[::-1] * np.linspace(0, 1, int(dur * SR)) ** 2


def impact(gain=1.0):
    t = tvec(2.4)
    f = 32 + 60 * np.exp(-t / 0.08)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    n = lp(rs.standard_normal(len(t)), 2500) * np.exp(-t / 0.25) * 0.5
    return np.tanh((sub * 1.4 + n) * 1.3) * gain * 0.9


def sub_drone(dur, m, gain=1.0):
    t = tvec(dur)
    x = np.sin(2 * np.pi * mtof(m) * t) * adsr(len(t), 0.4, 0.2, 1.0, 0.6)
    x += 0.2 * np.sin(2 * np.pi * mtof(m + 12) * t + 0.5 * np.sin(2 * np.pi * 0.3 * t))
    return x * gain * 0.35


def vinyl(dur, gain=1.0):
    t = tvec(dur)
    hiss = lp(hp(rs.standard_normal(len(t)), 2000), 7000) * 0.02
    clicks = np.zeros(len(t))
    idx = rs.integers(0, len(t), int(dur * 9))
    clicks[idx] = rs.uniform(0.2, 1.0, len(idx)) * rs.choice([-1, 1], len(idx))
    clicks = hp(clicks, 1500)
    return (hiss + clicks * 0.25) * gain


def reverb_ir(dur=1.6, decay=0.45, seed=7):
    r = np.random.default_rng(seed)
    t = tvec(dur)
    ir = r.standard_normal(len(t)) * np.exp(-t / decay)
    ir = lp(ir, 6000)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return ir / np.sqrt(np.sum(ir ** 2))


# ───────────── arrangement ─────────────
PROG = [  # bright (C major colour): Fmaj7, G6, Em7, Am7
    ([53, 57, 60, 64], 41),
    ([55, 59, 62, 64], 43),
    ([52, 55, 59, 62], 40),
    ([57, 60, 64, 67], 45),
]
DARK = [([57, 60, 64], 33), ([53, 57, 60], 29), ([50, 53, 57], 38), ([52, 56, 59], 40)]


def chord_at(t, dark=False):
    bar = int(np.floor((t - 4.8) / BAR + 1e-6))
    p = DARK if dark else PROG
    return p[bar % 4]


SECTIONS = [
    # start, end, name
    (0.0, 4.62, "intro"),
    (4.8, 8.4, "logo"),
    (8.4, 14.4, "A"),
    (14.4, 20.4, "B"),
    (20.4, 25.8, "A2"),
    (25.8, 26.4, "sweep"),
    (26.4, 28.8, "darkin"),
    (28.8, 30.55, "dark"),
    (30.55, 31.2, "turn"),
    (31.2, 36.9, "bright"),
    (36.9, 37.2, "whip"),
    (37.2, 41.4, "B2"),
    (41.4, 42.0, "fill"),
    (42.0, 44.4, "A3"),
    (44.4, 46.62, "tension"),
    (46.8, 51.6, "outro"),
    (51.6, 54.0, "sting"),
    # cut only: the NFT beat (film 36.0 - 42.0) is scored here, after the scene timeline
    (62.4, 67.2, "nft"),
    (67.2, 68.4, "nft-breath"),
]


def section(t):
    for a, b, n in SECTIONS:
        if a <= t < b:
            return n
    return None


def build():
    drums = np.zeros((2, N))
    bass = np.zeros((2, N))
    keys = np.zeros((2, N))
    lead = np.zeros((2, N))
    fx = np.zeros((2, N))
    swing = 0.035

    # vinyl bed across everything (tiny), stronger in the intro
    place(fx, vinyl(DUR, 0.6), 0, 1.0, 0.0)

    # ── intro: filtered pad + pluck motif, riser, breath ──
    place(keys, pad(PROG[0][0], 2.4, 1.0, 700), 0.0, 0.9)
    place(keys, pad(PROG[1][0], 2.4, 1.0, 800), 2.4, 0.9)
    motif = [72, 76, 79, 76, 74, 77, 81, 77]
    for i in range(16):
        tt = i * 0.3
        if tt >= 4.4:
            break
        m = motif[i % 8] - (0 if i < 8 else 2)
        place(lead, pluck(m, 0.9 if i % 2 == 0 else 0.55), tt + (swing if i % 2 else 0), 1.0, -0.3 + 0.6 * (i % 2))
    place(bass, bass_note(41, 0.5, 0.8), 2.4)  # the gulp lands on a low F
    for k in range(4):
        place(drums, shaker(0.7), 2.4 + k * 0.3 + (swing if k % 2 else 0), 1.0, 0.4)
    place(fx, noise_riser(1.02, 1.0), 3.6, 0.9)

    # ── grooves ──
    def groove(a, b, kick_pat="full", hats=True, open_hats=True, stabs=True, bass_on=True, dark=False,
               bells=False, shakers=False, cutoff=2400, half=False):
        nb = int(round((b - a) / BEAT))
        for bi in range(nb):
            tb = a + bi * BEAT
            beat_in_bar = int(round((tb - 4.8) / BEAT)) % 4
            ch, root = chord_at(tb + 0.01, dark)
            # kick
            if kick_pat == "full":
                if beat_in_bar in (0, 2):
                    place(drums, kick(1.0), tb)
                if beat_in_bar == 1:
                    place(drums, kick(0.55), tb + BEAT * 0.75)
            elif kick_pat == "half":
                if beat_in_bar == 0:
                    place(drums, kick(1.0), tb)
                if beat_in_bar == 2:
                    place(drums, kick(0.6), tb + BEAT * 0.5)
            elif kick_pat == "four":
                place(drums, kick(0.9), tb)
            # clap
            if not half and beat_in_bar in (1, 3):
                place(drums, clap(0.8), tb, 1.0, 0.05)
            if half and beat_in_bar == 2:
                place(drums, clap(0.9), tb, 1.0, 0.05)
            # hats (swung 16ths)
            if hats:
                for s in range(4):
                    ts = tb + s * BEAT / 4 + (swing if s % 2 else 0)
                    v = [0.55, 0.25, 0.4, 0.22][s]
                    place(drums, hat(False, v), ts, 1.0, 0.35)
            if open_hats:
                place(drums, hat(True, 0.35), tb + BEAT / 2 + swing, 1.0, -0.3)
            if shakers:
                place(drums, shaker(0.6), tb + BEAT * 0.25, 1.0, -0.45)
                place(drums, shaker(0.4), tb + BEAT * 0.75 + swing, 1.0, -0.45)
            # bass: root on the beat, octave pop on the off
            if bass_on:
                pat = [(0, 0, 0.42), (0.5, 12 if not dark else 0, 0.2)]
                if beat_in_bar == 3 and not dark:
                    pat = [(0, 0, 0.3), (0.5, 7, 0.2)]
                for off, iv, d in pat:
                    place(bass, bass_note(root + iv, d, 0.95 if off == 0 else 0.6, dark), tb + off * BEAT + (swing if off else 0))
            # chord stabs on the off-beats
            if stabs:
                place(keys, chord_stab(ch, 0.16, 0.9, cutoff), tb + BEAT / 2 + swing, 1.0, 0.0)
                if beat_in_bar == 3:
                    place(keys, chord_stab(ch, 0.12, 0.6, cutoff), tb + BEAT * 0.75 + swing, 1.0, 0.0)
            if bells:
                arp = [0, 2, 1, 3, 2, 1, 3, 2]
                for s in range(2):
                    idx = (bi * 2 + s) % 8
                    if (bi * 2 + s) % 8 in (1, 4):
                        continue
                    m = ch[arp[idx] % len(ch)] + 12
                    place(lead, bell(m, 0.7, 0.75 if s == 0 else 0.5), tb + s * BEAT / 2 + (swing if s else 0), 1.0, -0.25 if s else 0.25)

    # logo drop
    place(drums, impact(1.0), 4.8)
    place(drums, crash(0.9), 4.8, 1.0, 0.2)
    place(keys, pad(PROG[0][0], 3.6, 0.8, 1600), 4.8, 0.7)
    groove(4.8, 8.4, open_hats=False, bells=False)
    groove(8.4, 14.4)
    place(fx, reverse_crash(0.6, 0.8), 13.8)
    place(drums, crash(0.7), 14.4, 1.0, -0.2)
    groove(14.4, 20.4, shakers=True, bells=True, cutoff=3200)
    place(drums, crash(0.5), 20.4, 1.0, 0.2)
    groove(20.4, 25.8, open_hats=False, cutoff=2000)
    # sweep down: stab filter closes, reverse crash into the ink
    for k in range(4):
        tb = 25.8 + k * 0.15
        place(keys, chord_stab(PROG[3][0], 0.1, 0.8 - k * 0.15, 1800 - k * 400), tb)
    place(fx, reverse_crash(0.6, 1.0), 25.8)
    place(drums, impact(0.9), 26.4)
    # dark: drone + heartbeat, then half-time beat
    place(bass, sub_drone(4.4, 33, 1.0), 26.4)
    place(keys, pad([57, 60, 64], 4.2, 0.8, 600), 26.4, 0.7)
    for k in range(3):
        place(drums, kick(0.55), 27.0 + k * 0.6)
        place(drums, kick(0.3), 27.0 + k * 0.6 + 0.18)
    place(fx, reverse_crash(0.5, 0.7), 28.3)
    place(drums, impact(0.7), 28.8)
    groove(28.8, 30.6, kick_pat="half", half=True, open_hats=False, stabs=False, dark=True, hats=True)
    place(fx, noise_riser(0.62, 0.8, 600, 7000), 30.55)
    # bright arenas section
    place(drums, crash(0.7), 31.2, 1.0, 0.2)
    groove(31.2, 36.9, bells=True, shakers=True, cutoff=3400)
    place(fx, noise_riser(0.35, 0.9, 1500, 12000), 36.85)
    place(drums, crash(1.0), 37.2, 1.0, -0.2)
    place(drums, kick(1.0), 37.2)
    groove(37.2, 41.4, bells=True, cutoff=3000)
    # fill
    for k in range(8):
        place(drums, clap(0.25 + k * 0.08), 41.4 + k * 0.075, 1.0, (k % 2) * 0.3 - 0.15)
    place(drums, crash(0.6), 42.0)
    groove(42.0, 44.4, cutoff=2600)
    # tension: kick on every beat, hats thinning, filter closing, riser, breath
    groove(44.4, 46.2, kick_pat="four", open_hats=False, stabs=True, cutoff=1400, hats=False)
    place(fx, noise_riser(1.0, 1.1, 300, 11000), 45.62)
    # final hit + outro
    place(drums, impact(1.1), 46.8)
    place(drums, crash(1.0), 46.8, 1.0, 0.15)
    place(keys, pad(PROG[0][0] + [72], 4.8, 0.9, 1800), 46.8, 0.8)
    groove(46.8, 51.6, open_hats=False, bells=True, cutoff=2600)
    # sting
    place(drums, kick(1.0), 51.6)
    place(drums, crash(0.8, 2.6), 51.6)
    for i, m in enumerate([65, 69, 72, 76, 79]):
        place(lead, bell(m, 2.2, 0.8), 51.6 + i * 0.03, 1.0, -0.4 + i * 0.2)
    place(keys, chord_stab(PROG[0][0], 1.2, 1.0, 2400), 51.6)
    place(bass, bass_note(41, 1.0, 1.0), 51.6)
    # ── the NFT beat (the cut plays it between the fee and the end card) ──
    # the drop out of the burn, two bright bars with a bell sparkle on each card turn, then half a
    # bar of tension and a breath so the end card's hit lands clean
    N0 = 62.4
    place(drums, impact(1.0), N0)
    place(drums, crash(0.9), N0, 1.0, -0.15)
    place(keys, pad(PROG[0][0], 2.4, 0.8, 1800), N0, 0.7)
    place(keys, pad(PROG[1][0], 2.4, 0.8, 1800), N0 + BAR, 0.7)
    groove(N0, N0 + 2 * BAR, bells=True, shakers=True, cutoff=3600)
    for i, m in enumerate([76, 79, 84]):
        place(lead, bell(m, 1.0, 0.85), N0 + 1.2 + i * 0.3, 1.0, -0.3 + i * 0.3)
    place(drums, crash(0.5), N0 + BAR, 1.0, 0.2)
    T0 = N0 + 2 * BAR
    groove(T0, T0 + 0.6, kick_pat="four", open_hats=False, stabs=True, cutoff=1400, hats=False)
    place(drums, kick(0.9), T0 + 0.6)
    place(fx, noise_riser(0.82, 1.1, 300, 11000), T0 + 0.0)
    return drums, bass, keys, lead, fx


def main():
    out = sys.argv[1]
    drums, bass, keys, lead, fx = build()
    # pump keys/bass a little from the kick for an electronic lilt
    ir_l, ir_r = reverb_ir(seed=7), reverb_ir(seed=8)
    def verb(x, wet):
        l = signal.fftconvolve(x[0], ir_l)[: x.shape[1]]
        r = signal.fftconvolve(x[1], ir_r)[: x.shape[1]]
        return x + wet * np.stack([l, r])
    keys = verb(keys, 0.35)
    lead = verb(lead, 0.45)
    drums = drums + 0.12 * np.stack([signal.fftconvolve(drums[0], ir_l)[:N], signal.fftconvolve(drums[1], ir_r)[:N]])
    mix = drums * 0.9 + bass * 0.85 + keys * 1.0 + lead * 1.0 + fx * 0.8
    # master EQ: clear the sub rumble, scoop the low-mid mud, open the top
    mix = hp(mix, 30, 2)
    mix = biquad(mix, "peak", 300, -3.5, 0.7)
    mix = biquad(mix, "peak", 140, -1.5, 1.0)
    mix = biquad(mix, "highshelf", 4200, 3.0, 0.7)
    # breaths: hard silence before the logo drop and the end hit (reverb tails cut)
    for a, b in ((4.62, 4.8), (46.62, 46.8), (68.22, 68.4)):
        i0, i1 = int(a * SR), int(b * SR)
        fade = int(0.02 * SR)
        floor = 10 ** (-34 / 20)  # not digital silence: a breath with the room still there
        mix[:, i0 - fade:i0] *= np.linspace(1, floor, fade)
        mix[:, i0:i1] *= floor
    # tail fades: the film's end (the sting, old 52.3 - 54.0), then the NFT beat's bed after it
    f0, f1 = int(52.3 * SR), int(54.0 * SR)
    mix[:, f0:f1] *= np.linspace(1, 0, f1 - f0) ** 1.5
    mix[:, f1:int(62.3 * SR)] = 0
    f0 = int((TL["duration"] - 0.5) * SR)
    mix[:, f0:] *= np.linspace(1, 0, N - f0) ** 1.5
    # gentle glue: soft clip, normalise to -3 dBFS peak
    mix = np.tanh(mix * 0.9) / 0.9
    mix *= 10 ** (-3 / 20) / np.max(np.abs(mix))
    import soundfile as sf
    sf.write(out, mix.T.astype(np.float32), SR, subtype="FLOAT")
    # stems for the mix (VO ducking needs the music only)
    print("music written", out, mix.shape[1] / SR, "s")


if __name__ == "__main__":
    main()
