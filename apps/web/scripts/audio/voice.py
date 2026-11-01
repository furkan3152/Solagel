"""The announcer's voice lines: Kokoro TTS (Kokoro-82M v1.0, local ONNX) read like a hype caster,
then a broadcast chain, an optional crowd bed, loudness-normalised and encoded twice (Ogg Opus for
most browsers, AAC in .m4a for Safari versions without Ogg Opus).

  pip install kokoro-onnx scipy           (python 3.13: the PyTorch `kokoro` wheel stops at 3.12;
                                           kokoro-onnx runs the same Kokoro-82M v1.0 model)
  curl -LO https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/kokoro-v1.0.onnx
  curl -LO https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin
  python scripts/audio/voice.py --models DIR [--only firstBite,paid] [--wav DIR]

Reads src/audio/lines.json (ids, variants, crowd tier 0..2, an optional `beat` for lines whose
`|`-separated pieces land on a grid, the countdown). Writes src/audio/assets/voice/<id>-<n>.ogg and
.m4a and, with --wav, the 48 kHz masters (the demo mix reads them).

How a line is made:
  1. read      the voice (lines.json `voice`, am_fenrir) at x1.12..1.19 (seeded per line), 3.5 %
               slower than that, then sped up 3.5 % by resampling: the pitch rises ~0.6 semitone,
               which reads as more excited without a cartoon formant shift
  2. drift     a slow pitch wander of a few cents (synthetic voices are too steady)
  3. chain     high-pass 90 Hz, less box (350 Hz), presence (+4 dB at 3.2 kHz), air shelf,
               de-ess, 4:1 compression from -24 dB (3 ms / 90 ms), a touch of tape saturation
  4. space     a slapback (72 ms, -16 dB, dark) and a short stadium tail (-19 dB wet)
  5. crowd     tier 1/2: a procedural crowd swell (babble, "woo" voices, claps) under the line
  6. level     -16 LUFS integrated, true peak <= -2 dBTP (dsp.normalise), 6 ms fades
  7. encode    Opus 24 kb/s VBR mono; AAC-LC 28 kb/s mono at 24 kHz (+faststart)
"""
import argparse
import json
import os
import re
import sys
import tempfile
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(WEB))
sys.path.insert(0, os.path.join(ROOT, "media", "gameplay-film", "audio"))
import dsp  # noqa: E402  (numpy + ffmpeg DSP kit shared with the films)

SR = dsp.SR
KSR = 24000
LINES = os.path.join(WEB, "src", "audio", "lines.json")
OUT = os.path.join(WEB, "src", "audio", "assets", "voice")
PITCH = 1.035

CHAIN = (
    "highpass=f=90:p=2,"
    "equalizer=f=350:t=q:w=1.0:g=-2.5,"
    "equalizer=f=3200:t=q:w=0.9:g=4,"
    "equalizer=f=6800:t=q:w=1.6:g=-1.5,"
    "highshelf=f=9500:g=1.5,"
    "deesser=i=0.4:m=0.5:f=0.5:s=o,"
    "acompressor=threshold=-24dB:ratio=4:attack=3:release=90:knee=3:makeup=3"
)


def seed_of(s):
    return zlib.crc32(s.encode()) & 0xFFFFFFFF


# ───────────────────────── reading ─────────────────────────
class Reader:
    def __init__(self, models, voice):
        from kokoro_onnx import Kokoro
        self.k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
        self.voice = voice
        self.lang = "en-gb" if voice[0] == "b" else "en-us"

    def read(self, text, speed):
        from scipy.signal import resample_poly
        x, sr = self.k.create(text, voice=self.voice, speed=float(speed / PITCH), lang=self.lang)
        assert sr == KSR
        x = np.asarray(x, np.float64)
        # 24 kHz -> 48 kHz and PITCH x faster in one step (up/down reduced by their gcd)
        up, down = SR, int(round(KSR * PITCH))
        g = np.gcd(up, down)
        y = resample_poly(x, up // g, down // g)
        return trim(y)


def trim(x, thr_db=-42, pad=0.02):
    e = np.abs(x)
    thr = np.max(e) * 10 ** (thr_db / 20)
    idx = np.nonzero(e > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(pad * SR))
    b = min(len(x), idx[-1] + int(pad * 2 * SR))
    return dsp.fade(x[a:b], 0.004, 0.02)


# ───────────────────────── crowd ─────────────────────────
def crowd(dur, seed, tier):
    """A stadium crowd swell, mono at SR: a babble bed, cheering 'woo' voices and claps under a
    0.25 s swell and a slow decay. tier 2 is bigger (more voices, more claps)."""
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.25) * np.exp(-np.maximum(0, t - dur * 0.35) / (dur * 0.33))
    # babble: pink noise through a voice band, a slow random swell
    bed = dsp.bp(dsp.pink(n, seed), 300, 3200)
    am = 0.7 + 0.3 * np.sin(2 * np.pi * r.uniform(1.5, 3) * t + r.uniform(0, 6))
    out = bed / (np.std(bed) + 1e-9) * 0.25 * am
    # cheering voices: band-limited saws gliding up then down through a vowel formant
    voices = 14 if tier == 1 else 26
    for _ in range(voices):
        f0 = r.uniform(170, 420)
        at = r.uniform(0.0, 0.45)
        L = r.uniform(0.6, 1.5)
        m = int(L * SR)
        tt = np.arange(m) / SR
        glide = f0 * (1 + 0.35 * np.sin(np.pi * np.minimum(1, tt / L)) ** 0.7) * (1 + 0.01 * np.sin(2 * np.pi * 5.5 * tt))
        ph = 2 * np.pi * np.cumsum(glide) / SR
        v = sum(np.sin(k * ph) / k for k in range(1, 12) if k * f0 * 1.4 < 4500)
        f1, f2 = r.uniform(450, 750), r.uniform(1000, 1500)
        v = dsp.eq(v, ("peak", f1, 9, 2.5), ("peak", f2, 7, 3.0))
        v = dsp.lp(v, 3200) * np.sin(np.pi * np.minimum(1, tt / L)) ** 1.5
        i = int(at * SR)
        k = min(m, n - i)
        if k > 0:
            out[i:i + k] += v[:k] / (np.std(v) + 1e-9) * r.uniform(0.05, 0.12)
    # claps
    claps = int((40 if tier == 1 else 90) * dur / 2)
    for _ in range(claps):
        at = r.uniform(0.05, dur * 0.85)
        c = dsp.bp(r.standard_normal(int(0.012 * SR)), 900, 3800) * np.exp(-np.arange(int(0.012 * SR)) / (0.003 * SR))
        i = int(at * SR)
        k = min(len(c), n - i)
        out[i:i + k] += c[:k] * r.uniform(0.15, 0.4) * np.exp(-at / dur)
    out *= env
    # far away in a big bowl: darker, mostly reverb
    ir = dsp.reverb_ir(2.2, 0.6, seed=seed % 97, bright=5000, predelay=0.03)
    wet = dsp.fftconv(out, ir)[:n]
    return dsp.lp(0.45 * out + 0.9 * wet, 5200)


# ───────────────────────── chain ─────────────────────────
def drift(x, cents, rng):
    t = np.arange(len(x)) / SR
    c = sum(np.sin(2 * np.pi * rng.uniform(0.3, 0.9) * t + rng.uniform(0, 6.3)) for _ in range(3))
    c = c / max(1e-9, np.max(np.abs(c))) * cents
    ratio = 2 ** (c / 1200)
    pos = np.cumsum(ratio) - ratio[0]
    pos = pos[pos < len(x) - 1]
    return np.interp(pos, np.arange(len(x)), x)


def process(x, seed, tier, work):
    rng = np.random.default_rng(seed)
    x = drift(x, 6.0, rng)
    src, dst = os.path.join(work, "pre.wav"), os.path.join(work, "post.wav")
    dsp.write_wav(src, (x / (np.max(np.abs(x)) + 1e-9) * 0.5).astype(np.float32))
    dsp.ff_chain(src, dst, af=CHAIN)
    y = dsp.read_audio(dst, ch=1)[0]
    # tape: a gentle tanh at about -6 dBFS peaks
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.5
    y = np.tanh(1.8 * y) / 1.8 * 1.1
    lead = 0.04 if tier else 0.0
    tail = 1.6 if tier == 2 else 1.2 if tier == 1 else 0.45
    n = int((lead + tail) * SR) + len(y)
    dry = np.zeros(n)
    dry[int(lead * SR):int(lead * SR) + len(y)] = y
    # slapback off the stands and a short stadium tail
    slap = np.zeros(n)
    d = int(0.072 * SR)
    slap[d:] = dsp.lp(dry, 3000)[:-d] * 10 ** (-16 / 20)
    ir = dsp.reverb_ir(1.3, 0.32, seed=seed % 89, bright=5500, predelay=0.022)
    wet = dsp.hp(dsp.fftconv(dry, ir)[:n], 250) * 10 ** (-19 / 20)
    out = dry + slap + wet
    if tier:
        level = 10 ** ((-15 if tier == 1 else -11) / 20)
        c = np.resize(crowd(n / SR, seed, tier), n)
        out = out + c / (np.sqrt(np.mean(c ** 2)) + 1e-9) * np.sqrt(np.mean(y ** 2)) * level
    # the tail ends in silence, not a cut
    k = int(0.25 * SR)
    out[-k:] *= np.linspace(1, 0, k) ** 2
    return out


def encode(wav, base):
    dsp.ff(["-i", wav, "-map_metadata", "-1", "-ac", "1", "-c:a", "libopus", "-b:a", "24k", "-vbr", "on",
            "-application", "audio", "-frame_duration", "20", base + ".ogg"])
    dsp.ff(["-i", wav, "-map_metadata", "-1", "-ac", "1", "-ar", "24000", "-c:a", "aac", "-b:a", "28k", "-movflags", "+faststart",
            base + ".m4a"])


def render(models, only, wav_dir):
    spec = json.load(open(LINES))
    reader = Reader(models, spec["voice"])
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for lid, line in spec["lines"].items():
        if only and lid not in only:
            continue
        for i, text in enumerate(line["variants"]):
            name = f"{lid}-{i + 1}"
            seed = seed_of(name)
            r = np.random.default_rng(seed)
            speed = 1.12 + r.uniform(0, 0.07)
            pieces = [p.strip() for p in text.split("|") if p.strip()]
            if line.get("beat"):
                beat = float(line["beat"])
                reads = [reader.read(p, speed) for p in pieces]
                x = np.zeros(int(beat * SR * (len(reads) - 1)) + len(reads[-1]))
                for k, y in enumerate(reads):
                    x[int(k * beat * SR):int(k * beat * SR) + len(y)] += y
            else:
                x = reader.read(" ".join(pieces), speed)
            with tempfile.TemporaryDirectory() as work:
                y = process(x, seed, int(line.get("crowd", 0)), work)
                raw = os.path.join(work, "raw.wav")
                dsp.write_wav(raw, y.astype(np.float32))
                master = os.path.join(wav_dir or work, name + ".wav")
                m = dsp.normalise(raw, master, I=-16.0, TP=-2.0)
                encode(master, os.path.join(OUT, name))
            sizes = {ext: os.path.getsize(os.path.join(OUT, f"{name}.{ext}")) for ext in ("ogg", "m4a")}
            report[name] = {"text": re.sub(r"\s*\|\s*", " ", text), "speed": round(speed, 3), "dur": round(len(y) / SR, 2),
                            "I": m["I"], "TP": m["TP"], **sizes}
            print(f"{name:14s} {report[name]['dur']:5.2f}s  I {m['I']:6.1f}  TP {m['TP']:5.1f}  ogg {sizes['ogg']:6d}  m4a {sizes['m4a']:6d}  {report[name]['text']}", flush=True)
    if wav_dir:
        dsp.dump(report, os.path.join(wav_dir, "voice-report.json"))
    tot = {ext: sum(v[ext] for v in report.values()) for ext in ("ogg", "m4a")}
    print("total", tot)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--wav", default=None, help="also keep the 48 kHz masters here")
    a = ap.parse_args()
    render(a.models, set(x for x in a.only.split(",") if x), a.wav)
