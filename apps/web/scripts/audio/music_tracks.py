"""The extra soundtracks a player can pick in the settings, synthesised like music.py (numpy + ffmpeg).

  python3 scripts/audio/music_tracks.py [--only chill,arcade,chiptune,lofi] [--wav DIR]

Each is one seamless loop that plays in the lobby and in the room (the default soundtrack, music.py,
keeps its lobby / game / tension moods). Same pipeline as music.py: every note is rendered three
times in a row, the master chain (glue, -17 LUFS, true peak <= -1.5 dBTP) runs over all three, and
the middle loop is cut out with PAD seconds either side; Ogg Opus + AAC .m4a.

  chill     D major, 86 BPM, 32 bars (89 s): kalimba arpeggios, a warm pad and electric piano, a
            breathy flute and glockenspiel trading the tune, a soft kick, rim and shaker.
            A (8, no drums) / B (8) / A' (8) / B' (8, the flute doubles the bells)
  arcade    A minor, 150 BPM, 40 bars (64 s): punchy four-on-the-floor, rolling saw bass,
            side-chained supersaw stabs, 16th square arps and a detuned saw lead.
            groove (8) / hook (8) / breakdown with a riser (8) / hook, full (8) / second theme (8)
  chiptune  C major, 140 BPM, 40 bars (69 s): two pulse channels (25 % lead with vibrato, 12.5 %
            arps or a harmony a third below), a stepped triangle bass and LFSR-style noise drums.
            A (8) / A + harmony (8) / bridge (8) / A, octave up (8) / bridge + countermelody (8)
  lofi      C major, 76 BPM, 24 bars (76 s), swung 16ths: a dusty FM electric piano, round bass,
            a lazy boom-bap kit, a nylon pluck and a soft sine lead, vinyl crackle and tape wobble,
            all through a gentle low-pass and saturation.
            A (8, vibes) / B (8, pluck tune) / A' (8, sine lead)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import music as M  # noqa: E402
from music import SR, Song, attack, chord, gate, hz, midi, tt  # noqa: E402

dsp = M.dsp


# ───────────────────────── shared instruments ─────────────────────────
def kalimba(f, v=1.0, seed=0):
    t = tt(1.5)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.6)
    x += 0.1 * np.sin(2 * np.pi * 2.0 * f * t) * np.exp(-t / 0.25)
    if f * 5.95 < SR * 0.45:
        x += 0.22 * np.sin(2 * np.pi * 5.95 * f * t) * np.exp(-t / 0.05)
    click = dsp.bp(np.random.default_rng(seed + 5).standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.004) * 0.12
    return attack(x + click, 0.0012) * 0.42 * v


def flute(f, dur, v=1.0, seed=0, glide_from=None):
    """A breathy flute: sine with a little 2nd / 3rd, breath noise, a slow swell and a late vibrato."""
    t = tt(dur + 0.15)
    vib = 1 + 0.007 * np.sin(2 * np.pi * 4.8 * t) * np.clip((t - 0.2) / 0.3, 0, 1)
    f0 = glide_from if glide_from and abs(glide_from / f - 1) < 0.2 else f * 0.985
    ff = (f + (f0 - f) * np.exp(-t / 0.04)) * vib
    ph = 2 * np.pi * np.cumsum(ff) / SR
    x = np.sin(ph) + 0.1 * np.sin(2 * ph) + 0.04 * np.sin(3 * ph)
    br = dsp.bp(np.random.default_rng(seed + 9).standard_normal(len(t)), f * 0.8, f * 4) * 0.07
    env = np.minimum(1, t / 0.07) * (0.85 + 0.15 * np.exp(-t / 0.3))
    return gate((x + br) * env, dur, 0.12) * 0.3 * v


def ep(f, dur, v=1.0, seed=0, wow=0.0):
    """FM electric piano: 1:1 modulator whose index dies away (the bark), a 14x tine ping."""
    t = tt(dur + 0.9)
    r = np.random.default_rng(seed)
    drift = 1 + wow * np.sin(2 * np.pi * r.uniform(0.35, 0.7) * t + r.uniform(0, 2 * np.pi))
    ph = 2 * np.pi * np.cumsum(f * drift) / SR
    soft = min(1.0, 330 / f)
    idx = (1.3 * np.exp(-t / 0.3) + 0.22) * (0.6 + 0.4 * v) * soft
    x = np.sin(ph + idx * np.sin(ph))
    if f * 14 < SR * 0.45:
        x += 0.12 * np.sin(14 * ph) * np.exp(-t / 0.025)
    x *= np.exp(-t / (1.8 if f < 300 else 1.2))
    return gate(attack(x, 0.002), dur, 0.3) * 0.3 * v


def soft_bass(f, dur, v=1.0):
    t = tt(dur + 0.1)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.15) + 0.08 * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.06)
    x *= np.exp(-t / max(0.4, dur * 1.5))
    return gate(attack(x, 0.006), dur, 0.06) * 0.5 * v


def rim(v=1.0, seed=0):
    t = tt(0.08)
    x = np.sin(2 * np.pi * 1750 * t) * np.exp(-t / 0.008) * 0.6 + np.sin(2 * np.pi * 520 * t) * np.exp(-t / 0.012) * 0.4
    x += dsp.bp(np.random.default_rng(seed + 61).standard_normal(len(t)), 2000, 8000) * np.exp(-t / 0.006) * 0.4
    return attack(x, 0.0005) * 0.5 * v


def crash(v=1.0, seed=0):
    t = tt(1.8)
    n = np.random.default_rng(seed + 71).standard_normal(len(t))
    x = dsp.hp(n, 4200) * np.exp(-t / 0.6) + dsp.bp(n, 6000, 12000) * np.exp(-t / 0.25) * 0.5
    return attack(x, 0.001) * 0.22 * v


def saws(f, t, det=(-0.007, 0.007), top=9000, phase_seed=0):
    r = np.random.default_rng(phase_seed)
    x = np.zeros(len(t))
    for d in det:
        fd = f * (1 + d)
        ph = r.uniform(0, 2 * np.pi)
        for k in range(1, 60):
            if k * fd > top:
                break
            x += np.sin(2 * np.pi * k * fd * t + ph * k) / k
    return x / len(det)


# ───────────────────────── chill ─────────────────────────
CHILL = {
    # name: (bass, pad / ep voicing, arpeggio)
    "Dmaj7": ("D2", "F#3 A3 C#4 E4", "D4 F#4 A4 C#5 E5"),
    "F#m7": ("F#2", "E3 A3 C#4", "F#4 A4 C#5 E5"),
    "Gmaj7": ("G2", "F#3 B3 D4", "G4 B4 D5 F#5"),
    "A": ("A1", "E3 A3 C#4", "A4 C#5 E5 A5"),
    "A7": ("A1", "G3 C#4 E4", "A4 C#5 E5 G5"),
    "Em7": ("E2", "G3 B3 D4", "E4 G4 B4 D5"),
    "Bm7": ("B1", "F#3 A3 D4", "B4 D5 F#5 A5"),
}


def chill():
    s = Song(86, 32, seed=86)
    A = ["Dmaj7", "F#m7", "Gmaj7", "A", "Dmaj7", "F#m7", "Em7", "A7"]
    B = ["Bm7", "Gmaj7", "Dmaj7", "A", "Bm7", "Gmaj7", "Em7", "A"]
    prog = A + B + A + B
    arp_pos = (0, 0.75, 1.5, 2, 2.75, 3.5)
    arp_idx = (0, 1, 2, 3, 2, 1)
    for bar, name in enumerate(prog):
        bn, voicing, arpn = CHILL[name]
        notes = chord(voicing)
        arp = chord(arpn)
        b0 = bar * 4
        sect = bar // 8
        # a warm pad all through, a little wider in B
        s.add(b0, M.pad([hz(m) for m in notes], s.beat_s(4.0), seed=bar), 0.36 if sect == 0 else 0.3 if sect % 2 == 0 else 0.34, rev=0.45)
        # kalimba arpeggios (dotted), one more note on the last eighth from the second A
        for k, (p, i) in enumerate(zip(arp_pos, arp_idx)):
            m = arp[i % len(arp)]
            s.add(b0 + p, kalimba(hz(m), 1.0 if k == 0 else 0.8, seed=bar * 8 + k), 0.42 if sect == 0 else 0.36, pan=-0.35 + 0.14 * k, rev=0.35, dly=0.2)
        if sect >= 2 and bar % 2 == 1:
            s.add(b0 + 3.75, kalimba(hz(arp[-1] + 12), 0.6, seed=bar), 0.2, pan=0.45, rev=0.4, dly=0.3)
        # electric piano chords from B on: a held chord and a soft re-hit on the and-of-3
        if sect >= 1:
            for i, m in enumerate(notes):
                s.add(b0 + i * 0.01, ep(hz(m), s.beat_s(2.4), 0.7, seed=bar * 5 + i), 0.3, pan=0.1, rev=0.35)
                s.add(b0 + 2.5 + i * 0.01, ep(hz(m), s.beat_s(1.4), 0.45, seed=bar * 7 + i), 0.22, pan=0.1, rev=0.35)
        # bass from B: root, a fifth, a passing note
        if sect >= 1:
            root = M.low(midi(bn))
            s.add(b0, soft_bass(hz(root), s.beat_s(1.4)), 1.0)
            s.add(b0 + 1.5, soft_bass(hz(root), s.beat_s(0.4)), 0.6)
            s.add(b0 + 2.5, soft_bass(hz(M.low(root + 7, 36, 47)), s.beat_s(1.2)), 0.8)
        # kit from B: soft kick, rim on 2 and 4, shaker in 8ths; a lighter bar before the loop point
        if sect >= 1:
            last = bar == 31
            s.add(b0, dsp.lp(M.kick(0.7, 0.5), 1800), 0.8)
            if not last:
                s.add(b0 + 2.75, dsp.lp(M.kick(0.45, 0.4), 1800), 0.6)
            for k in (1, 3):
                s.add(b0 + k, rim(1.0, seed=bar * 2 + k), 0.38, pan=0.15, rev=0.3)
            for k in range(8):
                s.add(b0 + k * 0.5, M.shaker(1.0 if k % 2 else 0.55, seed=bar * 8 + k), 0.36, pan=-0.3)
        else:
            # A: only the shaker on the off-beats
            for k in (1, 3, 5, 7):
                s.add(b0 + k * 0.5, M.shaker(0.6, seed=bar * 8 + k), 0.22, pan=-0.3)
    melA = ("r:1 F#5:0.5 A5:0.5 C#6:1.5 A5:0.5 | B5:1 A5:0.5 F#5:0.5 E5:2 | "
            "r:0.5 D5:0.5 F#5:0.5 A5:0.5 B5:1.5 D6:0.5 | C#6:1 B5:0.5 A5:0.5 E5:2 | "
            "r:1 F#5:0.5 A5:0.5 C#6:1 E6:1 | D6:0.5 C#6:0.5 A5:1 F#5:2 | "
            "G5:1 B5:0.5 A5:0.5 G5:0.5 F#5:0.5 E5:1 | E5:1 F#5:0.5 G5:0.5 A5:2")
    melB = ("D6:1.5 C#6:0.5 B5:1 F#5:1 | A5:1.5 B5:0.5 F#5:2 | E5:0.5 F#5:0.5 A5:1 D6:1 C#6:1 | B5:0.5 C#6:2.5 r:1 | "
            "D6:1 F#6:1 E6:0.5 D6:0.5 B5:1 | D6:1.5 B5:0.5 A5:1 F#5:1 | G5:1 A5:0.5 B5:0.5 D6:1 B5:1 | "
            "A5:2 G5:0.5 F#5:0.5 E5:1")
    gl = lambda f, d, p: M.glock(f)  # noqa: E731
    fl = lambda f, d, p: flute(f, d, glide_from=p)  # noqa: E731
    s.melody(0, melA, fl, gain=0.9, pan=-0.05, rev=0.4, dly=0.12, oct_=-1)
    s.melody(8, melB, gl, gain=0.8, pan=0.15, rev=0.4, dly=0.15)
    s.melody(16, melA, gl, gain=0.8, pan=0.15, rev=0.4, dly=0.15)
    s.melody(16, melA, fl, gain=0.35, pan=-0.2, rev=0.45, oct_=-1)
    s.melody(24, melB, fl, gain=0.85, pan=-0.05, rev=0.4, dly=0.12)
    s.melody(24, melB, gl, gain=0.32, pan=0.3, rev=0.45)
    s.dly_beats = 0.75
    s.rev_dur, s.rev_decay, s.rev_mix = 3.0, 0.8, 0.7
    return s


# ───────────────────────── arcade ─────────────────────────
ARC = {
    "Am": ("A1", [57, 60, 64]), "F": ("F1", [53, 57, 60]), "C": ("C2", [55, 60, 64]),
    "G": ("G1", [55, 59, 62]), "E": ("E1", [56, 59, 64]), "Em": ("E1", [55, 59, 64]),
}


def saw_lead(f, dur, v=1.0, glide_from=None):
    t = tt(dur + 0.12)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 6.2 * t) * np.clip((t - 0.18) / 0.12, 0, 1)
    if glide_from and abs(np.log2(glide_from / f)) < 0.6:
        g = 1 + (glide_from / f - 1) * np.exp(-t / 0.018)
    else:
        g = 1.0
    ff = f * vib * g
    x = np.zeros(len(t))
    for d in (-0.006, 0.006):
        ph = 2 * np.pi * np.cumsum(ff * (1 + d)) / SR
        for k in range(1, 40):
            if k * f > 8000:
                break
            x += np.sin(k * ph) / k
    x = dsp.lp(x * 0.5, 4200)
    env = np.minimum(1, t / 0.004) * (0.8 + 0.2 * np.exp(-t / 0.12))
    return gate(x * env, dur * 0.92, 0.05) * 0.3 * v


def saw_bass(f, dur, v=1.0):
    t = tt(dur + 0.05)
    x = np.sin(2 * np.pi * f * t) * 0.8
    for k in range(1, 36):
        if k * f > 3500:
            break
        x += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (8 + 7 * k)) * 0.9
    return gate(attack(x, 0.002), dur, 0.02) * 0.45 * v


def arcade():
    s = Song(150, 40, seed=150)
    P1 = ["Am", "F", "C", "G", "Am", "F", "G", "E"]
    P2 = ["F", "G", "Em", "Am", "F", "G", "E", "E"]
    prog = P1 + P1 + P2 + P1 + P2
    for bar, name in enumerate(prog):
        bn, tri = ARC[name]
        root = M.low(midi(bn))
        b0 = bar * 4
        sect = bar // 8
        brk = sect == 2
        if bar % 8 == 0 and not brk:
            s.add(b0, crash(1.0, seed=bar), 0.7, pan=-0.2, rev=0.3)
        # kit
        if not brk or bar >= 22:
            for k in range(4):
                if brk and k % 2:
                    continue
                s.add(b0 + k, M.kick(1.0, 1.2), 1.0, human=False)
                s.kicks.append(b0 + k)
        elif bar % 2 == 0:
            s.add(b0, M.kick(0.7, 0.8), 0.7, human=False)
            s.kicks.append(b0)
        if not brk:
            for k in (1, 3):
                s.add(b0 + k, M.clap(1.0, seed=bar * 2 + k), 0.6, pan=0.04, rev=0.2)
                s.add(b0 + k, M.snare_roll_hit(0.8, seed=bar + k), 0.35, pan=0.04, rev=0.15)
            for k in range(16):
                op = k % 4 == 2
                s.add(b0 + k * 0.25, M.hat(1.0 if op else 0.55, open_=op, seed=bar * 16 + k), 0.36 if op else 0.22, pan=0.28)
        # rolling bass: 16ths, the octave on the off-16ths
        if not brk or bar >= 20:
            for k in range(16):
                if k % 4 == 0 and not brk:
                    continue  # the kick takes the downbeats
                m = root + (12 if k % 2 else 0)
                s.add(b0 + k * 0.25, saw_bass(hz(m), s.beat_s(0.2)), 0.58 if k % 2 == 0 else 0.4, side=0.7)
        else:
            s.add(b0, saw_bass(hz(root), s.beat_s(3.5)), 0.6)
        # supersaw stabs on the off-beats (side-chained); a pad in the breakdown
        voiced = [hz(m) for m in tri]
        if not brk:
            for k in (0.5, 1.5, 2.5, 3.5):
                s.add(b0 + k, M.stab(voiced, s.beat_s(0.28), seed=bar), 0.42, pan=-0.15 if k in (0.5, 2.5) else 0.15, rev=0.2, side=0.85)
        else:
            s.add(b0, M.pad(voiced, s.beat_s(4), seed=bar), 0.42, rev=0.5)
        # 16th square arpeggios (from the second section; all through the breakdown)
        if sect >= 1:
            arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[2] + 12, tri[0] + 12, tri[2], tri[1]]
            for k in range(16):
                s.add(b0 + k * 0.25, M.square_pluck(hz(arp[k % 8] + 12), s.beat_s(0.2)), 0.27 * (1.0 if k % 4 == 0 else 0.7), pan=-0.45 if k % 2 else 0.45, rev=0.15, side=0.5)
    # breakdown build: a riser and a snare roll into the full hook
    s.add(22 * 4, M.riser(s.beat_s(8)), 0.55, rev=0.3, human=False)
    for k in range(16):
        s.add(23 * 4 + k * 0.25, M.snare_roll_hit(0.3 + 0.7 * k / 15, seed=k), 0.55, rev=0.2, human=False)
    # the loop end: a tom fill
    for k, f in enumerate(("A2", "A2", "E2", "E2", "C2", "C2", "A1", "A1")):
        s.add(39 * 4 + 2 + k * 0.25, M.tom(hz(midi(f)), 0.8), 0.5, pan=-0.3 + 0.08 * k, rev=0.2, human=False)
    hook = ("E5:0.5 A5:0.5 C6:0.75 B5:0.25 A5:0.5 E5:0.5 A5:0.5 B5:0.5 | C6:0.75 A5:0.25 F5:0.5 A5:0.5 C6:1 D6:0.5 C6:0.5 | "
            "E6:0.75 D6:0.25 C6:0.5 G5:0.5 E5:0.5 G5:0.5 C6:0.5 E6:0.5 | D6:1.5 B5:0.5 G5:0.5 A5:0.5 B5:1 | "
            "E5:0.5 A5:0.5 C6:0.75 B5:0.25 A5:0.5 E5:0.5 A5:0.5 B5:0.5 | C6:0.75 A5:0.25 F5:0.5 A5:0.5 C6:0.5 F6:0.5 E6:0.5 C6:0.5 | "
            "D6:0.75 B5:0.25 G5:0.5 D6:0.5 G6:1 F6:0.5 D6:0.5 | E6:1.5 D6:0.25 C6:0.25 B5:1 G#5:1")
    theme2 = ("C6:1.5 A5:0.5 C6:0.5 D6:0.5 C6:1 | B5:1.5 G5:0.5 B5:0.5 D6:0.5 B5:1 | G5:0.5 B5:0.5 E6:1 D6:0.5 B5:0.5 G5:1 | A5:3 r:1 | "
              "C6:0.5 C6:0.5 A5:0.5 C6:0.5 F6:1 E6:1 | D6:0.5 D6:0.5 B5:0.5 D6:0.5 G6:1 F6:1 | E6:1 B5:1 G#5:1 B5:1 | E6:2 r:2")
    ld = lambda f, d, p: saw_lead(f, d, glide_from=p)  # noqa: E731
    gl = lambda f, d, p: M.glock(f)  # noqa: E731
    sq = lambda f, d, p: M.square_pluck(f, d)  # noqa: E731
    s.melody(8, hook, ld, gain=1.15, pan=0.0, rev=0.2, dly=0.25)
    s.melody(16, theme2, sq, gain=0.7, pan=0.1, rev=0.35, dly=0.3)
    s.melody(24, hook, ld, gain=1.15, pan=0.0, rev=0.2, dly=0.25)
    s.melody(24, hook, gl, gain=0.32, pan=0.3, rev=0.3, oct_=1)
    s.melody(32, theme2, ld, gain=1.15, pan=0.0, rev=0.2, dly=0.25)
    s.melody(32, theme2, sq, gain=0.4, pan=-0.3, rev=0.25, oct_=-1)
    s.dly_beats = 0.75
    s.rev_dur, s.rev_decay = 1.8, 0.4
    return s


# ───────────────────────── chiptune ─────────────────────────
def pulse(f, dur, duty=0.25, v=1.0, vib=0.0, decay=None, slide_from=None):
    """A band-limited pulse wave (NES-style duty), optional delayed vibrato and pitch slide."""
    t = tt(dur + 0.01)
    ff = np.full(len(t), f, dtype=float)
    if slide_from:
        ff = f + (slide_from - f) * np.exp(-t / 0.025)
    if vib:
        ff = ff * (1 + vib * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.16) / 0.1, 0, 1))
    ph = 2 * np.pi * np.cumsum(ff) / SR
    x = np.zeros(len(t))
    for k in range(1, 64):
        if k * f > 12000:
            break
        x += np.sin(np.pi * k * duty) / k * np.cos(k * ph)
    x *= 2 / np.pi
    env = np.ones(len(t)) if decay is None else 0.35 + 0.65 * np.exp(-t / decay)
    return gate(attack(x * env, 0.001), dur, 0.008) * 0.32 * v


def tri_bass(f, dur, v=1.0):
    """The NES triangle: a 4-bit stepped triangle (no volume control, just on / off)."""
    t = tt(dur + 0.01)
    p = (f * t) % 1.0
    tri = 4 * np.abs(p - 0.5) - 1
    tri = np.round((tri + 1) * 7.5) / 7.5 - 1
    return gate(dsp.lp(tri, 9000), dur, 0.006) * 0.55 * v


def chip_noise(dur, period=1, decay=0.05, seed=0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    x = r.choice([-1.0, 1.0], size=n // period + 1).repeat(period)[:n]
    t = np.arange(n) / SR
    return x * np.exp(-t / decay)


def chip_kick(v=1.0):
    t = tt(0.18)
    f = 50 + 160 * np.exp(-t / 0.025)
    p = (np.cumsum(f) / SR) % 1.0
    tri = 4 * np.abs(p - 0.5) - 1
    x = np.round((tri + 1) * 7.5) / 7.5 - 1
    x = x * np.exp(-t / 0.07) + chip_noise(0.18, 4, 0.006, seed=3) * 0.3
    return dsp.lp(x, 7000) * 0.7 * v


def chip_snare(v=1.0, seed=0):
    x = chip_noise(0.2, 2, 0.07, seed=seed + 11)
    t = tt(0.2)
    f = 150 + 120 * np.exp(-t / 0.02)
    p = (np.cumsum(f) / SR) % 1.0
    x += (4 * np.abs(p - 0.5) - 1) * np.exp(-t / 0.03) * 0.5
    return dsp.lp(x, 9000) * 0.42 * v


def chip_hat(v=1.0, open_=False, seed=0):
    x = chip_noise(0.2 if open_ else 0.05, 1, 0.09 if open_ else 0.015, seed=seed + 21)
    return dsp.hp(x, 6000) * 0.3 * v


C_MAJOR = [0, 2, 4, 5, 7, 9, 11]


def diatonic(m, steps, scale=C_MAJOR):
    """Moves a note `steps` scale degrees (negative: down) within the scale."""
    pc, octv = m % 12, m // 12
    i = min(range(len(scale)), key=lambda k: abs(scale[k] - pc))
    j = i + steps
    return octv * 12 + scale[j % len(scale)] + 12 * (j // len(scale))


CHIP = {"C": ("C2", [60, 64, 67]), "Am": ("A1", [57, 60, 64]), "F": ("F1", [53, 57, 60]), "G": ("G1", [55, 59, 62]),
        "Dm": ("D2", [50, 53, 57]), "Em": ("E2", [52, 55, 59])}


def chiptune():
    s = Song(140, 40, seed=140)
    P1 = ["C", "Am", "F", "G", "C", "Am", "Dm", "G"]
    P2 = ["F", "G", "Em", "Am", "F", "G", "C", "G"]
    prog = P1 + P1 + P2 + P1 + P2
    for bar, name in enumerate(prog):
        bn, tri = CHIP[name]
        root = M.low(midi(bn), 36, 47)
        b0 = bar * 4
        sect = bar // 8
        # noise kit: kick on 1 and 3 (and the and-of-3 every other bar), snare on 2 and 4, 8th hats
        s.add(b0, chip_kick(), 0.9, human=False)
        s.add(b0 + 2, chip_kick(0.9), 0.85, human=False)
        if bar % 2 == 1:
            s.add(b0 + 2.5, chip_kick(0.6), 0.6, human=False)
        for k in (1, 3):
            s.add(b0 + k, chip_snare(seed=bar * 2 + k), 0.7, human=False)
        for k in range(8):
            s.add(b0 + k * 0.5, chip_hat(1.0 if k % 2 else 0.6, open_=(k == 7 and bar % 4 == 3), seed=bar * 8 + k), 0.4, pan=0.15, human=False)
        if bar % 8 == 7:
            for k in range(4):
                s.add(b0 + 3 + k * 0.25, chip_snare(0.5 + 0.15 * k, seed=90 + k), 0.55, human=False)
        # triangle bass: octave bounce in 8ths
        for k in range(8):
            m = root + (12 if k % 2 else 0)
            if k == 7 and bar % 2 == 1:
                m = root + 7
            s.add(b0 + k * 0.5, tri_bass(hz(m), s.beat_s(0.42)), 0.6, human=False)
        # pulse 2 in A, the bridge and the last section: 16th arpeggios of the chord
        if sect in (0, 2, 4):
            arp = [tri[0], tri[1], tri[2], tri[0] + 12]
            for k in range(16):
                s.add(b0 + k * 0.25, pulse(hz(arp[k % 4]), s.beat_s(0.22), duty=0.125, decay=0.06), 0.5, pan=-0.3, human=False)
    theme1 = ("C5:0.5 E5:0.5 G5:0.5 C6:0.5 B5:0.5 G5:0.5 E5:0.5 G5:0.5 | A5:1 E5:0.5 A5:0.5 C6:1 B5:0.5 A5:0.5 | "
              "F5:0.5 A5:0.5 C6:0.5 F6:0.5 E6:0.5 C6:0.5 A5:0.5 C6:0.5 | D6:1.5 C6:0.25 B5:0.25 G5:1 r:1 | "
              "C5:0.5 E5:0.5 G5:0.5 C6:0.5 B5:0.5 G5:0.5 E5:0.5 G5:0.5 | A5:0.5 B5:0.5 C6:0.5 E6:0.5 D6:1 C6:1 | "
              "F5:0.5 A5:0.5 D6:0.5 F6:0.5 E6:0.5 D6:0.5 C6:0.5 A5:0.5 | B5:1 D6:0.5 B5:0.5 G5:1 r:1")
    theme2 = ("A5:1.5 G5:0.5 F5:1 A5:1 | B5:1.5 A5:0.5 G5:1 B5:1 | G5:0.5 B5:0.5 E6:1 D6:0.5 B5:0.5 G5:1 | A5:2 E5:1 A5:1 | "
              "C6:1.5 A5:0.5 F5:1 C6:1 | D6:1.5 B5:0.5 G5:1 D6:1 | E6:0.5 D6:0.5 C6:0.5 G5:0.5 E6:1 G6:1 | F6:0.5 E6:0.5 D6:0.5 B5:0.5 G5:2")
    counter = ("F4:2 A4:2 | G4:2 B4:2 | E4:2 G4:2 | A4:2 C5:2 | F4:2 A4:2 | G4:2 D5:2 | E4:2 G4:2 | D4:2 B4:2")
    lead = lambda f, d, p: pulse(f, d, duty=0.25, vib=0.008 if d > 0.3 else 0.0)  # noqa: E731
    lead_hi = lambda f, d, p: pulse(f, d, duty=0.125, vib=0.008 if d > 0.3 else 0.0, decay=0.25)  # noqa: E731
    harm = lambda f, d, p: pulse(f, d, duty=0.5, decay=0.2)  # noqa: E731
    s.melody(0, theme1, lead, gain=1.0, pan=0.05, rev=0.1, dly=0.15)
    s.melody(8, theme1, lead, gain=1.0, pan=0.05, rev=0.1, dly=0.15)
    # pulse 2 in B and D: the tune a diatonic third below
    for start in (8, 24):
        beat = start * 4
        for seg in theme1.split("|"):
            for tok in seg.split():
                n, d = tok.split(":")
                d = float(d)
                if n != "r":
                    m = diatonic(midi(n), -2)
                    s.add(beat, harm(hz(m), s.beat_s(d), None), 0.5, pan=-0.3, rev=0.1, human=False)
                beat += d
    s.melody(16, theme2, lead, gain=1.0, pan=0.05, rev=0.12, dly=0.18)
    s.melody(24, theme1, lead_hi, gain=0.85, pan=0.05, rev=0.12, dly=0.18, oct_=1)
    s.melody(24, theme1, lead, gain=0.4, pan=0.2, rev=0.1)
    s.melody(32, theme2, lead, gain=1.0, pan=0.05, rev=0.12, dly=0.18)
    s.melody(32, counter, lambda f, d, p: pulse(f, d, duty=0.5, decay=0.4), gain=0.45, pan=-0.35, rev=0.1)
    s.dly_beats = 0.75
    s.rev_dur, s.rev_decay, s.rev_mix = 1.2, 0.3, 0.35
    # the console's output filter: pulses that buzz without biting
    s.post = lambda mix: dsp.lp(mix, 6500)
    return s


# ───────────────────────── lofi ─────────────────────────
class SwingSong(Song):
    """Swung 16ths: the second and fourth 16th of every beat land late."""

    def __init__(self, *a, swing16=0.0, **k):
        super().__init__(*a, **k)
        self.swing16 = swing16

    def time(self, beat):
        frac = beat % 0.5
        if self.swing16 and abs(frac - 0.25) < 1e-6:
            beat += self.swing16
        return beat * self.spb


def nylon(f, dur, v=1.0, seed=0):
    x = dsp.ks_pluck(f, max(0.6, dur + 0.4), bright=0.25, damp=0.995, seed=seed)
    x = dsp.lp(attack(x, 0.002), 2600)
    return gate(x, dur + 0.25, 0.15) * 0.55 * v


def sine_lead(f, dur, v=1.0, seed=0):
    t = tt(dur + 0.3)
    r = np.random.default_rng(seed)
    wob = 1 + 0.004 * np.sin(2 * np.pi * 0.9 * t + r.uniform(0, 6.28)) + 0.006 * np.sin(2 * np.pi * 4.5 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * wob) / SR
    x = np.sin(ph) + 0.12 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph)
    env = np.minimum(1, t / 0.05) * (0.8 + 0.2 * np.exp(-t / 0.4))
    return gate(x * env, dur, 0.18) * 0.26 * v


def vibes(f, v=1.0):
    t = tt(2.0)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) + 0.18 * np.sin(2 * np.pi * 4.0 * f * t) * np.exp(-t / 0.2)
    x *= 1 + 0.25 * np.sin(2 * np.pi * 5.0 * t)
    return attack(x, 0.002) * 0.25 * v


def lofi_kick(v=1.0):
    return dsp.lp(M.kick(1.0, 0.55), 1500) * 1.2 * v


def lofi_snare(v=1.0, seed=0):
    r = np.random.default_rng(seed + 51)
    t = tt(0.35)
    x = dsp.bp(r.standard_normal(len(t)), 700, 5000) * np.exp(-t / 0.1)
    x += np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.7
    return dsp.lp(attack(x, 0.001), 5000) * 0.5 * v


def lofi_hat(v=1.0, seed=0):
    return dsp.lp(M.hat(1.0, seed=seed), 9000) * v


def vinyl(length, seed=0):
    """Hiss and crackle for one whole loop (placed once per loop, so it repeats seamlessly)."""
    r = np.random.default_rng(seed)
    n = int(round(length * SR))
    hiss = dsp.bp(dsp.pink(n, seed=seed + 1), 400, 7000) * 0.02
    pops = np.zeros(n)
    k = int(length * 7)
    pos = r.integers(0, n - 64, k)
    amp = r.exponential(0.25, k) * r.choice([-1, 1], k)
    for p, a in zip(pos, amp):
        pops[p:p + 3] += a * np.array([1.0, -0.6, 0.2])
    pops = dsp.bp(pops, 1200, 7000)
    return hiss + pops * 0.5


LOFI = {
    "Fmaj9": ("F2", "F3 A3 C4 E4 G4"), "Em7": ("E2", "E3 G3 B3 D4"), "Dm9": ("D2", "D3 F3 A3 C4 E4"),
    "Cmaj9": ("C2", "C3 E3 G3 B3 D4"), "Bbmaj7": ("Bb1", "D3 F3 A3 C4"), "Am7": ("A1", "C3 E3 G3 A3"),
    "G7sus": ("G1", "F3 A3 C4 D4"),
}


def lofi():
    s = SwingSong(76, 24, seed=76, swing16=0.06)
    A = ["Fmaj9", "Em7", "Dm9", "Cmaj9"] * 2
    B = ["Bbmaj7", "Am7", "Dm9", "G7sus"] * 2
    prog = A + B + A
    s.add(0, vinyl(s.loop, seed=3), 1.0, human=False)
    for bar, name in enumerate(prog):
        bn, voicing = LOFI[name]
        notes = chord(voicing)
        b0 = bar * 4
        sect = bar // 8
        # keys: a slow strum on 1, a ghosted re-hit on the and-of-2
        for i, m in enumerate(notes):
            s.add(b0 + i * 0.02, ep(hz(m), s.beat_s(2.3), 0.75, seed=bar * 9 + i, wow=0.003), 0.4, pan=-0.12 + 0.06 * i, rev=0.3)
        for i, m in enumerate(notes[1:]):
            s.add(b0 + 2.5 + i * 0.015, ep(hz(m), s.beat_s(1.3), 0.4, seed=bar * 11 + i, wow=0.003), 0.26, pan=0.1, rev=0.3)
        # bass: root on 1, a ghost on the late 16th before 3, the fifth or the octave on the and-of-3
        root = M.low(midi(bn), 33, 45)
        s.add(b0, soft_bass(hz(root), s.beat_s(1.6)), 0.75)
        s.add(b0 + 1.75, soft_bass(hz(root), s.beat_s(0.3)), 0.4)
        s.add(b0 + 2.5, soft_bass(hz(M.low(root + (7 if bar % 2 == 0 else 12), 36, 52)), s.beat_s(1.2)), 0.6)
        # boom-bap: kick 1, the late 16th of 2, the and-of-3; snare 2 and 4; swung hats
        last = bar == len(prog) - 1
        s.add(b0, lofi_kick(), 0.95)
        s.add(b0 + 1.75, lofi_kick(0.6), 0.7)
        if not last:
            s.add(b0 + 2.5, lofi_kick(0.85), 0.85)
        for k in (1, 3):
            s.add(b0 + k, lofi_snare(seed=bar * 2 + k), 0.6, pan=0.06, rev=0.35)
        for k in range(16):
            if k % 2 == 0:
                s.add(b0 + k * 0.25, lofi_hat(0.9, seed=bar * 16 + k), 0.3, pan=0.25)
            elif k % 4 == 3:
                s.add(b0 + k * 0.25, lofi_hat(0.5, seed=bar * 16 + k), 0.18, pan=0.25)
        if last:
            # a fill into the loop point: a snare drag
            for k, g in ((3.5, 0.3), (3.75, 0.45)):
                s.add(b0 + k, lofi_snare(0.7, seed=99 + int(k * 4)), g, pan=0.06, rev=0.35)
        # A: vibes answering the keys, two notes a bar
        if sect == 0:
            top = notes[-1] + 12
            s.add(b0 + 1.5, vibes(hz(top)), 0.8, pan=0.35, rev=0.4, dly=0.2)
            s.add(b0 + 3, vibes(hz(diatonic(top, -1))), 0.6, pan=0.35, rev=0.4, dly=0.2)
    melB = ("r:1 D5:0.5 F5:0.5 A5:1.5 G5:0.5 | E5:1.5 C5:0.5 E5:0.5 G5:1 r:0.5 | F5:0.75 E5:0.25 D5:0.5 A4:0.5 C5:2 | D5:2 C5:0.5 D5:0.5 F5:1 | "
            "r:0.5 F5:0.5 A5:0.5 C6:0.5 A5:1 G5:1 | E5:1 G5:0.5 E5:0.5 C5:1 D5:1 | E5:0.75 F5:0.25 E5:0.5 D5:0.5 A4:1 C5:1 | D5:3 r:1")
    melA = ("A5:1 G5:0.5 E5:0.5 C5:1 E5:1 | D5:1.5 E5:0.5 G5:1 B4:1 | C5:0.5 D5:0.5 F5:1 A5:1 E5:1 | G5:2 r:2 | "
            "A5:0.5 C6:0.5 A5:0.5 G5:0.5 E5:1 G5:1 | B5:1 A5:0.5 G5:0.5 E5:1 D5:1 | F5:1 E5:0.5 D5:0.5 C5:1 A4:1 | B4:1 C5:1 r:2")
    ny = lambda f, d, p: nylon(f, d)  # noqa: E731
    sl = lambda f, d, p: sine_lead(f, d)  # noqa: E731
    s.melody(8, melB, ny, gain=1.0, pan=0.12, rev=0.3, dly=0.18)
    s.melody(16, melA, sl, gain=1.05, pan=-0.05, rev=0.35, dly=0.2)
    s.melody(16, melA, ny, gain=0.3, pan=0.25, rev=0.3, oct_=-1)
    s.dly_beats = 0.75
    s.rev_dur, s.rev_decay, s.rev_mix = 2.0, 0.55, 0.5

    def post(mix):
        # the tape: a gentle low-pass, a dip in the low mids, soft saturation
        m = dsp.lp(mix, 9500)
        m = m / (np.max(np.abs(m)) + 1e-9) * 0.8
        return np.tanh(m * 1.4) / 1.4

    s.post = post
    return s


TRACKS = {
    # name: (song, LUFS, opus rate, aac rate) -- the same loudness as the default soundtrack
    "chill": (chill, -17.0, "32k", "48k"),
    "arcade": (arcade, -17.0, "32k", "48k"),
    "chiptune": (chiptune, -17.0, "32k", "48k"),
    "lofi": (lofi, -17.0, "32k", "48k"),
}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--wav", default=None)
    a = ap.parse_args()
    only = set(x for x in a.only.split(",") if x)
    manifest_path = os.path.join(M.OUT, "music.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for name, (fn, I, orate, arate) in TRACKS.items():
        if only and name not in only:
            continue
        song = fn()
        mix, L = M.render(song)
        M.master(mix, L, name, a.wav, I, orate, arate)
        manifest[name] = {"loop": round(L / SR, 6), "pad": M.PAD, "bpm": song.bpm, "bars": song.bars}
    json.dump(manifest, open(manifest_path, "w"), indent=2)
    open(manifest_path, "a").write("\n")
