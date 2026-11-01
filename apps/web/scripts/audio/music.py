"""The game's soundtrack, synthesised at build time (numpy + ffmpeg) into seamless compressed loops.

  python3 scripts/audio/music.py [--only lobby,game,tension] [--wav DIR]

Three loops, 60 s / 60 s / 30 s, playful cartoon + light electronic (the Ring Storybook look:
paper, ink, mallets and toy whistles over a soft electronic kit):

  lobby    F major, 96 BPM, swung: marimba "oom-pah" comping, bouncy plucked bass, glockenspiel
           and a toy whistle trading the tune, pizzicato arpeggios, brushed snaps and a shaker;
           A (8 bars) / B (8) / A' (8, the whistle takes the tune, a slide-whistle turnaround)
  game     G major, 128 BPM: soft four-on-the-floor, claps, off-beat hats, plucked off-beat bass,
           side-chained chord stabs, a square-pluck lead with ping-pong delay, marimba 16th arps;
           A (8) / B (8, glockenspiel answer) / C (8, breakdown with a riser and a roll) / D (8, full)
  tension  128 BPM, 16 bars, sample-locked to `game` (exactly half its length): a tick-tock
           woodblock, a 16th pulse on D (it sits on every chord of the game loop), low toms, a
           riser and a roll into the loop point. The client cross-fades it in for the last minute.

Seamless loops: every note is rendered three times in a row (loop, loop, loop) so the middle loop
carries the tails of the one before it; the master chain (glue compression, loudness to -17 LUFS,
true peak <= -1.5 dBTP) runs over all three, then the middle loop is cut out with PAD seconds of
the neighbouring loops on both sides. The client loops [PAD, PAD + loop): an encoder delay of up
to PAD shifts the audio but the content around the loop points is periodic, so the seam stays
seamless in every browser. Encoded twice: Ogg Opus and AAC-LC in .m4a (Safari without Ogg Opus).
Writes src/audio/assets/music/<name>.{ogg,m4a} and music.json (loop lengths, PAD, BPM).
"""
import argparse
import json
import os
import re
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(WEB))
sys.path.insert(0, os.path.join(ROOT, "media", "gameplay-film", "audio"))
import dsp  # noqa: E402

SR = dsp.SR
OUT = os.path.join(WEB, "src", "audio", "assets", "music")
PAD = 0.25

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name):
    m = re.fullmatch(r"([A-G])([#b]?)(-?\d)", name)
    assert m, name
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(max(1, int(dur * SR))) / SR


def gate(x, dur, rel=0.03):
    """Release the note `dur` s after its start (a short linear fade), cut after."""
    n = int(dur * SR)
    r = int(rel * SR)
    x = x.copy()
    if n + r < len(x):
        x = x[:n + r]
    if n < len(x):
        x[n:] *= np.linspace(1, 0, len(x) - n)
    return x


def attack(x, a=0.002):
    k = max(1, int(a * SR))
    x = x.copy()
    x[:k] *= np.linspace(0, 1, k)
    return x


# ───────────────────────── instruments (mono) ─────────────────────────
def kick(v=1.0, punch=1.0):
    t = tt(0.42)
    f = 56 + 115 * punch * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = dsp.hp(np.random.default_rng(1).standard_normal(len(t)), 2500) * np.exp(-t / 0.003) * 0.25
    return attack(body + click, 0.001) * v


def clap(v=1.0, seed=0):
    r = np.random.default_rng(seed)
    t = tt(0.28)
    n = r.standard_normal(len(t))
    env = np.zeros(len(t))
    for k, at in enumerate((0, 0.009, 0.019)):
        m = t >= at
        env[m] += np.exp(-(t[m] - at) / 0.004) * (0.8 if k < 2 else 1)
    env += np.where(t >= 0.019, np.exp(-(t - 0.019) / 0.09), 0) * 0.45
    return dsp.bp(n, 900, 5200) * env * 0.6 * v


def snap(v=1.0, seed=0):
    r = np.random.default_rng(seed + 11)
    t = tt(0.12)
    x = dsp.bp(r.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.018)
    x += np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.012) * 0.25
    return x * 0.6 * v


def hat(v=1.0, open_=False, seed=0):
    r = np.random.default_rng(seed + 23)
    t = tt(0.32 if open_ else 0.08)
    return dsp.hp(r.standard_normal(len(t)), 7500) * np.exp(-t / (0.12 if open_ else 0.022)) * 0.35 * v


def shaker(v=1.0, seed=0):
    r = np.random.default_rng(seed + 31)
    t = tt(0.1)
    env = np.minimum(1, t / 0.012) * np.exp(-np.maximum(0, t - 0.012) / 0.03)
    return dsp.bp(r.standard_normal(len(t)), 4500, 11000) * env * 0.3 * v


def snare_roll_hit(v=1.0, seed=0):
    r = np.random.default_rng(seed + 41)
    t = tt(0.16)
    x = dsp.bp(r.standard_normal(len(t)), 1200, 7000) * np.exp(-t / 0.05)
    x += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04) * 0.5
    return x * 0.5 * v


def woodblock(f, v=1.0):
    t = tt(0.12)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.035) + 0.4 * np.sin(2 * np.pi * f * 2.71 * t) * np.exp(-t / 0.015)
    return attack(x, 0.0005) * 0.5 * v


def tom(f, v=1.0):
    t = tt(0.7)
    ff = f * (1 + 0.6 * np.exp(-t / 0.04))
    x = np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t / 0.32)
    x += dsp.lp(np.random.default_rng(5).standard_normal(len(t)), 900) * np.exp(-t / 0.03) * 0.2
    return attack(x, 0.001) * 0.8 * v


def bass(f, dur, v=1.0):
    """Plucked round bass: harmonics that die faster the higher they are, over a sub sine."""
    t = tt(dur + 0.08)
    x = np.sin(2 * np.pi * f * t) * 0.9
    for k in range(2, 12):
        if k * f > 2800:
            break
        x += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (6 + 9 * k))
    x *= np.exp(-t / max(0.25, dur * 1.2))
    return gate(attack(x, 0.003), dur, 0.04) * 0.55 * v


def marimba(f, v=1.0, dur=0.6):
    t = tt(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.32)
    x += 0.32 * np.sin(2 * np.pi * 3.93 * f * t) * np.exp(-t / 0.05)
    x += 0.08 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t / 0.015)
    return attack(x, 0.0015) * 0.45 * v


def glock(f, v=1.0):
    t = tt(1.6)
    x = np.zeros(len(t))
    for ratio, a, d in ((1, 1, 1.0), (2.76, 0.32, 0.4), (5.4, 0.16, 0.18), (8.93, 0.07, 0.08)):
        if f * ratio < SR * 0.45:
            x += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / d)
    return attack(x, 0.0008) * 0.32 * v


def pizz(f, v=1.0, seed=0):
    x = dsp.ks_pluck(f, 0.7, bright=0.35, damp=0.992, seed=seed)
    return dsp.lp(attack(x, 0.002), 3800) * 0.5 * v


def whistle(f, dur, v=1.0, seed=0, glide_from=None):
    """A toy whistle: a sine with a little 2nd harmonic, a breath, a late vibrato, a scoop up."""
    t = tt(dur + 0.1)
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.4 * t) * np.clip((t - 0.12) / 0.15, 0, 1)
    f0 = glide_from if glide_from else f * 0.94
    ff = (f + (f0 - f) * np.exp(-t / 0.03)) * vib
    ph = 2 * np.pi * np.cumsum(ff) / SR
    x = np.sin(ph) + 0.12 * np.sin(2 * ph)
    br = dsp.bp(np.random.default_rng(seed + 3).standard_normal(len(t)), f * 0.9, f * 3) * 0.04
    env = np.minimum(1, t / 0.035)
    return gate((x + br) * env, dur, 0.07) * 0.32 * v


def square_pluck(f, dur, v=1.0):
    t = tt(dur + 0.15)
    x = np.zeros(len(t))
    for k in range(1, 22, 2):
        if k * f > 7000:
            break
        x += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (2.5 + 1.6 * k))
    x *= np.exp(-t / 0.5)
    return gate(attack(x, 0.002), dur, 0.05) * 0.4 * v


def saw_stack(freqs, dur, v=1.0, bright=1.0, pluck=True, seed=0):
    """Chord of slightly detuned band-limited saws; `pluck` makes the upper harmonics die fast."""
    t = tt(dur + 0.6)
    r = np.random.default_rng(seed)
    x = np.zeros(len(t))
    for f in freqs:
        for det in (-0.006, 0.0, 0.0065):
            fd = f * (1 + det)
            ph = r.uniform(0, 2 * np.pi)
            for k in range(1, 30):
                if k * fd > 5000 * bright:
                    break
                d = np.exp(-t * (1.5 + 2.2 * k)) if pluck else 1.0
                x += np.sin(2 * np.pi * k * fd * t + ph * k) / k ** 1.25 * d
    x /= max(1, len(freqs) * 3)
    return x, t


def stab(freqs, dur, v=1.0, seed=0):
    x, t = saw_stack(freqs, dur, v, bright=0.9, pluck=True, seed=seed)
    return gate(attack(x * np.exp(-t / 0.35), 0.003), dur, 0.05) * 0.9 * v


def pad(freqs, dur, v=1.0, seed=0):
    x, t = saw_stack(freqs, dur, v, bright=0.35, pluck=False, seed=seed)
    env = np.minimum(1, t / 0.45)
    x = dsp.lp(x * env, 1400)
    return gate(x, dur, 0.6) * 0.55 * v


def slide_whistle(f0, f1, dur, v=1.0):
    t = tt(dur)
    k = t / dur
    ff = f0 * (f1 / f0) ** (k ** 1.3)
    ph = 2 * np.pi * np.cumsum(ff * (1 + 0.006 * np.sin(2 * np.pi * 6 * t))) / SR
    env = np.minimum(1, t / 0.04) * np.minimum(1, (dur - t) / 0.06)
    return (np.sin(ph) + 0.08 * np.sin(2 * ph)) * env * 0.25 * v


def riser(dur, v=1.0, seed=0):
    t = tt(dur)
    x = np.random.default_rng(seed + 77).standard_normal(len(t))
    x = dsp.sweep(x, 400, 7000, kind="bp", q=1.4, curve=1.6)
    return x * (t / dur) ** 2.2 * 0.5 * v


# ───────────────────────── sequencer ─────────────────────────
class Song:
    def __init__(self, bpm, bars, swing=0.0, seed=0):
        self.bpm, self.bars, self.swing = bpm, bars, swing
        self.spb = 60.0 / bpm
        self.beats = bars * 4
        self.loop = self.beats * self.spb
        self.ev = []
        self.rng = np.random.default_rng(seed)
        self.kicks = []

    def time(self, beat):
        frac = beat % 1
        if self.swing and abs(frac - 0.5) < 1e-6:
            beat += self.swing
        return beat * self.spb

    def add(self, beat, x, gain=1.0, pan=0.0, bus="main", rev=0.0, dly=0.0, side=0.0, human=True):
        j = self.rng.uniform(-0.004, 0.004) if human else 0.0
        g = gain * (self.rng.uniform(0.92, 1.05) if human else 1.0)
        self.ev.append((self.time(beat) + j, x, g, pan, rev, dly, side))

    def beat_s(self, beats):
        return beats * self.spb

    def melody(self, bar, text, inst, gain=1.0, pan=0.0, rev=0.2, dly=0.0, oct_=0, check=True):
        """'C5:0.5 A4:0.5 r:1 | ...': notes and rests in beats, bars separated by '|'."""
        beat = bar * 4
        out = []
        for seg in text.split("|"):
            seg_beats = 0.0
            for tok in seg.split():
                name, d = tok.split(":")
                d = float(d)
                if name != "r":
                    out.append((beat, midi(name) + 12 * oct_, d))
                beat += d
                seg_beats += d
            if check:
                assert abs(seg_beats - 4) < 1e-6, (text, seg, seg_beats)
        prev = None
        for b, m, d in out:
            f = hz(m)
            x = inst(f, self.beat_s(d), prev)
            self.add(b, x, gain, pan, rev=rev, dly=dly)
            prev = f
        return out


def chord(spec):
    return [midi(n) for n in spec.split()]


# ───────────────────────── lobby ─────────────────────────
LOBBY_CHORDS = {
    "F": ("F2", "A3 C4 F4", "F A C"), "Dm": ("D2", "A3 D4 F4", "D F A"), "Bb": ("Bb1", "Bb3 D4 F4", "Bb D F"),
    "C": ("C2", "G3 C4 E4", "C E G"), "Gm7": ("G1", "Bb3 D4 F4", "G Bb D"), "C7": ("C2", "Bb3 E4 G4", "C E G"),
    "Am": ("A1", "A3 C4 E4", "A C E"),
}


def low(m, lo=33, hi=44):
    """A bass note folded into A1..G#2."""
    while m < lo:
        m += 12
    while m > hi:
        m -= 12
    return m


def lobby():
    s = Song(96, 24, swing=0.09, seed=96)
    A = ["F", "Dm", "Bb", "C", "F", "Dm", "Gm7", "C7"]
    B = ["Bb", "C", "Am", "Dm", "Bb", "C", "F", "C7"]
    prog = A + B + A
    for bar, name in enumerate(prog):
        root_name, voicing, _ = LOBBY_CHORDS[name]
        root = low(midi(root_name))
        notes = chord(voicing)
        b0 = bar * 4
        sect = 0 if bar < 8 else 1 if bar < 16 else 2
        # kit: kick on 1 and the and-of-3, snaps on 2 and 4, a swung shaker
        s.add(b0, kick(0.75, 0.8), 0.9, side=0)
        s.add(b0 + 2.5, kick(0.55, 0.7), 0.8)
        if sect == 2 and bar % 2 == 1:
            s.add(b0 + 1.5, kick(0.4, 0.6), 0.7)
        for k in (1, 3):
            s.add(b0 + k, snap(1.0, seed=bar * 4 + k), 0.55, pan=0.12, rev=0.25)
        for k in range(8):
            s.add(b0 + k * 0.5, shaker(1.0 if k % 2 else 0.6, seed=bar * 8 + k), 0.5, pan=-0.35)
        if sect == 1:
            for k in (1, 3):
                s.add(b0 + k + 0.5, hat(0.7, seed=bar * 2 + k), 0.4, pan=0.3)
        # bass: root on 1, fifth on 3, an approach note into the next bar
        nxt = LOBBY_CHORDS[prog[(bar + 1) % len(prog)]][0]
        nroot = low(midi(nxt))
        s.add(b0, bass(hz(root), s.beat_s(0.9)), 1.0)
        s.add(b0 + 2, bass(hz(low(root + 7, 36, 47)), s.beat_s(0.9)), 0.85)
        approach = nroot + (1 if nroot < root else -1) if bar % 2 == 1 else root + 12
        s.add(b0 + 3.5, bass(hz(low(approach, 33, 47)), s.beat_s(0.45)), 0.7)
        # marimba "pah" on 2 and 4 (and a ghost on the and-of-2)
        for k, g in ((1, 0.8), (2.5, 0.45), (3, 0.75)):
            for i, m in enumerate(notes):
                s.add(b0 + k + i * 0.004, marimba(hz(m), 1.0, 0.5), 0.33 * g, pan=-0.2 + 0.2 * i, rev=0.2)
        # a soft pad under it all
        s.add(b0, pad([hz(m) for m in notes], s.beat_s(4.0), seed=bar), 0.28, rev=0.4)
        # B: pizzicato arpeggios in eighths
        if sect == 1:
            arp = notes + [notes[1] + 12, notes[2] + 12, notes[1] + 12] + notes[::-1][:2]
            for k, m in enumerate(arp[:8]):
                s.add(b0 + k * 0.5, pizz(hz(m + 12), 1.0, seed=bar * 8 + k), 0.38, pan=0.4, rev=0.3)
    melA = ("C5:0.5 A4:0.5 C5:0.5 F5:1 E5:0.5 F5:0.5 r:0.5 | D5:1.5 C5:0.5 A4:1 r:1 | "
            "Bb4:0.5 D5:0.5 F5:0.5 D5:0.5 C5:1 Bb4:0.5 A4:0.5 | G4:1.5 A4:0.5 Bb4:0.5 C5:1.5 | "
            "C5:0.5 A4:0.5 C5:0.5 F5:1 G5:0.5 A5:0.5 r:0.5 | F5:1 E5:0.5 D5:0.5 A4:1 r:1 | "
            "Bb4:0.5 D5:0.5 F5:0.5 A5:0.5 G5:1 F5:0.5 D5:0.5 | E5:1.5 D5:0.5 C5:1 r:1")
    melB = ("D5:1 F5:1 D5:0.5 C5:0.5 Bb4:1 | C5:1.5 E5:0.5 G5:2 | A5:0.5 G5:0.5 E5:1 C5:1 E5:1 | D5:3 r:1 | "
            "F5:0.5 F5:0.5 D5:0.5 F5:0.5 G5:1 F5:1 | E5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:2 | "
            "A5:1 G5:0.5 F5:0.5 C5:1 A4:1 | Bb4:1 G4:1 E4:0.5 G4:0.5 C5:1")
    melA2 = melA.rsplit("|", 1)[0] + "| E5:1 G5:0.5 A5:0.5 Bb5:1 G5:1"
    g = lambda f, d, p: glock(f)  # noqa: E731
    w = lambda f, d, p: whistle(f, d, glide_from=p)  # noqa: E731
    s.melody(0, melA, g, gain=0.9, pan=0.15, rev=0.35)
    s.melody(8, melB, w, gain=0.85, pan=-0.1, rev=0.3, dly=0.15)
    s.melody(16, melA2, w, gain=0.9, pan=0.05, rev=0.3, dly=0.12)
    s.melody(16, melA2, g, gain=0.35, pan=0.3, rev=0.4, oct_=1)
    # the turnaround: a slide whistle up into the top of the loop
    s.add(23 * 4 + 3, slide_whistle(hz(midi("C5")), hz(midi("C6")), s.beat_s(1.0)), 0.6, pan=0.2, rev=0.3)
    s.dly_beats = 0.75
    return s


# ───────────────────────── game ─────────────────────────
GAME_CHORDS = {
    "G": ("G1", "G3 B3 D4", [55, 59, 62]), "Em": ("E1", "G3 B3 E4", [52, 55, 59]),
    "C": ("C2", "G3 C4 E4", [48, 52, 55]), "D": ("D2", "F#3 A3 D4", [50, 54, 57]),
    "Bm": ("B1", "F#3 B3 D4", [47, 50, 54]),
}


def game():
    s = Song(128, 32, seed=128)
    A = ["G", "Em", "C", "D"] * 2
    B = ["C", "D", "Bm", "Em", "C", "D", "G", "G"]
    C = ["Em", "C", "G", "D"] * 2
    prog = A + B + C + A
    for bar, name in enumerate(prog):
        root_name, voicing, tri = GAME_CHORDS[name]
        root = low(midi(root_name))
        notes = chord(voicing)
        b0 = bar * 4
        sect = bar // 8
        breakdown = sect == 2
        kick_on = not breakdown or bar >= 20
        # kit
        if kick_on:
            beats = (0, 2) if breakdown else (0, 1, 2, 3)
            for k in beats:
                s.add(b0 + k, kick(0.85, 1.0), 1.0, human=False)
                s.kicks.append(b0 + k)
        if not breakdown:
            for k in (1, 3):
                s.add(b0 + k, clap(1.0, seed=bar * 2 + k), 0.55, pan=0.05, rev=0.22)
            for k in range(4):
                s.add(b0 + k + 0.5, hat(0.9, open_=(k == 3 and bar % 2 == 1), seed=bar * 4 + k), 0.5, pan=0.25)
        for k in range(16):
            if breakdown and bar < 20 and k % 2:
                continue
            s.add(b0 + k * 0.25, shaker(1.0 if k % 4 == 2 else 0.55, seed=bar * 16 + k), 0.42, pan=-0.3)
        # bass: plucked off-beats with octave jumps (a held root in the breakdown)
        if breakdown and bar < 20:
            s.add(b0, bass(hz(root), s.beat_s(3.6)), 0.75, side=0)
        else:
            for k in range(4):
                m = root + (12 if k == 2 else 0)
                s.add(b0 + k + 0.5, bass(hz(m), s.beat_s(0.4)), 0.95, side=0.6)
            if bar % 4 == 3:
                s.add(b0 + 3.75, bass(hz(root + 7), s.beat_s(0.2)), 0.6, side=0.6)
        # chord stabs on the off-beats (side-chained), a pad in the breakdown
        if not breakdown:
            for k in (0.5, 1.5, 2.5, 3.5):
                if sect == 1 and k == 3.5 and bar % 2:
                    continue
                s.add(b0 + k, stab([hz(m + 12) for m in notes], s.beat_s(0.3), seed=bar), 0.3, pan=0.15 if k % 2 else -0.15, rev=0.2, side=0.8)
        if breakdown or sect == 1:
            s.add(b0, pad([hz(m + 12) for m in notes], s.beat_s(4), seed=bar), 0.3 if breakdown else 0.18, rev=0.45, side=0.4)
        # marimba arps in B, C (from bar 2 of C) and D
        if sect in (1, 3) or (breakdown and bar >= 17):
            arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[2], tri[1] + 12, tri[2] + 12, tri[1] + 12]
            for k in range(16):
                m = arp[k % 8] + 12
                s.add(b0 + k * 0.25, marimba(hz(m), 1.0, 0.35), 0.24 * (1.0 if k % 4 == 0 else 0.7), pan=-0.4 if k % 2 else 0.4, rev=0.2, side=0.3)
    # breakdown build: a riser over its last two bars, a roll on the last
    s.add(22 * 4, riser(s.beat_s(8)), 0.5, pan=0, rev=0.3, human=False)
    for k in range(16):
        s.add(23 * 4 + k * 0.25, snare_roll_hit(0.3 + 0.7 * k / 15, seed=k), 0.5, pan=0.05, rev=0.2, human=False)
    # loop end fill: claps on the last beat's 16ths
    for k in range(4):
        s.add(31 * 4 + 3 + k * 0.25, clap(0.5 + 0.15 * k, seed=90 + k), 0.4, pan=0.05, rev=0.2, human=False)
    leadA = ("D5:0.5 G5:0.5 B5:0.5 A5:0.5 G5:0.5 D5:0.5 E5:0.5 G5:0.5 | E5:0.75 E5:0.25 G5:0.5 B5:0.5 A5:1 G5:1 | "
             "C5:0.5 E5:0.5 G5:0.5 E5:0.5 A5:1 G5:0.5 E5:0.5 | F#5:1.5 E5:0.5 D5:1 r:1 | "
             "D5:0.5 G5:0.5 B5:0.5 A5:0.5 G5:0.5 D5:0.5 E5:0.5 G5:0.5 | E5:0.5 G5:0.5 B5:0.5 D6:0.5 B5:1 A5:1 | "
             "C6:0.5 B5:0.5 A5:0.5 G5:0.5 E5:0.5 G5:0.5 A5:1 | F#5:0.5 A5:0.5 D6:1 r:2")
    glockB = ("G5:1 E5:1 C6:2 | A5:1 F#5:1 D6:2 | B5:1 F#5:1 D6:1 B5:1 | G5:2 E5:2 | "
              "E6:1 C6:1 G5:1 E5:1 | D6:1 A5:1 F#5:1 D5:1 | G5:0.5 B5:0.5 D6:0.5 G6:2.5 | r:4")
    whistleC = ("B4:2 E5:2 | G5:3 E5:1 | D5:2 B4:2 | A4:4 | B4:1 E5:1 G5:2 | A5:2 G5:1 E5:1 | D5:2 G5:2 | F#5:4")
    sq = lambda f, d, p: square_pluck(f, d)  # noqa: E731
    gl = lambda f, d, p: glock(f)  # noqa: E731
    wh = lambda f, d, p: whistle(f, d, glide_from=p)  # noqa: E731
    s.melody(0, leadA, sq, gain=0.75, pan=0.05, rev=0.2, dly=0.28)
    s.melody(8, glockB, gl, gain=0.85, pan=0.2, rev=0.35, dly=0.12)
    s.melody(16, whistleC, wh, gain=0.8, pan=-0.05, rev=0.4, dly=0.15)
    s.melody(24, leadA, sq, gain=0.75, pan=0.05, rev=0.2, dly=0.28)
    s.melody(24, leadA, gl, gain=0.3, pan=0.3, rev=0.35, oct_=1)
    # section changes: a slide whistle into B, a toy "boing" into D
    s.add(7 * 4 + 3, slide_whistle(hz(midi("D5")), hz(midi("G6")), s.beat_s(1)), 0.5, pan=-0.2, rev=0.3)
    s.add(15 * 4 + 3, slide_whistle(hz(midi("G6")), hz(midi("G5")), s.beat_s(0.9)), 0.45, pan=0.2, rev=0.3)
    s.dly_beats = 0.75
    return s


def tension():
    s = Song(128, 16, seed=7)
    D5, D4 = hz(midi("D5")), hz(midi("D4"))
    for bar in range(16):
        b0 = bar * 4
        k = bar / 15
        # tick-tock
        for e in range(8):
            s.add(b0 + e * 0.5, woodblock(1900 if e % 2 == 0 else 1350), 0.42 if e % 2 == 0 else 0.3, pan=0.3 if e % 2 else -0.3, rev=0.15)
        # the 16th pulse on D, brighter and louder as the phrase climbs
        for e in range(16):
            f = D5 if e % 4 != 2 else D4
            s.add(b0 + e * 0.25, square_pluck(f, s.beat_s(0.18)) * (0.5 + 0.5 * k), 0.38 * (1.0 if e % 4 == 0 else 0.7), pan=0.15 if e % 2 else -0.15, rev=0.1)
        # low toms on D every two bars, every bar in the second half
        if bar % 2 == 0 or bar >= 8:
            s.add(b0, tom(hz(midi("D2"))), 0.6, rev=0.25)
        if bar >= 12:
            s.add(b0 + 2.5, tom(hz(midi("A2")), 0.7), 0.45, rev=0.25)
    s.add(12 * 4, riser(s.beat_s(16)), 0.4, rev=0.3, human=False)
    for e in range(16):
        s.add(15 * 4 + e * 0.25, snare_roll_hit(0.25 + 0.75 * e / 15, seed=e), 0.45, rev=0.2, human=False)
    s.dly_beats = 0.75
    return s


# ───────────────────────── render + master ─────────────────────────
def pan_gains(p):
    return np.cos((p + 1) * np.pi / 4) * np.sqrt(2), np.sin((p + 1) * np.pi / 4) * np.sqrt(2)


def render(song, reps=3):
    L = int(round(song.loop * SR))
    n = L * reps + int(4 * SR)
    main = np.zeros((2, n))
    side = np.zeros((2, n))
    rev = np.zeros((2, n))
    dly = np.zeros((2, n))
    for at, x, g, p, r, d, sc in song.ev:
        gl, gr = pan_gains(p)
        for k in range(reps):
            i = int(round(at * SR)) + k * L
            if i < 0:
                continue
            m = min(len(x), n - i)
            if m <= 0:
                continue
            seg = x[:m] * g
            tgt = side if sc > 0 else main
            amt = sc if sc > 0 else 1.0
            # a side-chained voice is split: (1 - amt) dry, amt through the duck
            if sc > 0:
                main[0, i:i + m] += seg * gl * (1 - amt)
                main[1, i:i + m] += seg * gr * (1 - amt)
            tgt[0, i:i + m] += seg * gl * amt
            tgt[1, i:i + m] += seg * gr * amt
            if r:
                rev[0, i:i + m] += seg * gl * r
                rev[1, i:i + m] += seg * gr * r
            if d:
                dly[0, i:i + m] += seg * gl * d
                dly[1, i:i + m] += seg * gr * d
    # side-chain: a duck after every kick (0.45 at the hit, back within ~a beat)
    if song.kicks:
        env = np.ones(n)
        shape = 1 - 0.55 * np.exp(-np.arange(int(song.spb * SR)) / (0.11 * SR))
        shape[: int(0.004 * SR)] = np.linspace(1, shape[int(0.004 * SR)], int(0.004 * SR))
        for b in song.kicks:
            for k in range(reps):
                i = int(round(song.time(b) * SR)) + k * L
                m = min(len(shape), n - i)
                env[i:i + m] = np.minimum(env[i:i + m], shape[:m])
        side *= env
    mix = main + side
    # ping-pong delay (dotted eighth), dark, feedback 0.38
    dt = int(song.dly_beats * song.spb * SR)
    wet = np.zeros_like(dly)
    src = dsp.hp(dsp.lp(dly, 4500), 300)
    g = 0.55
    for k in range(1, 7):
        ch = (k - 1) % 2
        o = k * dt
        if o >= n:
            break
        wet[ch, o:] += (src[0, :n - o] + src[1, :n - o]) * 0.5 * g
        g *= 0.38 / 0.55 if k == 1 else 0.38
    mix += wet
    # plate-ish reverb send
    irL = dsp.reverb_ir(2.2, 0.5, seed=11, bright=6500, predelay=0.018)
    irR = dsp.reverb_ir(2.2, 0.5, seed=12, bright=6500, predelay=0.021)
    rsend = dsp.hp(rev, 220)
    mix[0] += dsp.fftconv(rsend[0], irL)[:n] * 0.6
    mix[1] += dsp.fftconv(rsend[1], irR)[:n] * 0.6
    return mix, L


def master(mix, L, name, wav_dir, I, ogg_rate, m4a_rate, mono=False):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        raw = os.path.join(work, "raw.wav")
        if mono:
            mix = mix.mean(0, keepdims=True)
        mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.5
        dsp.write_wav(raw, mix.astype(np.float32))
        glued = os.path.join(work, "glued.wav")
        dsp.ff_chain(raw, glued, af="highpass=f=35:p=2,equalizer=f=3500:t=q:w=1.2:g=2,highshelf=f=7500:g=2.5,acompressor=threshold=-18dB:ratio=2:attack=12:release=180:knee=6:makeup=1.5")
        norm = os.path.join(work, "norm.wav")
        m = dsp.normalise(glued, norm, I=I, TP=-1.5)
        y = dsp.read_audio(norm, ch=1 if mono else 2)
        p = int(PAD * SR)
        seg = y[:, L - p: 2 * L + p]
        cut = os.path.join(wav_dir or work, f"{name}.wav")
        dsp.write_wav(cut, seg.astype(np.float32))
        # the seam: the sample after the loop end must continue from the loop start
        a, b = seg[:, p + L - 1: p + L + 1], seg[:, p - 1: p + 1]
        jump = float(np.max(np.abs((a[:, 1] - a[:, 0]) - (b[:, 1] - b[:, 0]))))
        base = os.path.join(OUT, name)
        ch = "1" if mono else "2"
        dsp.ff(["-i", cut, "-map_metadata", "-1", "-ac", ch, "-c:a", "libopus", "-b:a", ogg_rate, "-vbr", "constrained",
                "-application", "audio", base + ".ogg"])
        dsp.ff(["-i", cut, "-map_metadata", "-1", "-ac", ch, "-c:a", "aac", "-b:a", m4a_rate, "-movflags", "+faststart",
                base + ".m4a"])
        sizes = {ext: os.path.getsize(f"{base}.{ext}") for ext in ("ogg", "m4a")}
        print(f"{name:8s} loop {L / SR:.2f}s  I {m['I']:.1f}  TP {m['TP']:.1f}  seam {jump:.4f}  {sizes}", flush=True)
        return sizes


TRACKS = {
    # name: (song, LUFS, opus rate, aac rate, mono)
    "lobby": (lobby, -17.0, "32k", "48k", False),
    "game": (game, -17.0, "32k", "48k", False),
    "tension": (tension, -19.0, "20k", "32k", True),
}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--wav", default=None)
    a = ap.parse_args()
    only = set(x for x in a.only.split(",") if x)
    manifest_path = os.path.join(OUT, "music.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for name, (fn, I, orate, arate, mono) in TRACKS.items():
        if only and name not in only:
            continue
        song = fn()
        mix, L = render(song)
        master(mix, L, name, a.wav, I, orate, arate, mono)
        manifest[name] = {"loop": round(L / SR, 6), "pad": PAD, "bpm": song.bpm, "bars": song.bars}
    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    open(manifest_path, "a").write("\n")
