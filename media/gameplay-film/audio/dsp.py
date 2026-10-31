"""Small DSP kit for the gameplay film's audio: numpy and the ffmpeg binary only (no scipy, no
soundfile), so music, sfx, the post chain and the mixer run on a bare python3 + numpy.

- wav I/O: float32 WAV written by hand, anything ffmpeg can open read back through a pipe
- filters: RBJ biquads (lp, hp, bp, peak, shelves) applied by FFT with the exact complex response
  (the same as running the IIR, minus the wrap-around, which the zero padding absorbs), Butterworth
  4th order as two biquads, a time-varying (STFT) band sweep
- fftconv, Karplus-Strong plucks (vectorised by delay-line blocks)
- ffmpeg helpers: run a filter chain, measure EBU R128 (integrated, LRA, true peak), astats
- normalise: gain to a LUFS target, then a 4x-oversampled limiter loop until true peak <= ceiling
"""
import json
import os
import re
import struct
import subprocess
import tempfile

import numpy as np

SR = 48000
FF = os.environ.get("FFMPEG", "ffmpeg")
FP = os.environ.get("FFPROBE", "ffprobe")


# ───────────────────────── wav I/O ─────────────────────────
def write_wav(path, x, sr=SR):
    """x: (n,) mono or (ch, n). Writes 32-bit float WAV (format tag 3)."""
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = x[None, :]
    ch, n = x.shape
    data = np.ascontiguousarray(x.T).tobytes()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + 26 + 12 + 8 + len(data)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<IHHIIHHH", 18, 3, ch, sr, sr * ch * 4, ch * 4, 32, 0))
        f.write(b"fact" + struct.pack("<II", 4, n))
        f.write(b"data" + struct.pack("<I", len(data)) + data)


def channels(path):
    r = subprocess.run([FP, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
                        "-of", "csv=p=0", path], capture_output=True, text=True, check=True)
    return int(r.stdout.strip().split(",")[0])


def read_audio(path, sr=SR, ch=None):
    """Any audio file -> float64 array (ch, n) at `sr` (ch: keep the file's, or force 1 or 2)."""
    c = ch or min(2, channels(path))
    r = subprocess.run([FF, "-v", "error", "-nostdin", "-i", path, "-f", "f32le", "-acodec", "pcm_f32le",
                        "-ac", str(c), "-ar", str(sr), "-"], capture_output=True, check=True)
    x = np.frombuffer(r.stdout, np.float32).astype(np.float64)
    return x.reshape(-1, c).T.copy()


def ff(args, check=True):
    return subprocess.run([FF, "-hide_banner", "-nostdin", "-y", *args], capture_output=True, text=True, check=check)


def ff_chain(src, dst, af=None, fc=None, extra_inputs=(), codec="pcm_f32le"):
    """Run an ffmpeg -af chain (or a -filter_complex graph whose output is [o])."""
    args = ["-i", src]
    for e in extra_inputs:
        args += ["-i", e]
    if fc:
        args += ["-filter_complex", fc, "-map", "[o]"]
    elif af:
        args += ["-af", af]
    ff(args + ["-c:a", codec, dst])


# ───────────────────────── measurement ─────────────────────────
def ebur128(path):
    """-> {'I': LUFS, 'LRA': LU, 'TP': dBTP (max over channels), 'S_max': short-term max}"""
    r = ff(["-v", "verbose", "-i", path, "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], check=False)
    err = r.stderr
    summ = err[err.rfind("Summary:"):]

    def grab(pat, s=summ):
        m = re.search(pat, s)
        return float(m.group(1)) if m else float("nan")

    st = [float(v) for v in re.findall(r"TARGET.*?S:\s*(-?[\d.]+|-inf)", err) if v != "-inf"]
    return {
        "I": grab(r"I:\s*(-?[\d.]+|-inf) LUFS"),
        "LRA": grab(r"LRA:\s*(-?[\d.]+) LU"),
        "TP": grab(r"Peak:\s*(-?[\d.]+|-inf) dBFS"),
        "S_max": max(st) if st else float("nan"),
    }


def astats(path):
    """Overall time-domain stats: peak, RMS, crest, DC, clipped samples (ffmpeg astats)."""
    r = ff(["-i", path, "-af", "astats=measure_perchannel=none", "-f", "null", "-"], check=False)
    out = {}
    for k in ("Peak level dB", "RMS level dB", "RMS peak dB", "DC offset", "Noise floor dB", "Number of NaNs"):
        m = re.findall(re.escape(k) + r":\s*(-?[\d.]+|-inf)", r.stderr)
        if m:
            v = m[-1]
            out[k] = float("-inf") if v == "-inf" else float(v)
    return out


def lufs_of(x, sr=SR):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "m.wav")
        write_wav(p, x, sr)
        return ebur128(p)


def band_balance(x, sr=SR):
    """Energy per octave band in dB relative to the loudest band (a quick 'spectrum balance')."""
    m = np.asarray(x).mean(0) if np.ndim(x) == 2 else np.asarray(x)
    edges = [20, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000]
    names = ["sub", "bass", "lowmid", "mid", "1k", "2k", "4k", "8k", "air", "top"]
    seg = int(sr * 4)
    if len(m) < seg:  # short sounds: one zero-padded frame
        m = np.concatenate([m, np.zeros(seg - len(m))])
    acc = np.zeros(len(names))
    w = np.hanning(seg)
    for i in range(0, max(1, len(m) - seg + 1), seg // 2):
        s = m[i:i + seg]
        if len(s) < seg:
            break
        P = np.abs(np.fft.rfft(s * w)) ** 2
        f = np.fft.rfftfreq(seg, 1 / sr)
        for k in range(len(names)):
            acc[k] += P[(f >= edges[k]) & (f < edges[k + 1])].sum()
    db = 10 * np.log10(acc + 1e-20)
    db -= db.max()
    return {n: round(float(v), 1) for n, v in zip(names, db)}


# ───────────────────────── filters ─────────────────────────
def biquad(kind, f0, q=0.7071, gain_db=0.0, sr=SR):
    """RBJ audio-EQ cookbook -> (b, a) normalised."""
    f0 = min(f0, sr * 0.49)
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    c, s = np.cos(w0), np.sin(w0)
    al = s / (2 * q)
    if kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "bp":
        b = [al, 0, -al]
        a = [1 + al, -2 * c, 1 - al]
    elif kind == "peak":
        b = [1 + al * A, -2 * c, 1 - al * A]
        a = [1 + al / A, -2 * c, 1 - al / A]
    elif kind in ("hs", "ls"):
        sq = 2 * np.sqrt(A) * al
        if kind == "hs":
            b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
            a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
        else:
            b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
            a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
    else:
        raise ValueError(kind)
    b, a = np.array(b, float), np.array(a, float)
    return b / a[0], a / a[0]


def response(sections, n, sr=SR):
    """Complex response of a biquad cascade at the rfft bins of an n-point FFT."""
    z = np.exp(-1j * 2 * np.pi * np.fft.rfftfreq(n, 1 / sr) / sr)
    H = np.ones(len(z), complex)
    for b, a in sections:
        H *= (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)
    return H


def _fast_len(n):
    m = 1
    while m < n:
        m *= 2
    # a smaller 3*2^k or 5*2^k when it fits
    for f in (3, 5):
        k = m // 2
        while k * f // 2 >= n and (k * f // 2) % 2 == 0:
            k //= 2
        if k * f >= n and k * f < m:
            m = k * f
    return m


def apply(x, sections, tail=0.25, sr=SR):
    """Filter along the last axis with a biquad cascade (FFT, causal response, `tail` s of padding)."""
    x = np.asarray(x, float)
    n = x.shape[-1]
    m = _fast_len(n + int(tail * sr))
    H = response(sections, m, sr)
    y = np.fft.irfft(np.fft.rfft(x, m, axis=-1) * H, m, axis=-1)
    return y[..., :n]


BW4 = (0.5412, 1.3066)  # Butterworth 4th order as two biquads


def lp(x, f, order=2):
    return apply(x, [biquad("lp", f, q) for q in (BW4 if order == 4 else (0.7071,))])


def hp(x, f, order=2):
    return apply(x, [biquad("hp", f, q) for q in (BW4 if order == 4 else (0.7071,))])


def bp(x, lo, hi, order=2):
    return apply(x, [biquad("hp", lo, q) for q in (BW4 if order == 4 else (0.7071,))] +
                 [biquad("lp", hi, q) for q in (BW4 if order == 4 else (0.7071,))])


def eq(x, *bands):
    """bands: ('peak'|'hs'|'ls', f, gain_db, q)"""
    return apply(x, [biquad(k, f, q, g) for k, f, g, q in bands])


def sweep(x, fc0, fc1, kind="bp", q=1.2, curve=1.0, win=2048):
    """Time-varying filter: STFT (Hann, 75 % overlap), each frame through the biquad magnitude at
    its own cutoff (exponential glide fc0 -> fc1, `curve` shapes the glide)."""
    x = np.asarray(x, float)
    n = len(x)
    hop = win // 4
    w = np.hanning(win)
    pad = np.concatenate([np.zeros(win), x, np.zeros(win)])
    out = np.zeros(len(pad))
    norm = np.zeros(len(pad))
    for i in range(0, len(pad) - win, hop):
        k = np.clip((i - win / 2) / max(1, n), 0, 1) ** curve
        fc = fc0 * (fc1 / fc0) ** k
        H = np.abs(response([biquad(kind, fc, q)], win))
        out[i:i + win] += np.fft.irfft(np.fft.rfft(pad[i:i + win] * w) * H, win) * w
        norm[i:i + win] += w * w
    return (out / np.maximum(norm, 1e-6))[win:win + n]


def fftconv(x, h):
    n = len(x) + len(h) - 1
    m = _fast_len(n)
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(h, m), m)[:n]


# ───────────────────────── synthesis helpers ─────────────────────────
def t_(dur, sr=SR):
    return np.arange(int(round(dur * sr))) / sr


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, x, at, gain=1.0, pan=0.0, sr=SR):
    """Mix mono (n,) or stereo (2, n) x into stereo buf at time `at` (constant-power pan for mono)."""
    i = int(round(at * sr))
    if x.ndim == 1:
        x = np.stack([x * np.cos((pan + 1) * np.pi / 4), x * np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
    if i < 0:
        x, i = x[:, -i:], 0
    if i >= buf.shape[1]:
        return
    n = min(x.shape[1], buf.shape[1] - i)
    buf[:, i:i + n] += x[:, :n] * gain


def adsr(n, a, d, s, r, hold=None, sr=SR):
    t = np.arange(n) / sr
    e = np.full(n, float(s))
    e[t < a] = t[t < a] / max(a, 1e-6)
    m = (t >= a) & (t < a + d)
    e[m] = 1 - (1 - s) * (t[m] - a) / max(d, 1e-6)
    rel = hold if hold is not None else n / sr - r
    m = t >= rel
    e[m] *= np.clip(1 - (t[m] - rel) / max(r, 1e-6), 0, 1)
    return e


def ks_pluck(f, dur, bright=0.5, damp=0.996, seed=0, sr=SR):
    """Karplus-Strong string, vectorised one delay line at a time. bright: 0 dark .. 1 bright."""
    rng = np.random.default_rng(seed)
    L = max(2, int(round(sr / f)))
    n = int(dur * sr)
    burst = rng.uniform(-1, 1, L)
    # darker excitation: a few passes of a 2-tap average
    for _ in range(int((1 - bright) * 6)):
        burst = 0.5 * (burst + np.roll(burst, 1))
    burst -= burst.mean()
    out = np.zeros(n + L + 1)
    out[:L] = burst
    s = 0.5 + 0.49 * bright  # loop filter blend: y[n] = damp*(s*y[n-L] + (1-s)*y[n-L-1])
    i = L
    while i < n + 1:
        j = min(i + L, n + 1)
        prev = out[i - L:j - L]
        prev2 = out[i - L - 1:j - L - 1] if i - L - 1 >= 0 else np.concatenate([[0.0], out[0:j - L - 1]])
        out[i:j] = damp * (s * prev + (1 - s) * prev2)
        i = j
    return out[:n]


def noise(dur, seed=0, sr=SR):
    return np.random.default_rng(seed).standard_normal(int(round(dur * sr)))


def pink(n, seed=0):
    """Pink-ish noise (1/f power) by spectral shaping."""
    w = np.random.default_rng(seed).standard_normal(n)
    W = np.fft.rfft(w)
    f = np.arange(len(W))
    f[0] = 1
    return np.fft.irfft(W / np.sqrt(f), n) * 30 / np.sqrt(n)


def reverb_ir(dur=2.0, decay=0.55, seed=7, bright=6500, predelay=0.012, sr=SR):
    """Synthetic diffuse tail, stereo-decorrelated by seed; unit energy."""
    r = np.random.default_rng(seed)
    t = t_(dur, sr)
    ir = r.standard_normal(len(t)) * np.exp(-t / decay)
    # high frequencies die faster: blend a darker copy in as the tail grows
    dark = lp(ir, bright * 0.35)
    k = np.clip(t / dur, 0, 1)
    ir = lp(ir, bright) * (1 - k) + dark * k
    p = int(predelay * sr)
    ir = np.concatenate([np.zeros(p), ir])
    ir[p:p + int(0.01 * sr)] *= np.linspace(0, 1, int(0.01 * sr))
    return ir / np.sqrt(np.sum(ir ** 2))


def fade(x, a=0.005, b=0.005, sr=SR):
    x = np.array(x, float)
    na, nb = int(a * sr), int(b * sr)
    if na:
        x[..., :na] *= np.linspace(0, 1, na)
    if nb:
        x[..., -nb:] *= np.linspace(1, 0, nb)
    return x


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def db(x):
    return 20 * np.log10(max(x, 1e-12))


# ───────────────────────── loudness targets ─────────────────────────
def normalise(src, dst, I=-16.0, TP=-1.0, LRA=None, tries=4, oversample=4):
    """Integrated loudness to I LUFS and true peak at or below TP dBTP: gain, then a look-ahead
    limiter run at `oversample`x the rate (so inter-sample peaks are caught), measured with
    ebur128's true-peak meter; the ceiling steps down until TP holds. Writes 24-bit PCM."""
    m = ebur128(src)
    gain = I - m["I"]
    ceiling = TP - 0.6
    work = dst + ".tmp.wav"
    for k in range(tries):
        lim = 10 ** (ceiling / 20)
        osr = SR * oversample
        af = (f"volume={gain:.3f}dB,aresample={osr}:resampler=soxr,"
              f"alimiter=limit={lim:.5f}:attack=1.5:release=60:asc=1:level=false:latency=1,"
              f"aresample={SR}:resampler=soxr")
        ff(["-i", src, "-af", af, "-c:a", "pcm_f32le", work])
        r = ebur128(work)
        # limiting takes a little loudness away: put it back for the next try
        if abs(r["I"] - I) > 0.15:
            gain += I - r["I"]
        if r["TP"] <= TP and abs(r["I"] - I) <= 0.3:
            break
        if r["TP"] > TP:
            ceiling -= max(0.3, r["TP"] - TP + 0.1)
    ff(["-i", work, "-c:a", "pcm_s24le", dst])
    os.remove(work)
    return ebur128(dst)


def report(path, label=None):
    """'Listen by proxy': loudness, peaks, clipping, noise floor, octave balance."""
    x = read_audio(path)
    out = {"file": os.path.basename(path), "dur_s": round(x.shape[1] / SR, 2)}
    out.update({k: round(v, 2) if isinstance(v, float) and np.isfinite(v) else v for k, v in ebur128(path).items()})
    out.update({k: round(v, 2) if isinstance(v, float) and np.isfinite(v) else v for k, v in astats(path).items()})
    out["sample_peak_dBFS"] = round(db(np.max(np.abs(x))), 2)
    out["clipped_samples"] = int(np.sum(np.abs(x) >= 0.9999))
    out["bands_dB"] = band_balance(x)
    if label:
        out["label"] = label
    return out


def dump(obj, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    json.dump(obj, open(path, "w"), indent=1)
