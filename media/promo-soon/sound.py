#!/usr/bin/env python3
"""Sound design + mix for the Elymum SOON promo (all procedural, numpy; no samples).

Reuses the gameplay film's DSP kit (media/gameplay-film/audio/dsp.py, sfx.py: whoosh, thump, chomp,
bell) and adds the creature's boings and footsteps, a sneaky pizzicato walk, a tension riser, the
bite impact (crunch + sub drop + crack), coin jingles, a burp and a playful SOON sting.
Her voice is ducked a little only where effects overlap it. Output is loudness-normalised to
-14 LUFS with a true-peak ceiling of -1 dBTP.

  python3 sound.py SRC WORKDIR    -> WORKDIR/mix.wav (48 kHz stereo float), WORKDIR/sfx_only.wav
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gameplay-film', 'audio'))
import dsp  # noqa: E402
import sfx as kit  # noqa: E402
from dsp import SR, bp, hp, lp, place, t_  # noqa: E402

CUES = json.load(open(os.environ.get('PROMO_CUES') or os.path.join(HERE, 'cues.json')))
M, CARD = CUES['monster'], CUES['card']
DUR = CUES['duration']
rng = np.random.default_rng(11)


def norm(x, peak=0.7):
    return x / max(1e-9, np.max(np.abs(x))) * peak


def boing(f0=220, f1=520, dur=0.32, wob=11.0):
    """Spring boing: a pitch glide with a wobbling vibrato and a twangy upper partial."""
    t = t_(dur)
    f = f0 + (f1 - f0) * (1 - np.exp(-t / 0.05))
    f = f * (1 + 0.09 * np.sin(2 * np.pi * wob * t) * np.exp(-t / 0.18))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.35 * np.sin(2 * ph + 0.3) + 0.12 * np.sin(3 * ph)
    env = np.minimum(1, t / 0.004) * np.exp(-t / (dur * 0.38))
    return norm(x * env, 0.6)


def footstep(size=1.0, seed=0):
    """Cartoon footstep: a rubbery 'bonk' (woodblock-ish) over a soft body thump."""
    r = np.random.default_rng(seed)
    t = t_(0.18)
    f = (720 / size ** 0.5) * (1 + 0.25 * np.exp(-t / 0.01))
    block = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)
    body = kit.thump(150 / size ** 0.3, 60, 0.22, 0.9)
    tap = bp(r.standard_normal(int(0.02 * SR)), 900, 4000) * np.exp(-t_(0.02) / 0.004) * 0.6
    x = np.zeros(int(0.25 * SR))
    x[:len(block)] += block * 0.55
    x[:len(body)] += body * min(1.2, 0.5 + 0.35 * size)
    x[:len(tap)] += tap
    return norm(np.tanh(x * 1.4), 0.7)


def pop(f=900):
    t = t_(0.09)
    fr = f * (1 + 1.2 * np.exp(-t / 0.008))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.025) * np.minimum(1, t / 0.001)
    return norm(x, 0.6)


def pluck(f, dur=0.5, bright=0.45, seed=0):
    return norm(dsp.ks_pluck(f, dur, bright=bright, damp=0.993, seed=seed), 0.6)


def marimba(f, dur=0.6):
    t = t_(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.22) + 0.25 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / 0.05)
    x += 0.1 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t / 0.012)
    return norm(x * np.minimum(1, t / 0.002), 0.6)


def glock(f, dur=1.2):
    t = t_(dur)
    x = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t / d) for k, a, d in ((1, 1, 0.5), (2.76, 0.4, 0.2), (5.4, 0.2, 0.08)))
    return norm(x * np.minimum(1, t / 0.001), 0.55)


def riser(dur):
    """Tension: a low drone that swells, a filtered noise rising, and a Shepard-ish tone climb."""
    t = t_(dur)
    u = t / dur
    drone = sum(np.sin(2 * np.pi * f * t + k) for k, f in enumerate((55, 55.6, 82.4, 110.3))) / 4
    drone *= (0.15 + 0.85 * u ** 1.6)
    n = rng.standard_normal(len(t))
    air = dsp.sweep(n, 300, 5200, 'bp', 2.2, 1.6) * u ** 2.2 * 0.9
    f = 180 * 2 ** (u * 1.6)
    tone = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR)) * u ** 2.6 * 0.35
    trem = 1 + 0.25 * np.sin(2 * np.pi * (4 + 10 * u) * t)
    x = (drone * 0.8 + air + tone) * trem
    x *= np.minimum(1, (dur - t) / 0.02)
    return norm(x, 0.6)


def impact():
    """The bite: crunchy jaw (kit.chomp), a cracking slap, a deep sub drop and a short room tail."""
    x = np.zeros(int(1.6 * SR))
    c = kit.chomp(seed=31)
    x[:len(c)] += c * 1.1
    t = t_(0.06)
    crack = hp(rng.standard_normal(len(t)), 1200) * np.exp(-t / 0.01) * 1.2
    x[:len(t)] += crack
    sub = kit.thump(95, 28, 1.1, 1.6)
    x[:len(sub)] += sub
    body = kit.thump(180, 60, 0.35, 0.8)
    x[:len(body)] += body
    x = np.tanh(x * 1.3)
    return norm(x, 0.95)


def burp():
    """A small, polite cartoon burp: a buzzy low glottal tone through two vowel formants."""
    dur = 0.36
    t = t_(dur)
    f = 95 + 25 * np.sin(np.pi * t / dur) + 6 * rng.standard_normal(len(t)).cumsum() / SR * 30
    ph = np.cumsum(f) / SR
    saw = 2 * (ph % 1) - 1
    v = bp(saw, 300, 900) + 0.6 * bp(saw, 1000, 1500)
    env = np.sin(np.pi * np.minimum(1, t / dur)) ** 0.6 * (1 + 0.3 * np.sin(2 * np.pi * 23 * t))
    return norm(v * env, 0.55)


def jingle(seed):
    r = np.random.default_rng(seed)
    out = np.zeros(int(0.5 * SR))
    for k in range(3):
        f = r.uniform(2400, 5200)
        t = t_(0.3)
        x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.7 * t)) * np.exp(-t / 0.06)
        i = int(k * 0.03 * SR)
        out[i:i + len(t)] += x
    return norm(out, 0.5)


def slide(_t=0.0, dur=0.32):
    """Slide-whistle 'uh-oh': two short notes falling, a little breathy."""
    t = t_(dur)
    f = np.where(t < 0.12, 880, 660) * (1 - 0.18 * np.clip((t - 0.12) / 0.2, 0, 1) * (t >= 0.12))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.08 * hp(rng.standard_normal(len(t)), 2000)
    env = np.minimum(1, t / 0.01) * np.where(t < 0.12, 1, 0.9) * np.clip((dur - t) / 0.08, 0, 1)
    env *= 1 - 0.8 * np.exp(-((t - 0.12) / 0.012) ** 2)
    return norm(x * env, 0.5)


def mtof(m):
    return 440 * 2 ** ((m - 69) / 12)


def build_sfx():
    buf = np.zeros((2, int((DUR + 0.5) * SR)))
    duck = []  # (t0, t1) ranges where her voice should sit down a little
    # corner bug pop + caption pops on the key words (very light)
    place(buf, pop(1100), 0.47, 0.18, -0.5)
    for c in CUES['captions']:
        for w in c['words']:
            if len(w) > 2 and w[2] == 'pop' and w[1] < M['enter']:
                place(buf, pop(1400), w[1], 0.10, 0.2)
                place(buf, glock(mtof(84), 0.4), w[1] + 0.01, 0.045, 0.2)
    # the creature: peek boing, hops (boing on take-off, bonk on landing), a sneaky pizzicato walk
    hops = M['hops'] + M.get('postHops', [])
    walk = [43, 46, 48, 50, 51, 53, 55]  # G2 Bb2 C3 D3 Eb3 F3 G3 (a minor-ish sneak)
    for k, h in enumerate(hops):
        s = h['size'] / 200
        place(buf, boing(260 / s ** 0.5, 560 / s ** 0.4, 0.34), h['t'], 0.26, (h['x'] - 0.5) * 1.3)
        place(buf, footstep(s, seed=k), h['land'], 0.42 + 0.06 * k, (h['x'] - 0.5) * 1.3)
        place(buf, pluck(mtof(walk[k]), 0.6, 0.35, seed=k), h['land'], 0.32, -0.2)
        place(buf, pluck(mtof(walk[k] + 12), 0.4, 0.5, seed=k + 9), h['land'] + 0.18, 0.14, 0.2)
        duck.append((h['t'] - 0.05, h['land'] + 0.3))
    # the hop up onto her fingertip, a tiny landing plink, then the 'uh-oh' slide when the finger drops
    P = M['perch']
    side = 0.3 if M.get('from', -0.14) > 0.5 else -0.3
    place(buf, boing(300, 760, 0.36, 13), P['jump'], 0.24, side)
    place(buf, marimba(mtof(83), 0.4), P['land'], 0.2, side)
    place(buf, pop(1500), P['land'], 0.12, side)
    place(buf, slide(P['leave'] + 0.02), P['leave'] + 0.02, 0.2, side)
    duck.append((P['jump'] - 0.05, P['land'] + 0.2))
    # rising tension from the second stop to the leap
    r0, r1 = 15.0, M['jaws']
    place(buf, riser(r1 - r0), r0, 0.30, 0.0)
    duck.append((M['open'] - 0.1, M['impact']))
    # "!" ding when it opens up, then the leap whoosh and the jaw whoosh
    place(buf, glock(mtof(88), 0.9), M['open'], 0.22, 0.3)
    place(buf, pop(700), M['open'], 0.2, 0.3)
    place(buf, kit.whoosh(0.42, up=True, pan=-0.2, seed=3), M['lunge'] - 0.08, 0.5)
    place(buf, boing(180, 380, 0.3, 14), M['lunge'], 0.22, 0)
    place(buf, kit.whoosh(0.3, up=False, pan=0.0, seed=8), M['jaws'] - 0.06, 0.55)
    # THE BITE
    place(buf, impact(), M['impact'] - 0.015, 1.0, 0.0)
    # gulp, coins jingling out, burp on the card
    place(buf, kit.chomp(small=True, seed=5), M['impact'] + 0.22, 0.25, 0.1)
    for k in range(9):
        place(buf, jingle(40 + k), M['impact'] + 0.06 + k * 0.07, 0.11, float(np.sin(k * 2.1)) * 0.7)
    if CARD.get('burp', True):
        place(buf, burp(), CARD['soon'] + 1.02, 0.45, 0.35)
    # SOON sting: letters land on rising marimba notes, then a bright pluck chord + glock sparkle
    for i, m in enumerate((72, 76, 79, 84)):
        place(buf, marimba(mtof(m), 0.7), CARD['soon'] + 0.12 + i * 0.06, 0.38, -0.3 + 0.2 * i)
    place(buf, boing(300, 620, 0.4), CARD['soon'] + 0.4, 0.2, 0.4)  # creature pops up
    chord_t = CARD['soon'] + 0.42
    for i, m in enumerate((48, 55, 60, 64, 67, 72, 76)):
        place(buf, pluck(mtof(m), 2.2, 0.55, seed=20 + i), chord_t + i * 0.018, 0.22, -0.4 + 0.13 * i)
    for i, m in enumerate((84, 88, 91, 96)):
        place(buf, glock(mtof(m), 1.4), chord_t + 0.1 + i * 0.09, 0.12, 0.5 - 0.3 * i)
    place(buf, kit.thump(70, 38, 0.6, 1.0), chord_t, 0.35)
    place(buf, pop(1000), CARD['wordmark'] + 0.05, 0.22, -0.2)
    place(buf, kit.tick(), CARD['handle'] + 0.05, 0.25, 0.2)
    # a final little two-note "ta-da" button
    if not CARD.get('short'):
        place(buf, marimba(mtof(79), 0.5), 22.15, 0.3, -0.1)
        for i, m in enumerate((60, 67, 72, 76, 84)):
            place(buf, pluck(mtof(m), 1.6, 0.5, seed=60 + i), 22.35 + i * 0.012, 0.2, -0.3 + 0.15 * i)
        place(buf, glock(mtof(96), 1.4), 22.37, 0.12, 0.3)
    # a soft reverb send so everything sits in one space
    irs = [dsp.reverb_ir(1.1, 0.4, seed=s, bright=6000) for s in (3, 4)]
    wet = np.stack([dsp.fftconv(buf[c], irs[c])[:buf.shape[1]] for c in (0, 1)])
    buf = buf + 0.12 * wet
    return buf, duck


def voice(src, start, end_t):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(start), '-i', src, '-t', str(end_t), '-ac', '2', '-ar', str(SR),
                        '-f', 'f32le', '-'], capture_output=True, check=True)
    v = np.frombuffer(p.stdout, np.float32).reshape(-1, 2).T.astype(np.float64)
    n = v.shape[1]
    t = np.arange(n) / SR
    g = np.ones(n)
    g *= np.clip(t / 0.25, 0, 1)  # soft in
    g *= np.clip((M['impact'] + 0.02 - t) / 0.06, 0, 1)  # cut with the bite
    return v * g


def true_peak_limit(x, ceiling_db=-1.2):
    """Gain-envelope limiter on a 4x oversampled peak estimate (look-ahead 2 ms, release 60 ms)."""
    c = 10 ** (ceiling_db / 20)
    up = np.max(np.abs(resample_poly(x, 4, 1, axis=1)), 0)
    peak = up.reshape(-1, 4).max(1) if len(up) % 4 == 0 else np.pad(up, (0, (-len(up)) % 4)).reshape(-1, 4).max(1)
    peak = peak[:x.shape[1]]
    need = np.minimum(1, c / np.maximum(peak, 1e-9))
    la = int(0.002 * SR)
    # look-ahead: running min over the next `la` samples
    from scipy.ndimage import minimum_filter1d
    need = minimum_filter1d(need, size=2 * la + 1, origin=0)
    g = np.empty_like(need)
    a_rel = np.exp(-1 / (0.06 * SR))
    cur = 1.0
    for i in range(len(need)):
        cur = need[i] if need[i] < cur else a_rel * cur + (1 - a_rel) * need[i]
        g[i] = cur
    return x * g


def main():
    src, work = sys.argv[1], sys.argv[2]
    import pyloudnorm as pyln
    sfx, duck = build_sfx()
    n = sfx.shape[1]
    v = voice(src, CUES['start'], DUR)
    vv = np.zeros((2, n))
    vv[:, :min(n, v.shape[1])] = v[:, :n]
    # duck the voice by ~3 dB where effects overlap (smooth 80 ms ramps)
    t = np.arange(n) / SR
    d = np.zeros(n)
    for a, b in duck:
        d = np.maximum(d, np.clip(np.minimum((t - a) / 0.08, (b - t) / 0.08), 0, 1))
    vv *= 10 ** (-3.0 * d / 20)
    # a gentle voice polish: low cut, a little presence, de-mud
    vv = dsp.eq(hp(vv, 80), ('peak', 300, -1.5, 1.0), ('peak', 3500, 1.5, 0.9))
    mix = vv + sfx * 0.9
    mix = mix[:, :int(DUR * SR)]
    tail = int(0.35 * SR)
    mix[:, -tail:] *= np.linspace(1, 0, tail) ** 2
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mix.T)
    mix *= 10 ** ((-14.0 - lufs) / 20)
    mix = true_peak_limit(mix, -2.6)
    lufs2 = meter.integrated_loudness(mix.T)
    mix *= 10 ** ((-14.0 - lufs2) / 20)
    mix = true_peak_limit(mix, -2.6)
    dsp.write_wav(os.path.join(work, 'mix.wav'), mix.astype(np.float32))
    dsp.write_wav(os.path.join(work, 'sfx_only.wav'), (sfx[:, :int(DUR * SR)] * 0.5).astype(np.float32))
    print('mix: in', round(lufs, 2), 'LUFS -> ', round(meter.integrated_loudness(mix.T), 2))


if __name__ == '__main__':
    main()
