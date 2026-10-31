"""The voice's post chain: what turns a clean synthetic read (or a home recording) into a voice in
a room. Python (numpy) for the timing and the breaths, ffmpeg for the processing.

TTS takes (full chain):
  1. re-time      every pause the script made is nudged by up to +-12 % (seeded), so the
                  rhythm stops being metronomic; a line's start moves by up to +-40 ms in the mix
  2. breaths      a soft inhale before a phrase that follows a pause of 0.32 s or more (and
                  before the first phrase), 18-24 dB under the speech, ending 40-90 ms before the
                  onset, the way an editor leaves them
  3. drift        a slow random pitch/tempo drift of a few cents (0.15-0.5 Hz), the
                  micro-instability no synthetic voice has
  4. EQ           high-pass 75 Hz, a little chest (low shelf 160 Hz), less box (320 Hz), a touch
                  of presence (3 kHz), the synthetic fizz tamed (6.8 kHz), a soft air shelf
  5. de-ess       ffmpeg deesser
  6. compress     2.5:1 from -20 dB, 8 ms / 160 ms, soft knee
  7. room         a small synthetic room (0.35 s, early reflections) at about -20 dB wet
  8. level        every line to the same loudness; the mixer sets the stem to -16 LUFS with
                  true peak <= -1 dBTP and lays continuous room tone under it
Human recordings (light chain): high-pass 70 Hz, a gentle FFT denoise (6 dB), a small mud cut,
a lighter de-ess and 2:1 compression, no room unless asked; no breaths, drift or re-timing (a
person brings their own).
"""
import os
import tempfile

import numpy as np

import dsp
from dsp import SR

TTS_CHAIN = (
    "highpass=f=75:p=2,"
    "lowshelf=f=160:g=1.5,"
    "equalizer=f=320:t=q:w=1.0:g=-1.5,"
    "equalizer=f=3000:t=q:w=1.2:g=1.2,"
    "equalizer=f=6800:t=q:w=1.6:g=-1.5,"
    "highshelf=f=11000:g=1.0,"
    "deesser=i=0.35:m=0.5:f=0.5:s=o,"
    "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:knee=4:makeup=2"
)
HUMAN_CHAIN = (
    "highpass=f=70:p=2,"
    "afftdn=nr=6:nf=-55,"
    "equalizer=f=300:t=q:w=1.0:g=-1,"
    "deesser=i=0.2:m=0.4:f=0.5:s=o,"
    "acompressor=threshold=-22dB:ratio=2:attack=10:release=200:knee=6:makeup=1.5"
)


def room_ir(path, seed=5):
    """A small, slightly damped room: early reflections then a 70 ms diffuse tail (stereo)."""
    r = np.random.default_rng(seed)
    t = np.arange(int(0.36 * SR)) / SR
    ir = r.standard_normal((2, len(t))) * np.exp(-t / 0.07)
    ir = dsp.lp(ir, 5200)
    for d, g in ((0.006, 0.45), (0.011, 0.32), (0.017, 0.24), (0.026, 0.15)):
        ir[0, int(d * SR)] += g
        ir[1, int((d + 0.0013) * SR)] += g * 0.9
    ir[:, : int(0.004 * SR)] = 0
    ir /= np.max(np.abs(ir))
    dsp.write_wav(path, ir.astype(np.float32))
    return path


# ───────────────────────── humanising (numpy) ─────────────────────────
def retime(x, layout, rng, jitter=0.12, sr=SR):
    """Rebuild a take from its layout with every pause nudged by up to +-jitter."""
    out, lay, t = [], [], 0.0
    for s in layout:
        if s["kind"] == "speech":
            seg = x[int(s["t0"] * sr): int(s["t1"] * sr)]
            out.append(seg)
            lay.append({"kind": "speech", "t0": t, "t1": t + len(seg) / sr})
            t += len(seg) / sr
        else:
            d = (s["t1"] - s["t0"]) * (1 + rng.uniform(-jitter, jitter))
            d = max(0.09, d)
            out.append(np.zeros(int(d * sr)))
            lay.append({"kind": "pause", "t0": t, "t1": t + d})
            t += d
    return np.concatenate(out), lay


def breath(dur, rng, sr=SR):
    """An inhale through a half-open mouth: noise shaped by two soft resonances, a swelling
    envelope that releases quickly, a faint low rush. Peak-normalised."""
    n = int(dur * sr)
    w = rng.standard_normal(n)
    x = dsp.bp(w, 300, 3600)
    x = dsp.eq(x, ("peak", rng.uniform(950, 1300), 5.0, 2.0), ("peak", rng.uniform(2100, 2600), 3.0, 2.5))
    x += dsp.lp(rng.standard_normal(n), 400) * 0.25
    t = np.linspace(0, 1, n)
    k = rng.uniform(0.55, 0.7)
    up = np.sin(np.pi / 2 * np.clip(t / k, 0, 1)) ** 1.6
    down = np.cos(np.pi / 2 * np.clip((t - k) / (1 - k), 0, 1)) ** 1.2
    env = np.where(t < k, up, down)
    y = x * env
    return y / max(1e-9, np.max(np.abs(y)))


def add_breaths(x, layout, rng, level_db=-21.0, min_pause=0.32, lead_in=True, sr=SR):
    """Breaths into the pauses before phrases. Returns (audio, lead seconds added at the front)."""
    speech = np.concatenate([x[int(s["t0"] * sr): int(s["t1"] * sr)] for s in layout if s["kind"] == "speech"])
    ref = np.sqrt(np.mean(speech[np.abs(speech) > 0.01] ** 2)) if np.any(np.abs(speech) > 0.01) else 0.1
    peak_for = lambda: ref * 10 ** ((level_db + rng.uniform(-3, 2)) / 20) * 2.8  # noise crest ~ 2.8
    lead = 0.0
    if lead_in:
        d = rng.uniform(0.26, 0.36)
        gap = rng.uniform(0.05, 0.09)
        lead = d + gap
        x = np.concatenate([np.zeros(int(lead * sr)), x])
        x[: int(d * sr)] += breath(d, rng) * peak_for() * 0.85
        layout = [{**s, "t0": s["t0"] + lead, "t1": s["t1"] + lead} for s in layout]
    for i, s in enumerate(layout):
        if s["kind"] != "pause":
            continue
        p = s["t1"] - s["t0"]
        if p < min_pause:
            continue
        if rng.uniform() > (0.9 if p >= 0.5 else 0.65):
            continue
        gap = rng.uniform(0.04, 0.09)
        d = min(0.34, p - gap - 0.08)
        if d < 0.16:
            continue
        a = int((s["t1"] - gap - d) * sr)
        b = breath(d, rng) * peak_for()
        x[a:a + len(b)] += b[: len(x) - a]
    return x, lead


def drift(x, cents=5.0, rng=None, sr=SR):
    """Slow pitch/tempo drift: a varispeed read whose rate wanders by +-cents."""
    if cents <= 0:
        return x
    rng = rng or np.random.default_rng(0)
    t = np.arange(len(x)) / sr
    c = sum(np.sin(2 * np.pi * rng.uniform(0.15, 0.5) * t + rng.uniform(0, 6.3)) * rng.uniform(0.5, 1) for _ in range(3))
    c = c / max(1e-9, np.max(np.abs(c))) * cents
    ratio = 2 ** (c / 1200)
    pos = np.cumsum(ratio) - ratio[0]
    pos = pos[pos < len(x) - 1]
    return np.interp(pos, np.arange(len(x)), x)


# ───────────────────────── processing (ffmpeg) ─────────────────────────
def chain(x, mono_chain, room_wet, ir_path, work):
    """mono (n,) at SR -> stereo (2, n) through the ffmpeg chain and the room."""
    src = os.path.join(work, "pre.wav")
    dst = os.path.join(work, "post.wav")
    dsp.write_wav(src, x.astype(np.float32))
    if room_wet > 0:
        fc = (f"[0:a]{mono_chain},pan=stereo|c0=c0|c1=c0,asplit[d][w];[w][1:a]afir=dry=1:wet=1[r];"
              f"[d][r]amix=inputs=2:weights='1 {room_wet}':normalize=0[o]")
        dsp.ff_chain(src, dst, fc=fc, extra_inputs=[ir_path])
    else:
        dsp.ff_chain(src, dst, af=f"{mono_chain},pan=stereo|c0=c0|c1=c0")
    y = dsp.read_audio(dst, ch=2)
    return y


def level(y, target=-19.0):
    """One line to a common loudness (integrated, or the short-term max for very short lines)."""
    m = dsp.lufs_of(y)
    L = m["I"] if np.isfinite(m["I"]) and m["I"] > -60 else m["S_max"]
    if not np.isfinite(L):
        return y
    return y * 10 ** ((target - L) / 20)


def process_tts(x, layout, seed, ir_path, opts=None):
    """A TTS take (48 kHz mono, its layout) -> (stereo line, lead seconds before the first word)."""
    o = {"jitter": 0.12, "breaths": True, "breath_db": -21.0, "drift_cents": 5.0, "room": 0.1}
    o.update(opts or {})
    rng = np.random.default_rng(seed)
    x, lay = retime(x, layout, rng, o["jitter"])
    lead = 0.0
    if o["breaths"]:
        x, lead = add_breaths(x, lay, rng, o["breath_db"])
    x = drift(x, o["drift_cents"], rng)
    with tempfile.TemporaryDirectory() as d:
        y = chain(x, TTS_CHAIN, o["room"], ir_path, d)
    return level(y), lead


def speech_threshold(e, thr_db=-30):
    """Frame-energy threshold between speech and room: thr_db under the loud frames (95th
    percentile), and never less than 10 dB over the room's own floor (10th percentile)."""
    lo, hi = np.percentile(e, 10), np.percentile(e, 95)
    return max(hi * 10 ** (thr_db / 20), lo * 10 ** (10 / 20))


def onset(x, thr_db=-30, sr=SR):
    m = np.abs(x).max(0) if x.ndim == 2 else np.abs(x)
    hop = int(0.01 * sr)
    nb = len(m) // hop
    e = np.sqrt((m[: nb * hop].reshape(nb, hop) ** 2).mean(1))
    on = np.nonzero(e > speech_threshold(e, thr_db))[0]
    if not len(on):
        return 0, len(m)
    return on[0] * hop, (on[-1] + 1) * hop


def process_human(x, ir_path, room=0.0, preroll=0.35, postroll=0.3, trim=True):
    """A human line (mono, 48 kHz) -> (stereo line, lead seconds before the first word). Keeps
    `preroll` s before the first word (so the real breath stays) and `postroll` after the last."""
    lead = 0.0
    if trim:
        a, b = onset(x)
        a0 = max(0, a - int(preroll * SR))
        lead = (a - a0) / SR
        x = x[a0: min(len(x), b + int(postroll * SR))]
        x = dsp.fade(x, 0.02, 0.05)
    with tempfile.TemporaryDirectory() as d:
        y = chain(x, HUMAN_CHAIN, room, ir_path, d)
    return level(y), lead


def split_by_silence(x, n_expected, min_gap=0.9, thr_db=-30, sr=SR):
    """One continuous read -> n line segments, cut in the middle of the silences of min_gap s or
    more. Returns [(i0, i1), ...] or raises if the count does not match."""
    hop = int(0.02 * sr)
    nb = len(x) // hop
    e = np.sqrt((x[: nb * hop].reshape(nb, hop) ** 2).mean(1))
    loud = e > speech_threshold(e, thr_db)
    gaps, i = [], 0
    while i < nb:
        if not loud[i]:
            j = i
            while j < nb and not loud[j]:
                j += 1
            if i > 0 and j < nb and (j - i) * hop >= min_gap * sr:
                gaps.append(((i + j) // 2) * hop)
            i = j
        else:
            i += 1
    cuts = [0] + gaps + [len(x)]
    segs = [(cuts[k], cuts[k + 1]) for k in range(len(cuts) - 1)]
    if len(segs) != n_expected:
        raise SystemExit(f"vo-human.wav: found {len(segs)} takes separated by >= {min_gap}s of silence, the script has "
                         f"{n_expected} lines. Leave a clear 1.5 s between lines, pass --human-gap, or record one file per line "
                         f"(vo-human/<id>.wav).")
    return segs


# ───────────────────────── a stand-in voice ─────────────────────────
def babble(sentences, speed=1.0, seed=0, f0=185.0, sr=SR):
    """A placeholder read (no words): a formant-synthesised murmur with the script's timing
    (about 2.7 words a second, the marks' pauses), syllable envelopes, a falling pitch per
    sentence and a few sibilants, so timing, ducking and the post chain can be checked before
    any TTS is installed. Returns (audio at SR, layout)."""
    rng = np.random.default_rng(seed)
    out, lay, t = [], [], 0.0
    vowels = [(730, 1090, 2440), (530, 1840, 2480), (270, 2290, 3010), (570, 840, 2410), (440, 1020, 2240), (660, 1720, 2410)]
    for si, s in enumerate(sentences):
        words = max(1, len(s["text"].split()))
        dur = words / 2.7 / speed + 0.05 * len(s["gaps"])
        n = int(dur * sr)
        tt = np.arange(n) / sr
        contour = f0 * (1.08 - 0.2 * tt / dur) * (1 + 0.05 * np.sin(2 * np.pi * rng.uniform(1.5, 3) * tt))
        ph = 2 * np.pi * np.cumsum(contour) / sr
        src = sum(np.sin(k * ph) / k ** 1.1 for k in range(1, 22))
        syl = int(dur * 4.6)
        env = np.zeros(n)
        bounds = np.sort(rng.uniform(0, n, syl - 1).astype(int)) if syl > 1 else np.array([], int)
        edges = np.concatenate([[0], bounds, [n]])
        win = 1024
        hop = win // 4
        pad = np.concatenate([np.zeros(win), src, np.zeros(win)])
        y = np.zeros(len(pad))
        norm = np.zeros(len(pad))
        w = np.hanning(win)
        fr = np.fft.rfftfreq(win, 1 / sr)
        seg_vowel = rng.integers(0, len(vowels), len(edges))
        for i in range(0, len(pad) - win, hop):
            k = np.searchsorted(edges, i - win / 2, side="right") - 1
            F = vowels[seg_vowel[max(0, min(k, len(seg_vowel) - 1))]]
            H = sum(1 / (1 + ((fr - f) / (60 + 0.06 * f)) ** 2) * g for f, g in zip(F, (1.0, 0.6, 0.3))) + 0.01
            y[i:i + win] += np.fft.irfft(np.fft.rfft(pad[i:i + win] * w) * H, win) * w
            norm[i:i + win] += w * w
        y = (y / np.maximum(norm, 1e-6))[win:win + n]
        for a, b in zip(edges[:-1], edges[1:]):
            if b - a > 10:
                env[a:b] = np.sin(np.pi * np.linspace(0, 1, b - a)) ** 0.7
        y *= env
        for _ in range(max(1, words // 4)):  # a few "s" sounds for the de-esser
            m = int(0.08 * sr)
            a = int(rng.uniform(0.1, 0.9) * max(1, n - m))
            y[a:a + m] += dsp.hp(rng.standard_normal(m), 4500) * np.hanning(m) * 0.25 * np.max(np.abs(y))
        y = dsp.fade(y / max(1e-9, np.max(np.abs(y))) * 0.5, 0.01, 0.03)
        lay.append({"kind": "speech", "t0": t, "t1": t + n / sr})
        out.append(y)
        t += n / sr
        if si < len(sentences) - 1:
            out.append(np.zeros(int(s["after"] * sr)))
            lay.append({"kind": "pause", "t0": t, "t1": t + s["after"]})
            t += s["after"]
    return np.concatenate(out), lay
