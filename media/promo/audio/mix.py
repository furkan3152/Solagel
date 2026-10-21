"""Mixes the promo soundtrack: processed VO + ducked music + SFX, then a
two-pass ffmpeg loudnorm to -14 LUFS / -1.5 dBTP.

  python mix.py CACHE_DIR      (expects CACHE_DIR/vo-raw/*.wav, audio/music.wav, audio/sfx.wav)
  → CACHE_DIR/audio/final.wav

VO chain (ffmpeg): soxr resample to 48 kHz, high-pass 80 Hz, mud cut at 220 Hz,
presence at 3.2 kHz, air shelf, de-esser, gentle 3:1 compression, then a light
synthetic room (afir convolution, about -18 dB wet).
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
FF = os.environ.get("FFMPEG", "/usr/bin/ffmpeg")
SR = 48000


def run(args):
    return subprocess.run([FF, "-hide_banner", "-nostdin", "-y", *args], capture_output=True, text=True, check=True)


def room_ir(path):
    r = np.random.default_rng(5)
    t = np.arange(int(0.42 * SR)) / SR
    ir = r.standard_normal((2, len(t))) * np.exp(-t / 0.085)
    b, a = signal.butter(2, 5500 / (SR / 2), "low")
    ir = signal.lfilter(b, a, ir, axis=1)
    # a few early reflections
    for d, g in ((0.007, 0.5), (0.013, 0.35), (0.021, 0.25)):
        ir[:, int(d * SR)] += g
    ir[:, : int(0.004 * SR)] = 0
    ir /= np.max(np.abs(ir))
    sf.write(path, ir.T.astype(np.float32), SR, subtype="FLOAT")


def process_vo(src, dst, ir):
    chain = (
        "aresample=48000:resampler=soxr,highpass=f=80:p=2,"
        "equalizer=f=220:t=q:w=1.1:g=-2.5,equalizer=f=3200:t=q:w=1.2:g=2.2,"
        "highshelf=f=8000:g=2,"
        "deesser=i=0.3:m=0.5:f=0.5:s=o,"
        "acompressor=threshold=-21dB:ratio=3:attack=6:release=140:knee=4:makeup=2.5"
    )
    fc = f"[0:a]{chain},pan=stereo|c0=c0|c1=c0,asplit[d][w];[w][1:a]afir=dry=1:wet=1[r];[d][r]amix=inputs=2:weights='1 0.13':normalize=0[o]"
    run(["-i", src, "-i", ir, "-filter_complex", fc, "-map", "[o]", "-c:a", "pcm_f32le", dst])


def splice(x, pieces, n):
    """pieces: [[film_at, scene_from, scene_to], ...] -> the film's track (n samples)."""
    out = np.zeros((x.shape[0], n))
    xf = int(0.008 * SR)
    for k, (at, a, b) in enumerate(pieces):
        nxt = pieces[k + 1][0] if k + 1 < len(pieces) else n / SR
        i0, j0 = int(round(at * SR)), int(round(a * SR))
        m = min(int(round(nxt * SR)) - i0 + xf, x.shape[1] - j0, n - i0)
        seg = x[:, j0:j0 + m].copy()
        if k > 0:
            seg[:, :xf] *= np.linspace(0, 1, xf)
        if k + 1 < len(pieces) and m > xf:
            seg[:, -xf:] *= np.linspace(1, 0, xf)
        out[:, i0:i0 + m] += seg
    return out


def main():
    cache = sys.argv[1]
    adir = os.path.join(cache, "audio")
    os.makedirs(adir, exist_ok=True)
    ir = os.path.join(adir, "room-ir.wav")
    room_ir(ir)
    music, _ = sf.read(os.path.join(adir, "music.wav"), always_2d=True)
    sfx, _ = sf.read(os.path.join(adir, "sfx.wav"), always_2d=True)
    music, sfx = music.T, sfx.T
    if TL.get("audioCut"):
        # the film is a cut of the scene timeline: splice the music and the scene SFX on the
        # beat-aligned pieces (8 ms crossfades), then add the cut's own cues (sfx2.wav)
        n = int((TL["cutDuration"] + 0.2) * SR)
        music, sfx = splice(music, TL["audioCut"], n), splice(sfx, TL["audioCut"], n)
        p2 = os.path.join(adir, "sfx2.wav")
        if os.path.exists(p2):
            s2, _ = sf.read(p2, always_2d=True)
            s2 = s2.T[:, :n]
            sfx[:, : s2.shape[1]] += s2
        vo_cues = TL["vo2"]
    else:
        n = int((TL["duration"] + 0.2) * SR)
        music, sfx = music[:, :n], sfx[:, :n]
        vo_cues = TL["vo"]
    meter = pyln.Meter(SR)

    vo = np.zeros((2, n))
    for cue in vo_cues:
        src = os.path.join(cache, "vo-raw", cue["id"] + ".wav")
        dst = os.path.join(adir, "vo-" + cue["id"] + ".wav")
        process_vo(src, dst, ir)
        x, _ = sf.read(dst, always_2d=True)
        # every line at the same loudness before the bus level
        L = pyln.Meter(SR).integrated_loudness(x) if len(x) > SR * 0.45 else -19.0
        if np.isfinite(L):
            x = x * 10 ** ((-19.0 - L) / 20)
        x = x.T
        i = int(cue["at"] * SR)
        m = min(x.shape[1], n - i)
        vo[:, i:i + m] += x[:, :m]

    # level the stems: VO -16 LUFS (over speech), music -18 LUFS, SFX peaks set by cue gains
    def lufs(x):
        return meter.integrated_loudness(x.T)

    vo_active = np.abs(vo[0]) > 1e-4
    vo *= 10 ** ((-16 - meter.integrated_loudness(vo[:, vo_active].T)) / 20)
    music *= 10 ** ((-18.5 - lufs(music)) / 20)
    sfx = signal.lfilter(*signal.butter(2, 40 / (SR / 2), "high"), sfx, axis=1)
    sfx *= 10 ** ((-21 - lufs(sfx)) / 20)

    # sidechain duck: music down 8 dB under the voice, starting 150 ms early, held through the
    # breaths between phrases, smooth ramps (the gameplay kit's duck_gain)
    import sys as _s
    _s.path.insert(0, os.path.join(HERE, "..", "..", "gameplay", "render"))
    from audio import duck_gain
    g = duck_gain(vo.T, -8.0)
    music_d = music * g

    mix = music_d + sfx + vo
    pre = os.path.join(adir, "premix.wav")
    sf.write(pre, mix.T.astype(np.float32), SR, subtype="FLOAT")
    sf.write(os.path.join(adir, "duck.wav"), g.astype(np.float32), SR, subtype="FLOAT")

    # gain to target, brick-wall limit the peaks, then a two-pass linear loudnorm trims to exactly -14
    I, TP, LRA = -14.0, -2.0, 11
    gain_db = I - meter.integrated_loudness(mix.T)
    lim = os.path.join(adir, "limited.wav")
    run(["-i", pre, "-af", f"volume={gain_db:.2f}dB,alimiter=limit={10 ** (-4.4 / 20):.4f}:attack=2:release=80:level=false", "-c:a", "pcm_f32le", lim])
    pre = lim
    p1 = run(["-i", pre, "-af", f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json", "-f", "null", "-"])
    js = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p1.stderr, re.S).group(0))
    af = (
        f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
        f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true"
    )
    final = os.path.join(adir, "final.wav")
    run(["-i", pre, "-af", af + ",aresample=48000", "-c:a", "pcm_s24le", final])
    print("pass1", {k: js[k] for k in ("input_i", "input_tp", "input_lra")})
    print("wrote", final)


if __name__ == "__main__":
    main()
