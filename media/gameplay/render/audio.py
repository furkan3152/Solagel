"""Mixes the soundtrack of an edit.

  python audio.py EDIT_JSON OUT_WAV [--vo-dir DIR] [--music SPEC_JSON] [--stems DIR]

Layers (all 48 kHz stereo float):
  game   the take audio under every shot, following the shot's time map (varispeed: a slow-motion
         ramp pitches down like tape, a freeze holds silence), short fades at the cuts;
  sfx    the edit's cues, synthesised by sfx.py (or a wav file);
  vo     voiceover lines (edit.vo), processed like the promo's VO: high-pass, mud cut, presence,
         de-ess, 3:1 compression, a light synthetic room;
  music  the game's own score captured from the audio tap (see capture/take-music.mjs) laid out
         by the music spec, plus optional drum sweetening; ducked under the VO.
Then a gentle bus compressor and a peak limiter, and a two-pass ffmpeg loudnorm to -14 LUFS
integrated, -1.5 dBTP.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sfx as SFX  # noqa: E402

SR = 48000
FF = os.environ.get("FFMPEG", "/usr/bin/ffmpeg")
TAKES = os.path.join(HERE, "..", "cache", "takes")


def load(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, 1)
    if sr != SR:
        x = signal.resample_poly(x, SR, sr, axis=0).astype(np.float32)
    return x


def place(buf, x, at, gain=1.0):
    i = int(round(at * SR))
    if i >= len(buf):
        return
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), len(buf) - i)
    buf[i: i + n] += x[:n] * gain


def fade(x, a=0.008, b=0.008):
    na, nb = int(a * SR), int(b * SR)
    if na:
        x[:na] *= np.linspace(0, 1, na)[:, None]
    if nb:
        x[-nb:] *= np.linspace(1, 0, nb)[:, None]
    return x


def game_layer(edit, n):
    out = np.zeros((n, 2), np.float32)
    cache = {}
    for s in edit["audioShots"]:
        if s["mute"]:
            continue
        p = os.path.join(TAKES, s["take"], "audio.wav")
        if not os.path.exists(p):
            continue
        if p not in cache:
            cache[p] = load(p)
        src = cache[p]
        mp = np.array(s["map"])
        t_out = np.arange(int(round(s["start"] * SR)), int(round(s["end"] * SR))) / SR
        t_src = np.interp(t_out, mp[:, 0], mp[:, 1])
        idx = t_src * SR
        seg = np.stack([np.interp(idx, np.arange(len(src)), src[:, c]) for c in (0, 1)], 1).astype(np.float32)
        # freeze frames: hold nothing (the cue carries the moment)
        rate = np.gradient(t_src) * SR
        seg *= np.clip(rate * 4, 0, 1)[:, None] if len(rate) > 1 else 1
        seg = fade(seg, 0.01, 0.01) * s["gain"]
        place(out, seg, s["start"])
    return out


def room_ir(seed=5):
    r = np.random.default_rng(seed)
    t = np.arange(int(0.42 * SR)) / SR
    ir = r.standard_normal((2, len(t))) * np.exp(-t / 0.085)
    b, a = signal.butter(2, 5500 / (SR / 2), "low")
    ir = signal.lfilter(b, a, ir, axis=1)
    for d, g in ((0.007, 0.5), (0.013, 0.35), (0.021, 0.25)):
        ir[:, int(d * SR)] += g
    ir[:, : int(0.004 * SR)] = 0
    return (ir / np.max(np.abs(ir))).T.astype(np.float32)


def process_vo(src, dst, ir_path):
    chain = (
        "aresample=48000:resampler=soxr,highpass=f=80:p=2,"
        "equalizer=f=220:t=q:w=1.1:g=-2.5,equalizer=f=3200:t=q:w=1.2:g=2.2,"
        "highshelf=f=8000:g=2,"
        "deesser=i=0.45:m=0.5:f=0.5:s=o,"
        "acompressor=threshold=-21dB:ratio=3:attack=6:release=140:knee=4:makeup=2.5"
    )
    fc = f"[0:a]{chain},pan=stereo|c0=c0|c1=c0,asplit[d][w];[w][1:a]afir=dry=1:wet=1[r];[d][r]amix=inputs=2:weights='1 0.13':normalize=0[o]"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-i", ir_path, "-filter_complex", fc, "-map", "[o]", "-c:a", "pcm_f32le", dst], check=True)


def vo_layer(edit, n, vo_dir, work):
    out = np.zeros((n, 2), np.float32)
    if not edit["vo"]:
        return out
    os.makedirs(work, exist_ok=True)
    irp = os.path.join(work, "room.wav")
    sf.write(irp, room_ir(), SR, subtype="FLOAT")
    for v in edit["vo"]:
        src = os.path.join(vo_dir, v["id"] + ".wav")
        dst = os.path.join(work, v["id"] + ".wav")
        if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
            process_vo(src, dst, irp)
        x = load(dst)
        place(out, x * (10 ** (-6 / 20)), v["at"], v.get("gain", 1))
    return out


def env_follow(x, attack=0.03, release=0.35):
    m = np.abs(x).max(1)
    a, r = np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR))
    # one-pole peak follower (block-wise for speed)
    hop = 240
    blocks = m[: len(m) // hop * hop].reshape(-1, hop).max(1)
    e = np.zeros_like(blocks)
    acc = 0.0
    ah, rh = a ** hop, r ** hop
    for i, v in enumerate(blocks):
        acc = ah * acc + (1 - ah) * v if v > acc else rh * acc + (1 - rh) * v
        e[i] = acc
    full = np.repeat(e, hop)
    return np.concatenate([full, np.full(len(m) - len(full), full[-1] if len(full) else 0)])


def music_layer(spec, n, edit):
    """spec: {"parts": [{file, at, from, dur, gain, fadeIn, fadeOut}], "drums": {...}, "gain": [[t, dB], ...]}"""
    out = np.zeros((n, 2), np.float32)
    cache = {}
    for p in spec.get("parts", []):
        if p["file"] not in cache:
            cache[p["file"]] = load(p["file"])
        src = cache[p["file"]]
        a = int(p.get("from", 0) * SR)
        seg = src[a: a + int(p["dur"] * SR)].copy()
        seg = fade(seg, p.get("fadeIn", 0.02), p.get("fadeOut", 0.3))
        place(out, seg, p["at"], 10 ** (p.get("gain", 0) / 20))
    d = spec.get("drums")
    if d:
        out += drum_layer(d, n)
    g = spec.get("gain")
    if g:
        t = np.arange(n) / SR
        db = np.interp(t, [x[0] for x in g], [x[1] for x in g])
        out *= (10 ** (db / 20))[:, None]
    return out


def drum_layer(d, n):
    """A swung boom-bap kit locked to the score's grid: d = {bpm, phase, start, end, gain, fills: [t...], drop: [[t0, t1], ...]}."""
    out = np.zeros((n, 2), np.float32)
    beat = 60 / d["bpm"]
    eighth = beat / 2
    swing = d.get("swing", 0.16) * eighth
    k, s, h, oh = SFX.make("kick"), SFX.make("snare"), SFX.make("hat"), SFX.make("ohat")
    t = d["phase"]
    step = 0
    rng = np.random.default_rng(3)
    drops = d.get("drop", [])
    while t < d["end"]:
        if t >= d["start"] and not any(a <= t < b for a, b in drops):
            pos = step % 8  # eighths in a bar of 4/4
            sw = swing if pos % 2 == 1 else 0
            if pos in (0, 5) or (pos == 3 and rng.random() < 0.3):
                place(out, k, t + sw, 0.95)
            if pos in (2, 6):
                place(out, s, t + sw, 0.62)
            place(out, h, t + sw, 0.26 if pos % 2 == 0 else 0.17)
            if pos == 7 and step % 32 == 31:
                place(out, oh, t + sw, 0.25)
        t += eighth
        step += 1
    for ft in d.get("fills", []):
        for i in range(4):
            place(out, s, ft + i * eighth / 2, 0.35 + i * 0.1)
    return out * (10 ** (d.get("gain", -4) / 20))


def sfx_layer(edit, n):
    out = np.zeros((n, 2), np.float32)
    for c in edit["sfx"]:
        kw = {k: v for k, v in c.items() if k not in ("type", "at", "gain", "file")}
        x = load(c["file"]) if c.get("file") else SFX.make(c["type"], **kw)
        place(out, x, c["at"], c.get("gain", 1))
    return out


def limiter(x, ceiling=0.89, release=0.08):
    peak = np.abs(x).max(1)
    g = np.minimum(1, ceiling / np.maximum(peak, 1e-9))
    # look-ahead-ish smoothing: min filter then release
    w = int(0.004 * SR) | 1
    g = -signal.order_filter(-g, np.ones(w), w - 1) if w > 1 else g
    rel = np.exp(-1 / (release * SR))
    hop = 48
    gb = g[: len(g) // hop * hop].reshape(-1, hop).min(1)
    acc = 1.0
    sm = np.zeros_like(gb)
    rh = rel ** hop
    for i, v in enumerate(gb):
        acc = v if v < acc else rh * acc + (1 - rh) * v
        sm[i] = acc
    gs = np.repeat(sm, hop)
    gs = np.concatenate([gs, np.ones(len(g) - len(gs))])
    return x * gs[:, None]


def loudnorm(src, dst, I=-14.0, TP=-1.5, LRA=11):
    r = subprocess.run([FF, "-hide_banner", "-nostdin", "-i", src, "-af", f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr[r.stderr.rfind("{"): r.stderr.rfind("}") + 1]
    m = json.loads(txt)
    af = (f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=json")
    r2 = subprocess.run([FF, "-hide_banner", "-nostdin", "-y", "-i", src, "-af", af + ",aresample=48000", "-c:a", "pcm_s16le", dst], capture_output=True, text=True)
    t2 = r2.stderr[r2.stderr.rfind("{"): r2.stderr.rfind("}") + 1]
    return m, json.loads(t2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edit")
    ap.add_argument("out")
    ap.add_argument("--vo-dir", default="")
    ap.add_argument("--music", default="")
    ap.add_argument("--stems", default="")
    ap.add_argument("--game-db", type=float, default=0.0)
    ap.add_argument("--sfx-db", type=float, default=-3.0)
    ap.add_argument("--music-db", type=float, default=0.0)
    ap.add_argument("--duck-db", type=float, default=-11.0)
    a = ap.parse_args()
    edit = json.load(open(a.edit))
    n = int(edit["duration"] * SR) + SR // 2
    work = os.path.join(os.path.dirname(os.path.abspath(a.out)), "vo-proc")
    game = game_layer(edit, n) * 10 ** (a.game_db / 20)
    fx = sfx_layer(edit, n) * 10 ** (a.sfx_db / 20)
    vo = vo_layer(edit, n, a.vo_dir, work) if a.vo_dir else np.zeros((n, 2), np.float32)
    mus = np.zeros((n, 2), np.float32)
    if a.music:
        mus = music_layer(json.load(open(a.music)), n, edit) * 10 ** (a.music_db / 20)
    # duck music (and a little of the game) under the voice
    if np.any(vo):
        e = env_follow(vo, 0.04, 0.45)
        k = np.clip(e / 0.05, 0, 1)
        mus *= (10 ** (a.duck_db * k / 20))[:, None]
        game *= (10 ** (a.duck_db * 0.6 * k / 20))[:, None]
    mix = game + fx + vo + mus
    if a.stems:
        os.makedirs(a.stems, exist_ok=True)
        for nm, x in (("game", game), ("sfx", fx), ("vo", vo), ("music", mus)):
            sf.write(os.path.join(a.stems, nm + ".wav"), x, SR, subtype="FLOAT")
    # gentle glue: soft knee saturation on peaks, then a limiter
    mix = np.tanh(mix * 0.9) / 0.9
    mix = limiter(mix, 0.85)
    tmp = a.out + ".pre.wav"
    sf.write(tmp, mix.astype(np.float32), SR, subtype="FLOAT")
    m1, m2 = loudnorm(tmp, a.out)
    os.remove(tmp)
    print(json.dumps({"input_i": m1["input_i"], "input_tp": m1["input_tp"], "output_i": m2["output_i"], "output_tp": m2["output_tp"], "output_lra": m2["output_lra"]}))


if __name__ == "__main__":
    main()
