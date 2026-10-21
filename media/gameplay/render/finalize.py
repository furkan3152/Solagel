"""Final loudness for every Slana video: -14 LUFS integrated, true peak at or below -1.5 dBTP
*after* AAC encoding (the encoder adds overshoot on transients, so the ceiling is set by
measuring the encoded file, not the WAV).

  python finalize.py IN.wav OUT.wav [--lufs -14] [--tp -1.5] [--bitrate 192k]

1. gain to the target loudness;
2. a look-ahead true-peak limiter: peaks measured 4x oversampled, gain reduction that reaches its
   depth before each peak (min-filter, then a moving average no wider than the look-ahead, so the
   smoothed gain never exceeds what a peak needs) and releases over about 25 ms;
3. repeat 1-2 until the loudness holds (limiting takes a little loudness off);
4. encode AAC, decode, measure the true peak (ffmpeg ebur128, peak=true); if it is over the
   target, lower the limiter ceiling by the excess and start again.
Prints a JSON line with the measured values of the encoded test.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

FF = os.environ.get("FFMPEG", "/usr/bin/ffmpeg")


def limit(x, sr, ceiling_db):
    """x: (n, ch). Returns x with its 4x-oversampled peaks held under ceiling_db."""
    ceil = 10 ** (ceiling_db / 20)
    up = signal.resample_poly(x, 4, 1, axis=0)
    peak = np.max(np.abs(up), axis=1)
    n = x.shape[0]
    peak = peak[: n * 4].reshape(n, 4).max(axis=1) if peak.shape[0] >= n * 4 else np.pad(peak, (0, n * 4 - peak.shape[0])).reshape(n, 4).max(axis=1)
    req = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    look = int(0.0025 * sr)  # 2.5 ms look-ahead
    rel = int(0.025 * sr)
    g = minimum_filter1d(req, size=2 * look + 1, mode="nearest")
    g = uniform_filter1d(g, size=look + 1, mode="nearest")
    # release: hold the reduction a little and ease it back
    g2 = minimum_filter1d(g, size=2 * rel + 1, mode="nearest")
    g2 = uniform_filter1d(g2, size=rel + 1, mode="nearest")
    g = np.minimum(g, np.maximum(g2, g * 0.0 + g2))
    return x * g[:, None]


def measure_encoded(x, sr, bitrate):
    with tempfile.TemporaryDirectory() as d:
        wav, m4a = os.path.join(d, "a.wav"), os.path.join(d, "a.m4a")
        sf.write(wav, x.astype(np.float32), sr, subtype="FLOAT")
        subprocess.run([FF, "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", bitrate, "-ar", "48000", m4a], check=True)
        r = subprocess.run([FF, "-hide_banner", "-nostats", "-i", m4a, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
        tail = r.stderr[r.stderr.rfind("Summary:"):]
        i = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
        tp = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))
        return i, tp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--tp", type=float, default=-1.5)
    ap.add_argument("--bitrate", default="192k")
    a = ap.parse_args()
    x, sr = sf.read(a.inp, always_2d=True)
    meter = pyln.Meter(sr)
    ceiling = a.tp - 1.0
    for attempt in range(6):
        y = x.copy()
        for _ in range(4):
            y *= 10 ** ((a.lufs - meter.integrated_loudness(y)) / 20)
            y = limit(y, sr, ceiling)
        lufs = meter.integrated_loudness(y)
        i, tp = measure_encoded(y, sr, a.bitrate)
        if tp <= a.tp - 0.1 or attempt == 5:
            break
        ceiling -= (tp - (a.tp - 0.2))
    sf.write(a.out, y.astype(np.float32), sr, subtype="FLOAT")
    print(json.dumps({"wav_lufs": round(lufs, 2), "ceiling": round(ceiling, 2), "aac_lufs": i, "aac_tp": tp}))


if __name__ == "__main__":
    main()
