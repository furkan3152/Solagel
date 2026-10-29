"""Mixes a short film's soundtrack (the mint film, Roadmap Chomp): score + SFX cues + VO.

  python mix.py PROJECT_DIR      (PROJECT_DIR/timeline.json: duration, "vo": [{id, at}], "sfx": [cues])
  -> PROJECT_DIR/cache/audio/premix.wav (then media/gameplay/render/finalize.py, see render.sh)

Reuses the promo's parts so every film sounds like one family: the SFX (media/promo/audio/sfx.py,
cue types and gains as in the promo's timeline), the VO chain (media/promo/audio/mix.py: high-pass,
mud cut, presence, air, de-esser, 3:1 compression, light room; every line at -19 LUFS) and the
gameplay kit's sidechain duck (music 8 dB under the voice, 150 ms look-ahead).
"""
import json
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, "..", "..")
sys.path.insert(0, os.path.join(MEDIA, "promo", "audio"))
import mix as PM  # noqa: E402  (the promo's VO chain)
import sfx as PS  # noqa: E402  (the promo's SFX; imported before the gameplay kit, which has its own sfx)
sys.path.insert(0, os.path.join(MEDIA, "gameplay", "render"))
from audio import duck_gain  # noqa: E402

SR = 48000


def main():
    proj = os.path.abspath(sys.argv[1])
    tl = json.load(open(os.path.join(proj, "timeline.json")))
    adir = os.path.join(proj, "cache", "audio")
    os.makedirs(adir, exist_ok=True)
    n = int((tl["duration"] + 0.1) * SR)
    meter = pyln.Meter(SR)

    music, sr = sf.read(os.path.join(adir, "music.wav"), always_2d=True)
    assert sr == SR
    music = music.T[:, :n]
    music = np.pad(music, ((0, 0), (0, n - music.shape[1])))

    # a project may bring its own sounds (audio/sfx.py with make(cue) -> array or None)
    own = None
    if os.path.exists(os.path.join(proj, "audio", "sfx.py")):
        import importlib.util
        spec = importlib.util.spec_from_file_location("own_sfx", os.path.join(proj, "audio", "sfx.py"))
        own = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(own)
    sfx = np.zeros((2, n))
    for cue in tl.get("sfx", []):
        x = own.make(cue) if own else None
        if x is None:
            x = PS.make(cue)
        g = cue.get("gain", 1.0)
        if x.ndim == 2:
            i = int(cue["at"] * SR)
            m = min(x.shape[1], n - i)
            sfx[:, i:i + m] += x[:, :m] * g
        else:
            PS.M.place(sfx, x, cue["at"], g, cue.get("pan", 0.0))

    vo = np.zeros((2, n))
    if tl.get("vo"):
        ir = os.path.join(adir, "room-ir.wav")
        PM.room_ir(ir)
        for cue in tl["vo"]:
            src = os.path.join(proj, "cache", "vo-raw", cue["id"] + ".wav")
            dst = os.path.join(adir, "vo-" + cue["id"] + ".wav")
            PM.process_vo(src, dst, ir)
            x, _ = sf.read(dst, always_2d=True)
            L = pyln.Meter(SR).integrated_loudness(x) if len(x) > SR * 0.45 else -19.0
            if np.isfinite(L):
                x = x * 10 ** ((-19.0 - L) / 20)
            i = int(cue["at"] * SR)
            m = min(len(x), n - i)
            vo[:, i:i + m] += x.T[:, :m] * cue.get("gain", 1.0)

    lufs = lambda x: meter.integrated_loudness(x.T)  # noqa: E731
    lv = tl.get("levels", {})
    music *= 10 ** ((lv.get("music", -18.5) - lufs(music)) / 20)
    if np.any(sfx):
        sfx = signal.lfilter(*signal.butter(2, 40 / (SR / 2), "high"), sfx, axis=1)
        sfx *= 10 ** ((lv.get("sfx", -21.0) - lufs(sfx)) / 20)
    if np.any(vo):
        act = np.abs(vo[0]) > 1e-4
        vo *= 10 ** ((-16 - meter.integrated_loudness(vo[:, act].T)) / 20)
        music = music * duck_gain(vo.T, -8.0)
    mix = music + sfx + vo
    # a short fade at the very end so the last frame is clean
    f = int(0.25 * SR)
    mix[:, -f:] *= np.linspace(1, 0, f)
    mix *= 10 ** ((-14 - lufs(mix)) / 20)
    out = os.path.join(adir, "premix.wav")
    sf.write(out, mix.T.astype(np.float32), SR, subtype="FLOAT")
    print("premix", out, round(lufs(mix), 2), "LUFS")


if __name__ == "__main__":
    main()
