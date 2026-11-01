"""A listening demo of the game audio, for review (not shipped):

  python3 scripts/audio/demo.py WORK OUT.mp3

WORK holds what voice.py --wav, music.py --wav and render-sfx.mjs wrote (voice-wav/*.wav,
music-wav/*.wav, sfx-sampler.wav + .json). The demo is
  1. every announcer variant, in lines.json order, over the game loop at its in-game balance
     (music bus 0.25 against voice 0.5, ducked 6 dB under each line);
  2. the effects sampler (the real sfx.ts through the real mixer, rendered offline);
  3. 30 s of the lobby loop, starting 15 s before its loop point (the seam is in the middle);
  4. 30 s of the game loop, the tension layer cross-fading in after 6 s (2.5 s fade, phase-locked).
Writes OUT.mp3 (192 kb/s) and OUT.txt (a timestamped list with every line's text).
"""
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(WEB))
sys.path.insert(0, os.path.join(ROOT, "media", "gameplay-film", "audio"))
import dsp  # noqa: E402

SR = dsp.SR


def stereo(x):
    return np.vstack([x, x]) if x.shape[0] == 1 else x


def looped(x, pad, loop, start, dur):
    """`dur` s of a padded loop file played from loop time `start`, wrapping like the client."""
    p, L = int(pad * SR), int(loop * SR)
    core = x[:, p:p + L]
    idx = (int(start * SR) + np.arange(int(dur * SR))) % L
    return core[:, idx]


def main(work, out):
    spec = json.load(open(os.path.join(WEB, "src", "audio", "lines.json")))
    music = json.load(open(os.path.join(WEB, "src", "audio", "assets", "music", "music.json")))
    mw = lambda n: stereo(dsp.read_audio(os.path.join(work, "music-wav", n + ".wav")))  # noqa: E731
    lobby, game, tension = mw("lobby"), mw("game"), mw("tension")
    marks, parts, t = [], [], 0.0

    def mark(label):
        marks.append(f"{int(t // 60)}:{t % 60:05.2f}  {label}")

    # 1. announcer
    mark("ANNOUNCER - every variant (voice am_fenrir), over the game loop at in-game balance")
    clips = []
    for lid, line in spec["lines"].items():
        for i, text in enumerate(line["variants"]):
            clips.append((f"{lid}-{i + 1}", re.sub(r"\s*\|\s*", " ", text)))
    seq_t = 1.0
    placed = []
    for name, text in clips:
        y = dsp.read_audio(os.path.join(work, "voice-wav", name + ".wav"), ch=1)[0]
        placed.append((seq_t, y, name, text))
        seq_t += len(y) / SR + 0.45
    dur = seq_t + 1.0
    bed = looped(game, music["game"]["pad"], music["game"]["loop"], 0, dur) * 10 ** (-12 / 20)
    duck = np.ones(bed.shape[1])
    vo = np.zeros(bed.shape[1])
    for at, y, name, text in placed:
        i = int(at * SR)
        vo[i:i + len(y)] += y
        a, b = i - int(0.08 * SR), i + len(y) - int(0.3 * SR)
        duck[max(0, a):b] = np.minimum(duck[max(0, a):b], 10 ** (-6 / 20))
        marks.append(f"{int((t + at) // 60)}:{(t + at) % 60:05.2f}    {name:13s} \"{text}\"")
    k = int(0.5 * SR)
    duck = np.convolve(duck, np.ones(k) / k, mode="same")
    sec = bed * duck + vo * 10 ** (-6 / 20)
    parts.append(sec)
    t += dur

    # 2. effects
    gap = np.zeros((2, int(1.5 * SR)))
    parts.append(gap)
    t += 1.5
    mark("EFFECTS SAMPLER (procedural, sfx.ts through the mixer)")
    fx = stereo(dsp.read_audio(os.path.join(work, "sfx-sampler.wav"), ch=1))
    peak = np.max(np.abs(fx))
    fx = fx / max(peak, 1e-6) * 0.5
    for at, label in json.load(open(os.path.join(work, "sfx-sampler.json"))):
        marks.append(f"{int((t + at) // 60)}:{(t + at) % 60:05.2f}    {label}")
    parts.append(fx)
    t += fx.shape[1] / SR

    # 3. lobby across its seam
    parts.append(gap)
    t += 1.5
    L = music["lobby"]["loop"]
    mark(f"MUSIC - lobby loop (F major, 96 BPM), 30 s across the loop point at +15 s")
    parts.append(looped(lobby, music["lobby"]["pad"], L, L - 15, 30))
    t += 30

    # 4. game + tension
    parts.append(gap)
    t += 1.5
    mark("MUSIC - game loop (G major, 128 BPM); the last-minute tension layer fades in at +6 s")
    g = looped(game, music["game"]["pad"], music["game"]["loop"], 0, 30)
    ten = looped(tension, music["tension"]["pad"], music["tension"]["loop"], 0, 30) * 0.85
    fade = np.clip((np.arange(g.shape[1]) / SR - 6) / 2.5, 0, 1)
    parts.append(g + ten * fade)
    t += 30
    mark("end")

    y = np.concatenate(parts, axis=1)
    y = dsp.fade(y, 0.01, 0.5)
    raw = os.path.join(work, "demo-raw.wav")
    dsp.write_wav(raw, (y / np.max(np.abs(y)) * 0.7).astype(np.float32))
    norm = os.path.join(work, "demo-norm.wav")
    m = dsp.normalise(raw, norm, I=-16.0, TP=-1.0)
    dsp.ff(["-i", norm, "-c:a", "libmp3lame", "-b:a", "192k", out])
    open(re.sub(r"\.mp3$", ".txt", out), "w").write("\n".join(marks) + "\n")
    print(f"{out}: {y.shape[1] / SR:.1f} s, I {m['I']:.1f} LUFS, TP {m['TP']:.1f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
