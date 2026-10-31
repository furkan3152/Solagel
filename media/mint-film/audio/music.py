"""Score for the mint film: 120 BPM (a beat is 0.5 s), downbeats at 0.5 + 2k, synthesised with
the promo's instruments (media/promo/audio/music.py) and scored to the scenes in ../timeline.json.

  0.0  riser and a reverse crash into the $1 slam (0.5); MINT hits on the next beat
  0.5  bright groove (Fmaj7 / G6 / Em7 / Am7), stabs, bells on the card turns
  8.0  sweep down into the ink, 8.5 the roadmap: four on the floor, a bell per landing
 12.0  the leap: riser, breath, 12.5 drop into WL OPEN; 16.5 the sting, an airy tail to 19.5

  python music.py OUT.wav
"""
import json
import os
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "promo", "audio"))
import music as M  # noqa: E402  (the promo's instruments)

SR = M.SR
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
DUR = TL["duration"] + 1.0
N = int(DUR * SR)
BEAT, BAR, O = 0.5, 2.0, 0.5
PROG = M.PROG
place = M.place


def chord_at(t):
    return PROG[int(np.floor((t - O) / BAR + 1e-6)) % 4]


def groove(bufs, a, b, kick="full", hats=True, stabs=True, bells=False, shakers=False, cutoff=3000, open_hats=True):
    drums, bass, keys, lead = bufs
    sw = 0.025
    for bi in range(int(round((b - a) / BEAT))):
        tb = a + bi * BEAT
        bib = int(round((tb - O) / BEAT)) % 4
        ch, root = chord_at(tb + 0.01)
        if kick == "full":
            if bib in (0, 2):
                place(drums, M.kick(1.0), tb)
            if bib == 1:
                place(drums, M.kick(0.5), tb + BEAT * 0.75)
        elif kick == "four":
            place(drums, M.kick(0.95), tb)
        if bib in (1, 3):
            place(drums, M.clap(0.85), tb, 1.0, 0.05)
        if hats:
            for s in range(4):
                place(drums, M.hat(False, [0.5, 0.22, 0.38, 0.2][s]), tb + s * BEAT / 4 + (sw if s % 2 else 0), 1.0, 0.35)
        if open_hats:
            place(drums, M.hat(True, 0.3), tb + BEAT / 2 + sw, 1.0, -0.3)
        if shakers:
            place(drums, M.shaker(0.5), tb + BEAT * 0.25, 1.0, -0.45)
            place(drums, M.shaker(0.35), tb + BEAT * 0.75 + sw, 1.0, -0.45)
        pat = [(0, 0, 0.36), (0.5, 12, 0.18)] if bib != 3 else [(0, 0, 0.26), (0.5, 7, 0.18)]
        for off, iv, d in pat:
            place(bass, M.bass_note(root + iv, d, 0.95 if off == 0 else 0.6), tb + off * BEAT + (sw if off else 0))
        if stabs:
            place(keys, M.chord_stab(ch, 0.14, 0.85, cutoff), tb + BEAT / 2 + sw)
        if bells:
            arp = [0, 2, 1, 3]
            for s in range(2):
                m = ch[arp[(bi * 2 + s) % 4] % len(ch)] + 12
                place(lead, M.bell(m, 0.6, 0.6 if s == 0 else 0.4), tb + s * BEAT / 2 + (sw if s else 0), 1.0, 0.25 if s == 0 else -0.25)


def build():
    drums, bass, keys, lead, fx = (np.zeros((2, N)) for _ in range(5))
    bufs = (drums, bass, keys, lead)
    place(fx, M.vinyl(DUR, 0.5), 0)
    # pre-roll: the sealed card spins up
    place(fx, M.noise_riser(0.48, 0.9, 500, 9000), 0.02)
    place(fx, M.reverse_crash(0.45, 0.7), 0.05)
    place(keys, M.pad(PROG[0][0], 0.5, 0.6, 900), 0.0, 0.5)
    # 1 $1 MINT
    for t in (0.5, 1.0):
        place(drums, M.impact(1.0 if t == 0.5 else 0.8), t)
    place(drums, M.crash(0.9), 0.5, 1.0, 0.2)
    place(keys, M.pad(PROG[0][0], 2.0, 0.7, 1600), 0.5, 0.6)
    place(keys, M.pad(PROG[1][0], 2.0, 0.7, 1600), 2.5, 0.6)
    groove(bufs, 1.0, 4.5, cutoff=3000)
    for i, m in enumerate([72, 76, 79, 84]):
        place(lead, M.bell(m, 0.9, 0.6), 3.5 + i * 0.08, 1.0, -0.3 + i * 0.2)  # falls in love
    place(fx, M.reverse_crash(0.5, 0.8), 4.0)
    # 2 SEALED
    place(drums, M.crash(0.7), 4.5, 1.0, -0.2)
    groove(bufs, 4.5, 8.0, bells=False, shakers=True, cutoff=3400)
    for i, t in enumerate([6.0, 6.25, 6.5, 6.75, 7.0]):
        place(lead, M.bell(76 + [0, 3, 7, 10, 12][i], 0.8, 0.7), t, 1.0, -0.4 + i * 0.2)
    for k in range(4):
        place(keys, M.chord_stab(PROG[3][0], 0.09, 0.8 - k * 0.15, 1800 - k * 380), 8.0 + k * 0.125)
    place(fx, M.reverse_crash(0.5, 1.0), 8.0)
    # 3 ROADMAP
    place(drums, M.impact(0.9), 8.5)
    place(bass, M.sub_drone(3.5, 29, 0.6), 8.5)
    groove(bufs, 8.5, 12.0, kick="four", bells=True, cutoff=2600, open_hats=False)
    for t, m in ((9.5, 72), (10.5, 76), (11.5, 79)):
        place(lead, M.bell(m, 1.0, 0.9), t, 1.0, 0.0)
        place(lead, M.bell(m + 12, 0.7, 0.4), t + 0.02, 1.0, 0.3)
    place(fx, M.noise_riser(0.48, 1.1, 300, 12000), 12.0)
    # 4 WL OPEN
    place(drums, M.impact(1.1), 12.5)
    place(drums, M.crash(1.0), 12.5, 1.0, 0.15)
    place(keys, M.pad(PROG[0][0] + [72], 4.0, 0.8, 1800), 12.5, 0.7)
    groove(bufs, 12.5, 16.5, bells=True, shakers=True, cutoff=3200)
    # sting and tail
    place(drums, M.kick(1.0), 16.5)
    place(drums, M.crash(0.8, 2.6), 16.5)
    for i, m in enumerate([65, 69, 72, 76, 79]):
        place(lead, M.bell(m, 2.4, 0.8), 16.5 + i * 0.03, 1.0, -0.4 + i * 0.2)
    place(keys, M.chord_stab(PROG[0][0], 1.2, 1.0, 2400), 16.5)
    place(bass, M.bass_note(41, 1.2, 1.0), 16.5)
    place(keys, M.pad(PROG[0][0] + [72], 3.0, 0.5, 1400), 16.5, 0.5)
    for k in range(10):
        place(drums, M.hat(False, 0.25 - k * 0.02), 17.0 + k * 0.25, 1.0, 0.3)
    return drums, bass, keys, lead, fx


def main():
    out = sys.argv[1]
    drums, bass, keys, lead, fx = build()
    ir_l, ir_r = M.reverb_ir(seed=7), M.reverb_ir(seed=8)

    def verb(x, wet):
        l = signal.fftconvolve(x[0], ir_l)[: x.shape[1]]
        r = signal.fftconvolve(x[1], ir_r)[: x.shape[1]]
        return x + wet * np.stack([l, r])

    keys, lead = verb(keys, 0.35), verb(lead, 0.45)
    drums = drums + 0.12 * np.stack([signal.fftconvolve(drums[0], ir_l)[:N], signal.fftconvolve(drums[1], ir_r)[:N]])
    mix = drums * 0.9 + bass * 0.85 + keys + lead + fx * 0.8
    mix = M.hp(mix, 30, 2)
    mix = M.biquad(mix, "peak", 300, -3.5, 0.7)
    mix = M.biquad(mix, "highshelf", 4200, 3.0, 0.7)
    # the breath before the WL drop
    i0, i1, fade = int(12.38 * SR), int(12.5 * SR), int(0.02 * SR)
    mix[:, i0 - fade:i0] *= np.linspace(1, 10 ** (-34 / 20), fade)
    mix[:, i0:i1] *= 10 ** (-34 / 20)
    f0 = int((TL["duration"] - 1.2) * SR)
    mix[:, f0:] *= np.linspace(1, 0, N - f0) ** 1.5
    mix = np.tanh(mix * 0.9) / 0.9
    mix *= 10 ** (-3 / 20) / np.max(np.abs(mix))
    import soundfile as sf
    sf.write(out, mix.T.astype(np.float32), SR, subtype="FLOAT")
    print("music written", out, round(N / SR, 2), "s")


if __name__ == "__main__":
    main()
