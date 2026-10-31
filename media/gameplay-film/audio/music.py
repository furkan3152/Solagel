"""Original score for the gameplay film: a warm storybook piece, synthesised from scratch with numpy
(no samples, no models). After media/promo/audio/music.py, re-orchestrated: felt piano, a music
box, pizzicato and harp (Karplus-Strong), a sneaky staccato bassoon for the chase, an upright bass,
soft string pads, brushes, a felt kick, timpani and cymbals. F major, 96 BPM (one bar = 2.5 s).

Scored to ../cues.json "music" (film seconds):
  intro     home page and what Elymum is: rolled piano chords, the music-box motif, harp later
  flow      WL -> mint -> lobby: walking pizzicato bass, broken piano, brushes come in
  pulse     the live round: bassoon ostinato, off-beat pizzicato, kick and brushes, music box answers
  break     one beat of air before the split, then the groove comes back fuller
  tension   the final minute: D minor, string tremolo crescendo, timpani roll, the filter opens
  last_ten  tempo-free: a heartbeat on every second (it sits with the game's own ticks), a held
            C pedal that swells, a short breath before
  hit       the bell: a tutti F major (timpani, low piano, strings, crash, music-box sparkle)
  paid      the resolve: warm F major, the motif returns
  cadence   Gm7 -> C7 -> the final sting, rings out to the end

  python3 music.py OUT.wav [--stems DIR]
"""
import argparse
import json
import os
from functools import lru_cache

import numpy as np

import dsp
from dsp import SR, adsr, bp, hp, ks_pluck, lp, mtof, place, t_

HERE = os.path.dirname(os.path.abspath(__file__))
CUES = json.load(open(os.path.join(HERE, "..", "cues.json")))
MU = CUES["music"]
BPM = CUES.get("bpm", 96)
BEAT = 60.0 / BPM
BAR = 4 * BEAT
DUR = CUES["duration"]
N = int((DUR + 0.5) * SR)
rs = np.random.default_rng(2026)


def hum(sd=0.007):
    """Timing humanisation: a player is never exactly on the grid."""
    return float(rs.normal(0, sd))


def vel(v, sd=0.06):
    return float(np.clip(v * (1 + rs.normal(0, sd)), 0.05, 1.2))


# ───────────────────────── instruments ─────────────────────────
@lru_cache(maxsize=None)
def _piano(m, dur, v):
    f = mtof(m)
    ring = min(4.5, 1.6 * (261.6 / f) ** 0.5 + 0.6)
    n = int((dur + 0.35) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    B = 0.00035
    roll = 1.55 - 0.6 * v  # soft notes: fewer upper partials (the felt)
    for k in range(1, 9):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > 9000:
            break
        a = 1 / k ** roll
        tau = ring / (1 + 0.45 * (k - 1))
        x += a * np.sin(2 * np.pi * fk * t + k * 0.7) * np.exp(-t / tau)
        if k == 1:  # the second string, a hair sharp: the slow beat of a real unison
            x += 0.5 * a * np.sin(2 * np.pi * fk * 1.0006 * t) * np.exp(-t / tau)
    att = np.minimum(1, t / (0.004 + 0.006 * (1 - v)))
    thump = lp(rs.standard_normal(n) * np.exp(-t / 0.012), 900) * 0.25 * v
    rel = np.clip(1 - (t - dur) / 0.3, 0, 1)
    y = (x * att + thump) * rel
    return lp(y, 2200 + 4500 * v) * v * 0.18


def piano(m, dur, v=0.6):
    return _piano(int(m), round(min(dur, 4.0), 2), round(v, 2))


@lru_cache(maxsize=None)
def _musicbox(m, v):
    f = mtof(m)
    t = t_(1.8)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9)
    x += 0.32 * np.sin(2 * np.pi * f * 3.0 * t + 0.4) * np.exp(-t / 0.28)
    x += 0.12 * np.sin(2 * np.pi * f * 5.93 * t + 1.1) * np.exp(-t / 0.1)
    x += 0.05 * np.sin(2 * np.pi * f * 9.1 * t) * np.exp(-t / 0.04)
    x *= np.minimum(1, t / 0.0015)
    tick = hp(rs.standard_normal(len(t)), 5000) * np.exp(-t / 0.002) * 0.15
    return (x + tick) * v * 0.16


def musicbox(m, v=0.6):
    return _musicbox(int(m), round(v, 2))


@lru_cache(maxsize=None)
def _pizz(m, v, seed):
    f = mtof(m)
    x = ks_pluck(f, 0.7, bright=0.35 + 0.2 * v, damp=0.992, seed=seed)
    x = bp(x, 90, 3200) * np.exp(-t_(0.7) / 0.35)
    return x * v * 0.5


def pizz(m, v=0.6):
    return _pizz(int(m), round(v, 2), int(rs.integers(0, 6)))


@lru_cache(maxsize=None)
def _harp(m, v, seed):
    f = mtof(m)
    x = ks_pluck(f, 2.4, bright=0.55, damp=0.9985, seed=seed)
    return lp(x, 5000) * v * 0.32


def harp(m, v=0.5):
    return _harp(int(m), round(v, 2), int(rs.integers(0, 6)))


@lru_cache(maxsize=None)
def _ubass(m, dur, v, seed):
    f = mtof(m)
    n_d = dur + 0.25
    x = ks_pluck(f, n_d, bright=0.22, damp=0.996, seed=seed)
    t = t_(n_d)
    x = x[: len(t)] + 0.5 * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.6) * np.minimum(1, t / 0.01)
    x *= np.clip(1 - (t - dur) / 0.12, 0, 1)
    return lp(x, 1100) * v * 0.55


def ubass(m, dur, v=0.7):
    return _ubass(int(m), round(dur, 2), round(v, 2), int(rs.integers(0, 6)))


@lru_cache(maxsize=None)
def _bassoon(m, dur, v):
    """Staccato double reed: a narrow pulse (odd-heavy, nasal), a breathy onset, a formant."""
    f = mtof(m)
    t = t_(dur + 0.08)
    vib = 1 + 0.002 * np.sin(2 * np.pi * 5.2 * t)
    ph = np.cumsum(f * vib) / SR
    x = ((ph % 1) < 0.32).astype(float) * 2 - 1
    x -= x.mean()
    x = lp(x, 1400, 4)
    x = dsp.eq(x, ("peak", 520, 5.0, 1.4), ("peak", 1150, 3.0, 2.0))
    breath = bp(rs.standard_normal(len(t)), 800, 3000) * np.exp(-t / 0.03) * 0.15
    e = adsr(len(t), 0.018, 0.05, 0.75, 0.05, hold=dur)
    return (x * e + breath * e) * v * 0.16


def bassoon(m, dur, v=0.6):
    return _bassoon(int(m), round(dur, 3), round(v, 2))


def pad(ms, dur, v=0.5, cutoff=1500, cutoff_end=None, attack=0.8, release=1.2, trem=0.0):
    """Soft string pad: detuned saws, slow attack, delayed vibrato; optional tremolo (Hz) and a
    cutoff glide (the tension's opening filter)."""
    t = t_(dur + release)
    x = np.zeros(len(t))
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.5) / 0.8, 0, 1)
    for m in ms:
        for det in (-0.07, 0.0, 0.065):
            f = mtof(m + det)
            ph = np.cumsum(f * vib) / SR + rs.uniform(0, 1)
            x += 2 * (ph % 1) - 1
    x /= max(1, len(ms)) * 3
    if cutoff_end:
        x = dsp.sweep(x, cutoff, cutoff_end, "lp", 0.7, 1.4)
    else:
        x = lp(x, cutoff, 4)
    x = hp(x, 110)
    e = adsr(len(t), attack, 0.3, 0.9, release, hold=dur)
    if trem:
        e *= 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * trem * t))
    return x * e * v * 0.5


def kick(v=0.7):
    t = t_(0.5)
    f = 62 + 70 * np.exp(-t / 0.03)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    felt = lp(rs.standard_normal(len(t)), 600) * np.exp(-t / 0.008) * 0.2
    return np.tanh((x + felt) * 1.2) * v * 0.7


def brush(v=0.5, swish=0.12):
    t = t_(swish + 0.25)
    n = rs.standard_normal(len(t))
    sw = bp(n, 2500, 9000) * np.clip(t / swish, 0, 1) ** 1.5 * np.exp(-np.maximum(t - swish, 0) / 0.05)
    tap = bp(n, 1500, 6000) * np.exp(-np.maximum(t - swish, 0) / 0.03) * (t >= swish) * 0.8
    return (sw * 0.35 + tap) * v * 0.22


def shaker(v=0.4):
    t = t_(0.09)
    return bp(rs.standard_normal(len(t)), 4500, 11000) * np.sin(np.pi * t / 0.09) ** 2 * v * 0.12


def triangle(v=0.4):
    t = t_(2.2)
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((2637, 1, 1.2), (5290, 0.5, 0.7), (7960, 0.3, 0.4)))
    return x * np.minimum(1, t / 0.001) * v * 0.06


@lru_cache(maxsize=None)
def _timp(m, v):
    f = mtof(m)
    t = t_(2.6)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in ((1, 1, 1.3), (1.5, 0.5, 0.7), (1.98, 0.3, 0.5), (2.44, 0.15, 0.3)))
    mallet = lp(rs.standard_normal(len(t)), 1200) * np.exp(-t / 0.01) * 0.4
    return np.tanh((x + mallet) * 1.1) * v * 0.45


def timp(m, v=0.7):
    return _timp(int(m), round(v, 2))


def timp_roll(m, dur, v0=0.15, v1=0.8, rate=13.0):
    out = np.zeros(int((dur + 2.6) * SR))
    k = int(dur * rate)
    for i in range(k):
        g = v0 + (v1 - v0) * (i / max(1, k - 1)) ** 1.6
        x = timp(m, round(g * (1 + rs.normal(0, 0.05)), 2)) * 0.55
        j = int((i / rate + hum(0.004)) * SR)
        j = max(0, j)
        out[j:j + len(x)] += x[: len(out) - j]
    return out


def crash(v=0.7, dur=3.0):
    t = t_(dur)
    n = hp(rs.standard_normal(len(t)), 4000, 4)
    ring = sum(np.sin(2 * np.pi * f * t + rs.uniform(0, 6)) for f in (3970, 5210, 6830, 8120, 9440)) * 0.05
    return (n * 0.45 + ring) * np.exp(-t / 0.9) * np.minimum(1, t / 0.002) * v * 0.3


def swell(dur=2.0, v=0.6):
    """A reversed cymbal: the breath in before a hit."""
    x = crash(v, dur)[::-1]
    return x * np.linspace(0, 1, len(x)) ** 2


def heartbeat(v=0.6):
    out = np.zeros(int(0.7 * SR))
    for at, g in ((0.0, 1.0), (0.2, 0.6)):
        t = t_(0.45)
        f = 56 + 40 * np.exp(-t / 0.04)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12) * g
        i = int(at * SR)
        out[i:i + len(x)] += x
    return lp(out, 260) * v * 0.9


def vinyl_room(dur, v=1.0):
    """A breath of air under everything (the score never drops to digital silence)."""
    x = dsp.pink(int(dur * SR), seed=3)
    return lp(hp(x, 200), 6000) * v * 0.0025


# ───────────────────────── harmony ─────────────────────────
# name: (bass midi, right-hand voicing)
CH = {
    "F": (41, [57, 60, 65, 69]),
    "F/A": (45, [57, 60, 65, 69]),
    "F/C": (36, [57, 60, 65, 69]),
    "C/E": (40, [55, 60, 64, 67]),
    "Dm7": (38, [57, 60, 62, 65]),
    "Dm": (38, [57, 62, 65, 69]),
    "Am7": (45, [55, 60, 64, 67]),
    "Bbmaj7": (46, [57, 62, 65, 70]),
    "Bb/F": (41, [58, 62, 65, 70]),
    "Gm7": (43, [58, 62, 65, 67]),
    "C7sus": (36, [58, 60, 65, 67]),
    "C7": (36, [58, 60, 64, 67]),
}

MOTIF = [  # the music box's tune, 2 bars of 8ths (None = rest): "small change, big appetite"
    [77, None, 81, 79, 77, None, 72, None],
    [74, 77, 76, None, 72, None, None, None],
]
ANSWER = [[84, 81, None, 77, None, None, None, None], [79, None, 76, 77, None, None, None, None]]


def rolled(buf, chord, at, dur, v=0.5, spread=0.035, low=True):
    bass, rh = CH[chord]
    if low:
        place(buf, piano(bass, dur, vel(v * 0.9)), at + hum(), 1.0, -0.15)
    for i, m in enumerate(rh):
        place(buf, piano(m, dur - i * spread, vel(v * 0.8)), at + i * spread + hum(0.004), 1.0, -0.1 + 0.08 * i)


def motif(buf, at, bars=(0, 1), v=0.55, tune=MOTIF, transpose=0):
    for bi in bars:
        for s, m in enumerate(tune[bi % len(tune)]):
            if m is None:
                continue
            place(buf, musicbox(m + transpose, vel(v * (1.0 if s % 2 == 0 else 0.8))),
                  at + (bi - bars[0]) * BAR + s * BEAT / 2 + hum(0.005), 1.0, 0.25)


# ───────────────────────── arrangement ─────────────────────────
def build():
    keys = np.zeros((2, N))     # piano, music box, harp
    strings = np.zeros((2, N))  # pads, pizzicato
    low = np.zeros((2, N))      # upright bass, bassoon
    perc = np.zeros((2, N))     # kick, brushes, shaker, timpani, cymbals
    air = np.zeros((2, N))

    place(air, vinyl_room(DUR + 0.5), 0.0)

    # ── intro: rolled piano chords, the music box, harp and pad later ──
    t0, t1 = MU["intro"], MU["flow"]
    prog = ["F", "Dm7", "Bbmaj7", "C7sus", "F", "Am7", "Bbmaj7", "C7", "F", "Dm7", "Gm7"]
    nb = int(round((t1 - t0) / BAR))
    for b in range(nb):
        at = t0 + b * BAR
        ch = prog[b % len(prog)]
        rolled(keys, ch, at, BAR * 0.95, 0.34 if b < 4 else 0.4)
        if b >= 2:  # the chord again on beat 3, lighter
            _, rh = CH[ch]
            for i, m in enumerate(rh[1:]):
                place(keys, piano(m, BEAT * 1.8, vel(0.3)), at + 2 * BEAT + i * 0.02 + hum(), 1.0, 0.1)
        if b >= 4:
            bass, _ = CH[ch]
            place(low, ubass(bass, BEAT * 1.8, vel(0.42)), at + hum(), 1.0)
            place(low, ubass(bass + 7, BEAT * 1.6, vel(0.32)), at + 2 * BEAT + hum(), 1.0)
            place(strings, pad(CH[ch][1][:3], BAR, 0.26, 1100, attack=1.0), at, 1.0)
        if b >= 6:  # harp arpeggio, 8ths up and back
            _, rh = CH[ch]
            arp = rh + [rh[1] + 12, rh[2] + 12] + rh[::-1][1:3]
            for s in range(8):
                place(keys, harp(arp[s % len(arp)], vel(0.26)), at + s * BEAT / 2 + hum(0.006), 1.0, 0.35 - 0.1 * (s % 3))
    for b in (0, 2, 6, 8):
        if t0 + b * BAR < t1 - BAR:
            motif(keys, t0 + b * BAR + BEAT * 0.5, (0, 1), 0.5)
    place(perc, triangle(0.35), t0 + 4 * BAR)

    # ── flow: walking bass, broken piano, brushes ──
    t0, t1 = MU["flow"], MU["pulse"]
    prog = ["F", "C/E", "Dm7", "Bbmaj7", "F/A", "Gm7", "C7"]
    nb = int(round((t1 - t0) / BAR))
    walk = {"F": [41, 45, 48, 45], "C/E": [40, 43, 48, 43], "Dm7": [38, 41, 45, 41], "Bbmaj7": [46, 45, 43, 41],
            "F/A": [45, 41, 45, 48], "Gm7": [43, 46, 50, 46], "C7": [36, 40, 43, 46]}
    for b in range(nb):
        at = t0 + b * BAR
        ch = prog[b % len(prog)]
        bass, rh = CH[ch]
        for q, m in enumerate(walk[ch]):
            place(strings, pizz(m + 12, vel(0.55)), at + q * BEAT + hum(), 1.0, -0.2)
            place(low, ubass(m, BEAT * 0.9, vel(0.55)), at + q * BEAT + hum(), 1.0)
        broken = [rh[0], rh[2], rh[1], rh[3], rh[2], rh[1], rh[3], rh[2]]
        for s, m in enumerate(broken):
            place(keys, piano(m, BEAT * 0.9, vel(0.3 if s % 2 else 0.37)), at + s * BEAT / 2 + hum(), 1.0, 0.05)
        place(strings, pad(rh[:3], BAR, 0.25, 1300, attack=0.6), at, 1.0)
        place(perc, kick(0.45), at + hum())
        place(perc, kick(0.3), at + 2 * BEAT + hum())
        for q in (1, 3):
            place(perc, brush(0.5), at + q * BEAT - 0.12 + hum(), 1.0, 0.25)
        for s in range(8):
            place(perc, shaker(0.35 if s % 2 else 0.22), at + s * BEAT / 2 + hum(0.005), 1.0, -0.4)
    motif(keys, t0 + 2 * BAR, (0, 1), 0.45, ANSWER)

    # ── pulse: the round. Bassoon ostinato, off-beat pizz, groove; one beat of air before the split ──
    t0, t1, tb = MU["pulse"], MU["tension"], MU["break"]
    place(perc, triangle(0.5), t0)
    place(perc, crash(0.25, 2.0), t0, 1.0, 0.3)
    prog = ["F", "Dm7", "Bbmaj7", "C7"]
    nb = int(round((t1 - t0) / BAR))
    sneak = [0, 0, 12, 0, 7, 0, 10, 7]  # semitones over the root, 8ths
    for b in range(nb):
        at = t0 + b * BAR
        ch = prog[b % 4]
        bass, rh = CH[ch]
        after_break = at >= tb
        for s in range(8):
            ts = at + s * BEAT / 2
            if tb - 0.01 <= ts < tb + BEAT - 0.01:
                continue  # the break: one beat of nothing
            place(low, bassoon(bass + 12 + sneak[s], BEAT * 0.32, vel(0.62 if s % 2 == 0 else 0.48)), ts + hum(0.005), 1.0, -0.15)
            if s % 2 == 1:
                for i, m in enumerate(rh[:3]):
                    place(strings, pizz(m, vel(0.4)), ts + i * 0.006 + hum(0.004), 1.0, 0.3 - 0.1 * i)
            if after_break:
                place(keys, harp(rh[(s * 3) % 4] + 12, vel(0.22)), ts + BEAT / 4 + hum(0.004), 1.0, 0.45)
        for q in range(4):
            tq = at + q * BEAT
            if tb - 0.01 <= tq < tb + BEAT - 0.01:
                continue
            place(low, ubass(bass if q % 2 == 0 else bass + 7, BEAT * 0.8, vel(0.6)), tq + hum(), 1.0)
            if q in (0, 2):
                place(perc, kick(0.62 if q == 0 else 0.5), tq + hum(0.004))
            if q in (1, 3):
                place(perc, brush(0.65), tq - 0.12 + hum(), 1.0, 0.25)
        if not (tb - 0.01 <= at + 1.5 * BEAT < tb + BEAT):
            place(perc, kick(0.32), at + 1.5 * BEAT + hum(0.004))
        for s in range(16):
            ts = at + s * BEAT / 4
            if not (tb - 0.01 <= ts < tb + BEAT - 0.01):
                place(perc, shaker(0.28 if s % 4 == 0 else 0.15), ts + hum(0.004), 1.0, -0.45)
        place(strings, pad(rh, BAR, 0.34 if not after_break else 0.42, 1600, attack=0.4, release=0.6), at, 1.0)
        for q in (1, 3):  # soft piano chords on the off-beats of 2 and 4
            if not (tb - 0.01 <= at + q * BEAT + BEAT / 2 < tb + BEAT):
                for i, m in enumerate(rh[1:]):
                    place(keys, piano(m, BEAT * 0.4, vel(0.34)), at + q * BEAT + BEAT / 2 + i * 0.008 + hum(0.004), 1.0, 0.1)
    for b in (2, 6, 10):
        if t0 + (b + 2) * BAR <= t1:
            motif(keys, t0 + b * BAR, (0, 1), 0.42, ANSWER if b == 6 else MOTIF)
    # the break: a small upward harp gliss into the split
    for i, m in enumerate([65, 69, 72, 77, 81, 84]):
        place(keys, harp(m, vel(0.3)), tb + i * BEAT / 6, 1.0, -0.3 + 0.12 * i)
    place(perc, crash(0.3, 1.6), tb + BEAT, 1.0, -0.3)

    # ── tension: the final minute ──
    t0, t1 = MU["tension"], MU["last_ten"]
    prog = ["Dm", "Bbmaj7", "Gm7", "C7sus", "C7"]
    nb = int(round((t1 - t0) / BAR))
    place(perc, timp(38, 0.8), t0)
    place(perc, crash(0.35, 2.4), t0, 1.0, 0.25)
    for b in range(nb):
        at = t0 + b * BAR
        ch = prog[min(b, len(prog) - 1)]
        bass, rh = CH[ch]
        k = b / max(1, nb - 1)
        place(strings, pad(rh + [rh[0] + 12], BAR + 0.05, 0.42 + 0.6 * k, 900 + 900 * b, 1000 + 900 * (b + 1),
                           attack=0.25, release=0.4, trem=11.0), at, 1.0)
        for s in range(8):
            ts = at + s * BEAT / 2
            place(low, bassoon(bass + 12 + (0, 0, 3, 0, 5, 0, 6, 7)[s], BEAT * 0.3, vel(0.55 + 0.25 * k)), ts + hum(0.004), 1.0, -0.15)
            place(strings, pizz(rh[s % 4], vel(0.35 + 0.2 * k)), ts + BEAT / 4 + hum(0.004), 1.0, 0.3)
        for q in range(4):
            place(perc, kick(0.55 + 0.2 * k), at + q * BEAT + hum(0.003))
            place(low, ubass(bass, BEAT * 0.7, vel(0.6)), at + q * BEAT + hum(), 1.0)
            if q in (1, 3):
                place(perc, brush(0.6 + 0.2 * k), at + q * BEAT - 0.1 + hum(), 1.0, 0.25)
        for s in range(16):
            place(perc, shaker(0.2 + 0.15 * k), at + s * BEAT / 4 + hum(0.004), 1.0, -0.45)
    # the roll grows through the minute and is choked at the last-ten line (subito: the drop to
    # the heartbeat is the drama, so nothing rings over it)
    roll = timp_roll(36, nb * BAR - 0.3, 0.06, 0.6)
    keep = int((t1 - t0 - 0.3) * SR)
    roll[keep:] *= np.exp(-np.arange(len(roll) - keep) / (0.05 * SR))
    place(perc, roll, t0 + 0.3, 1.0, -0.1)

    # ── last ten: a heartbeat on each second, a held C pedal that swells, a breath before the bell ──
    t0, t1 = MU["last_ten"], MU["hit"]
    span = t1 - t0
    for i in range(int(round(span))):
        place(perc, heartbeat(0.5 + 0.035 * i), t0 + i + 0.0)
    place(strings, pad([48, 55, 60], span, 0.45, 700, 2600, attack=1.5, release=0.25), t0, 1.0)
    place(strings, pad([84], span, 0.12, 6000, attack=2.5, release=0.2), t0, 1.0)  # a high harmonic, shimmering
    place(low, ubass(36, span - 0.2, 0.5), t0)
    place(perc, timp_roll(36, 2.4, 0.06, 0.5, 16.0), t1 - 2.5, 1.0, -0.1)
    place(perc, swell(2.2, 0.6), t1 - 2.2, 1.0, -0.2)

    # ── the hit: the bell ──
    t0 = MU["hit"]
    place(perc, timp(41, 0.5), t0)
    place(perc, timp(36, 0.42), t0 + 0.004)
    place(perc, crash(0.45, 3.5), t0, 1.0, 0.2)
    place(perc, kick(0.7), t0)
    for m in (41, 53):
        place(keys, piano(m, 2.6, 0.5), t0, 1.0, -0.2)
    rolled(keys, "F", t0 + 0.01, 2.5, 0.5, 0.012)
    place(strings, pad([53, 57, 60, 65, 69, 72], 2.2, 0.8, 3200, attack=0.03, release=1.6), t0, 1.0)
    for i, m in enumerate([77, 81, 84, 89, 93]):
        place(keys, musicbox(m, 0.5), t0 + 0.12 + i * 0.07, 1.0, -0.3 + 0.15 * i)

    # ── paid: the resolve, the motif comes home ──
    t0, t1 = MU["paid"], MU["cadence"]
    prog = ["F", "Bb/F", "F/A"]
    nb = int(round((t1 - t0) / BAR))
    for b in range(nb):
        at = t0 + b * BAR
        ch = prog[b % len(prog)]
        bass, rh = CH[ch]
        rolled(keys, ch, at, BAR, 0.5)
        place(low, ubass(bass, BAR * 0.9, vel(0.5)), at + hum(), 1.0)
        place(strings, pad(rh, BAR, 0.38, 1700, attack=0.7), at, 1.0)
        for s in range(8):
            place(keys, harp((rh + [rh[0] + 12, rh[2] + 12, rh[1] + 12, rh[3] + 12])[s], vel(0.3)), at + s * BEAT / 2 + hum(0.006), 1.0, 0.35)
        place(perc, brush(0.35), at + BEAT - 0.12, 1.0, 0.25)
        place(perc, brush(0.35), at + 3 * BEAT - 0.12, 1.0, 0.25)
    motif(keys, t0 + 0.02, (0, 1), 0.6)
    place(perc, triangle(0.4), t0)

    # ── cadence and sting ──
    t0, ts, tend = MU["cadence"], MU["sting"], MU["end"]
    for at, ch in ((t0, "Gm7"), (t0 + BAR, "C7sus"), (t0 + BAR + 2 * BEAT, "C7")):
        bass, rh = CH[ch]
        d = BAR if ch == "Gm7" else 2 * BEAT
        rolled(keys, ch, at, d, 0.5)
        place(low, ubass(bass, d * 0.95, 0.55), at, 1.0)
        place(strings, pad(rh, d, 0.4, 1600, attack=0.4, release=0.5), at, 1.0)
    # a ritard into the sting: the last three bass notes stretch
    for i, m in enumerate([46, 45, 43]):
        place(strings, pizz(m + 12, 0.5), ts - 1.2 + i * 0.42 * (1 + 0.15 * i), 1.0, -0.2)
    rolled(keys, "F", ts, tend - ts, 0.62, 0.05)
    place(keys, piano(41, tend - ts, 0.55), ts, 1.0, -0.2)
    place(low, ubass(41, 3.0, 0.6), ts)
    place(strings, pad([53, 57, 60, 65, 69], tend - ts - 0.5, 0.45, 1800, attack=0.5, release=1.8), ts, 1.0)
    for i, m in enumerate([77, 81, 84, 89]):
        place(keys, musicbox(m, 0.45), ts + 0.4 + i * 0.16, 1.0, -0.2 + 0.15 * i)
    place(perc, triangle(0.5), ts + 0.4)
    return {"keys": keys, "strings": strings, "low": low, "perc": perc, "air": air}


def master(stems):
    ir = np.stack([dsp.reverb_ir(2.4, 0.62, 11), dsp.reverb_ir(2.4, 0.62, 12)])

    def verb(x, wet):
        return x + wet * np.stack([dsp.fftconv(x[0], ir[0])[: x.shape[1]], dsp.fftconv(x[1], ir[1])[: x.shape[1]]])

    keys = verb(stems["keys"], 0.42)
    strings = verb(stems["strings"], 0.38)
    low = verb(stems["low"], 0.12)
    perc = verb(stems["perc"], 0.2)
    mix = keys * 1.0 + strings * 0.9 + low * 0.72 + perc * 0.8 + stems["air"]
    # warm master EQ: no sub rumble, a little body, a soft top
    mix = hp(mix, 45, 4)
    mix = dsp.eq(mix, ("peak", 95, -2.0, 0.9), ("peak", 320, -2.0, 0.8), ("peak", 2800, -1.0, 1.0), ("hs", 7000, 1.5, 0.7))
    # the breath before the bell: 120 ms with only the room
    i0, i1 = int((MU["hit"] - 0.14) * SR), int((MU["hit"] - 0.01) * SR)
    f = int(0.03 * SR)
    mix[:, i0 - f:i0] *= np.linspace(1, 0.06, f)
    mix[:, i0:i1] *= 0.06
    mix[:, i1:int(MU["hit"] * SR)] *= np.linspace(0.06, 1, int(MU["hit"] * SR) - i1)
    # the end: fade the ring out over the last 1.6 s
    f0, f1 = int((MU["end"] - 1.6) * SR), int(MU["end"] * SR)
    mix[:, f0:f1] *= np.linspace(1, 0, f1 - f0) ** 1.6
    mix[:, f1:] = 0
    mix = dsp.soft_clip(mix * 0.9, 1.1)
    mix *= 10 ** (-3 / 20) / np.max(np.abs(mix))
    return mix


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--stems", default="")
    a = ap.parse_args()
    stems = build()
    mix = master(stems)
    dsp.write_wav(a.out, mix.astype(np.float32))
    if a.stems:
        for k, v in stems.items():
            dsp.write_wav(os.path.join(a.stems, f"music-{k}.wav"), (v / max(1e-9, np.max(np.abs(v))) * 0.7).astype(np.float32))
    print("music written", a.out, round(mix.shape[1] / SR, 2), "s")


if __name__ == "__main__":
    main()
