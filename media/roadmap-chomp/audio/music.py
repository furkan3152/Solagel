"""Score for Roadmap Chomp: 120 BPM (a beat is 0.5 s, downbeats on the even seconds), clean and
minimal, synthesised with the promo's instruments (media/promo/audio/music.py).

  0.0  pellets pop in over a soft pad and a pluck motif
  2.0  the kick enters (the waka runs on the eighths); 4.0 / 6.0 / 8.0 each chomp lands on a downbeat
       with a crash, the groove adds a layer each time the coin grows
  8.0  a one-bar build (snare roll, riser) into the big bite on 9.0, then the closing card on 10.0:
       the sting, a held chord and an airy tail to 14.0

  python music.py OUT.wav
"""
import json
import os
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "promo", "audio"))
import music as M  # noqa: E402

SR = M.SR
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
DUR = TL["duration"] + 0.5
N = int(DUR * SR)
BEAT, BAR = 0.5, 2.0
PROG = M.PROG
place = M.place


def build():
    drums, bass, keys, lead, fx = (np.zeros((2, N)) for _ in range(5))
    motif = [72, 76, 79, 76, 74, 77, 81, 77]
    # the pad under everything up to the card
    for b in range(5):
        place(keys, M.pad(PROG[b % 4][0], 2.0, 0.55, 900 + b * 250), b * BAR, 0.5)
    # pluck motif on the eighths (the waka's grid)
    for i in range(int(10.0 / 0.25)):
        t = i * 0.25
        if t >= 8.0:
            break
        ch = PROG[int(t // BAR) % 4][0]
        m = motif[i % 8] - (0 if (i // 8) % 2 == 0 else 2)
        place(lead, M.pluck(m, 0.55 if i % 2 == 0 else 0.35), t, 1.0, -0.3 + 0.6 * (i % 2))
    for bi in range(int(10.0 / BEAT)):
        t = bi * BEAT
        bib = bi % 4
        ch, root = PROG[int(t // BAR) % 4]
        layer = 0 if t < 2 else 1 if t < 4 else 2 if t < 6 else 3
        if t >= 9.0:
            continue
        if layer >= 1:
            place(drums, M.kick(0.95), t)
        if layer >= 1 and bib in (1, 3):
            place(drums, M.clap(0.7), t, 1.0, 0.05)
        if layer >= 2:
            for s in range(2):
                place(drums, M.hat(False, 0.35 if s == 0 else 0.22), t + s * 0.25, 1.0, 0.3)
        else:
            place(drums, M.hat(False, 0.18), t + 0.25, 1.0, 0.3)
        if layer >= 1:
            place(bass, M.bass_note(root, 0.22, 0.9), t)
            place(bass, M.bass_note(root + 12, 0.12, 0.45), t + 0.25)
        if layer >= 3:
            place(keys, M.chord_stab(ch, 0.12, 0.7, 2600), t + 0.25)
    # each chomp: a crash and a bell on the downbeat
    for i, t in enumerate((4.0, 6.0, 8.0)):
        place(drums, M.crash(0.5 + i * 0.12, 1.4), t, 1.0, 0.2 - i * 0.2)
        place(lead, M.bell(79 + [0, 2, 5][i], 0.9, 0.6), t, 1.0, 0.0)
    # build into the big bite
    for k in range(8):
        place(drums, M.clap(0.2 + k * 0.08), 8.0 + k * 0.125, 1.0, (k % 2) * 0.3 - 0.15)
    place(fx, M.noise_riser(0.95, 0.9, 400, 10000), 8.02)
    place(drums, M.impact(1.0), 9.0)
    place(drums, M.crash(0.9, 2.0), 9.0, 1.0, -0.15)
    place(keys, M.pad(PROG[3][0], 1.0, 0.6, 1600), 9.0, 0.6)
    # the closing card
    place(drums, M.kick(1.0), 10.0)
    place(drums, M.crash(0.7, 2.6), 10.0)
    for i, m in enumerate([65, 69, 72, 76, 79]):
        place(lead, M.bell(m, 2.6, 0.75), 10.0 + i * 0.04, 1.0, -0.4 + i * 0.2)
    place(keys, M.chord_stab(PROG[0][0], 1.2, 0.9, 2400), 10.0)
    place(bass, M.bass_note(41, 1.4, 1.0), 10.0)
    place(keys, M.pad(PROG[0][0] + [72], 4.0, 0.55, 1400), 10.0, 0.5)
    for k in range(12):
        place(lead, M.pluck(motif[k % 8] + 12, 0.18 - k * 0.012), 10.5 + k * 0.25, 1.0, -0.3 + 0.6 * (k % 2))
    return drums, bass, keys, lead, fx


def main():
    out = sys.argv[1]
    drums, bass, keys, lead, fx = build()
    ir_l, ir_r = M.reverb_ir(seed=7), M.reverb_ir(seed=8)

    def verb(x, wet):
        l = signal.fftconvolve(x[0], ir_l)[: x.shape[1]]
        r = signal.fftconvolve(x[1], ir_r)[: x.shape[1]]
        return x + wet * np.stack([l, r])

    keys, lead = verb(keys, 0.3), verb(lead, 0.4)
    drums = drums + 0.08 * np.stack([signal.fftconvolve(drums[0], ir_l)[:N], signal.fftconvolve(drums[1], ir_r)[:N]])
    mix = drums * 0.9 + bass * 0.85 + keys + lead + fx * 0.7
    mix = M.hp(mix, 30, 2)
    mix = M.biquad(mix, "peak", 300, -3.0, 0.7)
    mix = M.biquad(mix, "highshelf", 5000, 2.0, 0.7)
    # the breath before the big bite
    i0, i1, fade = int(8.9 * SR), int(9.0 * SR), int(0.015 * SR)
    mix[:, i0 - fade:i0] *= np.linspace(1, 10 ** (-30 / 20), fade)
    mix[:, i0:i1] *= 10 ** (-30 / 20)
    f0 = int((TL["duration"] - 1.5) * SR)
    mix[:, f0:] *= np.linspace(1, 0, N - f0) ** 1.5
    mix = np.tanh(mix * 0.9) / 0.9
    mix *= 10 ** (-3 / 20) / np.max(np.abs(mix))
    import soundfile as sf
    sf.write(out, mix.T.astype(np.float32), SR, subtype="FLOAT")
    print("music written", out, round(N / SR, 2), "s")


if __name__ == "__main__":
    main()
