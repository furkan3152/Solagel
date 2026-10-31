"""Mixes the gameplay film's soundtrack: voice (human if there is a recording, else the TTS takes,
else a placeholder murmur), the score ducked under the voice, the sfx at their cues; then the
master to -16 LUFS with true peak <= -1 dBTP.

  python3 mix.py [--work out/work/voice] [--source auto|human|tts|placeholder] [--target -16]
                 [--tp -1] [--duck 9] [--no-vo]

Voice sources, in the order --source auto tries them:
  1. media/gameplay-film/audio/vo-human/<id>.(wav|flac|aif|m4a|mp3)   one file per line (any
     subset: missing lines fall back to the next source)
  2. media/gameplay-film/audio/vo-human.wav (or WORK/vo-human.wav)     one continuous read:
     cut into lines at the silences (leave 1.5 s between lines) and each line laid at its cue;
     with --human-mode synced (a read recorded to picture) it is laid whole from 0 s
     (--human-offset slides it). auto: split when the silences give exactly one take per line,
     else synced when it runs the film's length
  3. WORK/takes/takes.json   the picked Kokoro takes (audio/tts.py)
  4. --source placeholder    a formant murmur with the script's timing (no words)
Human lines get the light chain, TTS and placeholder the full humanising chain (audio/post.py).

The music ducks 9 dB under the voice (look-ahead 150 ms, held through the breaths), and its 1-4 kHz
band dips 3 dB more, so the voice sits in a pocket instead of on top of a hole. SFX dip 3 dB under
the voice. Outputs in WORK/mix/: mix.wav (24-bit, the delivery, -16 LUFS / <= -1 dBTP),
vo-master.wav (the voice alone at -16 LUFS / <= -1 dBTP), stems/{vo,music-ducked,sfx}.wav (at mix
level: they sum to mix.wav before its limiter), timeline.json (where each line landed) and
report.json (loudness, peaks, octave balance, voice-over-music ratio).
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

import dsp
import post
import voice
from dsp import SR

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FILM, "..", ".."))
CUES = json.load(open(os.path.join(FILM, "cues.json")))
LINES = {ln["id"]: ln for ln in json.load(open(os.path.join(FILM, "vo-lines.json")))}
EXT = (".wav", ".flac", ".aif", ".aiff", ".m4a", ".mp3", ".ogg")


def duck_gain(vo, depth_db, look=0.15, hold=0.45, attack=0.09, release=0.5):
    """Per-sample gain under the voice: speech found on a 5 ms RMS, the duck starts `look` s early,
    holds `hold` s through the breaths, ramps with one-pole smoothing in dB."""
    m = np.abs(vo).max(0)
    hop = 240
    nb = len(m) // hop
    rms = np.sqrt((m[: nb * hop].reshape(nb, hop) ** 2).mean(1))
    on = rms > np.max(rms) * 10 ** (-38 / 20)
    k_look, k_hold = int(look * SR / hop), int(hold * SR / hop)
    act = on.copy()
    for i in np.nonzero(on)[0]:
        act[max(0, i - k_look): i + k_hold] = True
    target = np.where(act, -depth_db, 0.0)
    a_att, a_rel = np.exp(-hop / (attack * SR)), np.exp(-hop / (release * SR))
    g = np.zeros(nb)
    cur = 0.0
    for i in range(nb):
        a = a_att if target[i] < cur else a_rel
        cur = a * cur + (1 - a) * target[i]
        g[i] = cur
    full = np.repeat(g, hop)
    full = np.concatenate([full, np.full(len(m) - len(full), full[-1] if len(full) else 0.0)])
    return full, act


def human_sources(work):
    per = {}
    for d in (os.path.join(HERE, "vo-human"), os.path.join(work, "vo-human")):
        for p in sorted(glob.glob(os.path.join(d, "*"))):
            stem, ext = os.path.splitext(os.path.basename(p))
            if ext.lower() in EXT and stem in LINES:
                per.setdefault(stem, p)
    single = next((p for p in (os.path.join(HERE, "vo-human.wav"), os.path.join(work, "vo-human.wav")) if os.path.exists(p)), None)
    return per, single


def load_take(work, lid):
    sel = json.load(open(os.path.join(work, "takes", "takes.json")))
    if lid not in sel:
        return None
    k = sel[lid]["pick"]
    p = os.path.join(work, "takes", lid, f"take{k}.wav")
    lay = json.load(open(p[:-4] + ".json"))["layout"]
    return dsp.read_audio(p, ch=1)[0], lay, k


def build_vo(a, work, n, ir):
    cues = sorted(CUES["vo"], key=lambda c: c["at"])
    per, single = human_sources(work)
    rng = np.random.default_rng(a.seed)
    have_takes = os.path.exists(os.path.join(work, "takes", "takes.json"))
    placed, synced = [], None
    src = a.source
    if src == "auto":
        src = "human" if (per or single) else ("tts" if have_takes else None)
        if src is None:
            sys.exit("no voice yet: record vo-human.wav (or vo-human/<id>.wav), run audio/tts.py, or pass --source placeholder (or --no-vo)")
    # a single continuous human read
    split = {}
    if src == "human" and single and len(per) < len(cues):
        x = dsp.read_audio(single, ch=1)[0]
        missing = [c for c in cues if c["id"] not in per]
        mode = a.human_mode
        if mode == "auto":
            try:
                post.split_by_silence(x, len(missing), a.human_gap)
                mode = "split"
            except SystemExit:
                mode = "synced" if len(x) / SR >= 0.85 * CUES["duration"] else "split"
        if mode == "synced":
            y, _ = post.process_human(x, ir, a.human_room, trim=False)
            synced = (a.human_offset, y)
        else:
            segs = post.split_by_silence(x, len(missing), a.human_gap)
            for c, (i0, i1) in zip(missing, segs):
                split[c["id"]] = x[i0:i1]
    for c in cues:
        lid = c["id"]
        jit = float(rng.uniform(-0.04, 0.04))
        if synced:
            break
        if src == "human" and (lid in per or lid in split):
            x = dsp.read_audio(per[lid], ch=1)[0] if lid in per else split[lid]
            y, lead = post.process_human(x, ir, a.human_room)
            kind = "human:" + (os.path.basename(per[lid]) if lid in per else "vo-human.wav")
            jit = 0.0
        elif src in ("human", "tts") and have_takes and load_take(work, lid):
            x, lay, k = load_take(work, lid)
            y, lead = post.process_tts(x, lay, seed=a.seed + len(placed), ir_path=ir, opts={"room": a.room, "breaths": not a.no_breaths})
            kind = f"tts:take{k}"
        elif src == "placeholder" or a.fill_placeholder:
            x, lay = post.babble(voice.parse(LINES[lid]["text"]), LINES[lid].get("speed", 1.0), seed=len(placed))
            y, lead = post.process_tts(x, lay, seed=a.seed + len(placed), ir_path=ir, opts={"room": a.room, "breaths": not a.no_breaths})
            kind = "placeholder"
        else:
            print(f"  ! no voice for {lid}: skipped")
            continue
        at = c["at"] - lead + jit
        placed.append({"id": lid, "cue": c["at"], "start": round(at, 3), "words_at": round(at + lead, 3),
                       "end": round(at + y.shape[1] / SR, 3), "source": kind, "y": y})
    vo = np.zeros((2, n))
    if synced:
        off, y = synced
        dsp.place(vo, y, off)
        timeline = [{"id": "vo-human.wav (synced)", "start": off, "end": round(off + y.shape[1] / SR, 3), "source": "human:synced"}]
        return vo, timeline, "human-synced"
    for p in placed:
        dsp.place(vo, p.pop("y"), p["start"])
    # overlap check: a line must end 150 ms before the next line's words
    for p, q in zip(placed, placed[1:]):
        if p["end"] > q["words_at"] - 0.15:
            print(f'  ! {p["id"]} ends at {p["end"]:.2f}s, {q["id"]} starts at {q["words_at"]:.2f}s: move {q["id"]} in cues.json, or speed {p["id"]} up')
    if placed and src != "human":
        # room tone: continuous from before the first line to after the last (no digital silence)
        a0, a1 = max(0, placed[0]["start"] - 0.8), min(n / SR, placed[-1]["end"] + 1.0)
        i0, i1 = int(a0 * SR), int(a1 * SR)
        tone = np.stack([dsp.pink(i1 - i0, 41), dsp.pink(i1 - i0, 42)])
        tone = dsp.lp(dsp.hp(tone, 90), 7000)
        speech_rms = np.sqrt(np.mean(vo[:, np.abs(vo[0]) > 1e-3] ** 2)) if np.any(np.abs(vo[0]) > 1e-3) else 0.05
        tone *= speech_rms * 10 ** (-48 / 20) / max(1e-9, np.sqrt(np.mean(tone ** 2)))
        vo[:, i0:i1] += dsp.fade(tone, 0.5, 0.8)
    return vo, placed, src


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(ROOT, "out", "work", "voice"))
    ap.add_argument("--source", default="auto", choices=["auto", "human", "tts", "placeholder"])
    ap.add_argument("--fill-placeholder", action="store_true", help="murmur for lines that have no voice yet")
    ap.add_argument("--target", type=float, default=-16.0)
    ap.add_argument("--tp", type=float, default=-1.0)
    ap.add_argument("--duck", type=float, default=9.0)
    ap.add_argument("--music-lufs", type=float, default=-20.5, help="the score on its own, before the duck")
    ap.add_argument("--room", type=float, default=0.1, help="TTS room send (0 = dry)")
    ap.add_argument("--human-room", type=float, default=0.0)
    ap.add_argument("--human-offset", type=float, default=0.0)
    ap.add_argument("--human-mode", default="auto", choices=["auto", "split", "synced"],
                    help="vo-human.wav: split at the silences and lay each line at its cue, or lay it whole (recorded to picture)")
    ap.add_argument("--human-gap", type=float, default=0.9)
    ap.add_argument("--no-breaths", action="store_true")
    ap.add_argument("--no-vo", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--name", default="mix", help="output folder under WORK")
    a = ap.parse_args()
    work = a.work
    out = os.path.join(work, a.name)
    os.makedirs(out, exist_ok=True)
    n = int((CUES["duration"] + 0.5) * SR)
    for name, mod in (("music.wav", "music"), ("sfx.wav", "sfx")):
        if not os.path.exists(os.path.join(work, name)):
            sys.exit(f"missing {os.path.join(work, name)}: run python3 audio/{mod}.py first (see the README)")
    ir = post.room_ir(os.path.join(out, "room-ir.wav"))

    def fit(x):
        x = x[:, :n]
        return np.pad(x, ((0, 0), (0, n - x.shape[1])))

    music = fit(dsp.read_audio(os.path.join(work, "music.wav"), ch=2))
    sfx = fit(dsp.read_audio(os.path.join(work, "sfx.wav"), ch=2))

    if a.no_vo:
        vo, timeline, src = np.zeros((2, n)), [], "none"
    else:
        vo, timeline, src = build_vo(a, work, n, ir)
        # the stem: -16 LUFS integrated, true peak <= -1 dBTP (the brief's voice spec)
        raw = os.path.join(out, "vo-raw.wav")
        dsp.write_wav(raw, vo.astype(np.float32))
        vm = dsp.normalise(raw, os.path.join(out, "vo-master.wav"), a.target, a.tp)
        print(f'voice stem: {os.path.join(out, "vo-master.wav")}  I {vm["I"]:.1f} LUFS  TP {vm["TP"]:.1f} dBTP')
        vo = fit(dsp.read_audio(os.path.join(out, "vo-master.wav"), ch=2))

    # music: -20.5 LUFS on its own (--music-lufs), then the duck (and the speech-band pocket)
    music *= 10 ** ((a.music_lufs - dsp.lufs_of(music)["I"]) / 20)
    if np.any(vo):
        g_db, act = duck_gain(vo, a.duck)
        pocket = dsp.bp(music, 1000, 4000)
        g = 10 ** (g_db / 20)
        g_pocket = 10 ** ((g_db * (1 + 3.0 / a.duck)) / 20)
        music_d = (music - pocket) * g + pocket * g_pocket
        sfx_d = sfx * 10 ** ((g_db * 3.0 / a.duck) / 20)
    else:
        music_d, sfx_d, g_db = music, sfx, np.zeros(n)
    # sfx: the loudest moment of the cue track at -17 LUFS short-term (a hair under the voice)
    sfx_d *= 10 ** ((-17.0 - dsp.lufs_of(sfx)["S_max"]) / 20)

    mix = vo + music_d + sfx_d
    pre = os.path.join(out, "premix.wav")
    dsp.write_wav(pre, mix.astype(np.float32))
    final = os.path.join(out, "mix.wav")
    m = dsp.normalise(pre, final, a.target, a.tp)
    gain = 10 ** ((m["I"] - dsp.ebur128(pre)["I"]) / 20)
    os.makedirs(os.path.join(out, "stems"), exist_ok=True)
    for name, x in (("vo.wav", vo), ("music-ducked.wav", music_d), ("sfx.wav", sfx_d)):
        if name == "vo.wav" and not np.any(x):
            continue
        dsp.write_wav(os.path.join(out, "stems", name), (x * gain).astype(np.float32))
    json.dump({"source": src, "lines": timeline}, open(os.path.join(out, "timeline.json"), "w"), indent=1)

    # listen by proxy: the speech-to-music ratio where the voice talks, and the files
    rep = {"source": src, "final": dsp.report(final)}
    if np.any(vo):
        _, act = duck_gain(vo, a.duck)
        mask = np.repeat(act, 240)[:n]
        mask = np.pad(mask, (0, n - len(mask)))
        rv = dsp.lufs_of(vo[:, mask.astype(bool)])["I"]
        rm = dsp.lufs_of(music_d[:, mask.astype(bool)])["I"]
        rep["voice_over_music_dB"] = round(rv - rm, 1)
        rep["vo_master"] = dsp.report(os.path.join(out, "vo-master.wav"))
    rep["music_ducked"] = dsp.report(os.path.join(out, "stems", "music-ducked.wav"))
    dsp.dump(rep, os.path.join(out, "report.json"))
    for p in timeline:
        print(f'  {p["id"]:10s} {p.get("cue", 0):6.2f}s cue  words at {p.get("words_at", p["start"]):6.2f}s  ends {p["end"]:6.2f}s  {p["source"]}')
    f = rep["final"]
    print(f'mix ({src}): {final}\n  I {f["I"]} LUFS  TP {f["TP"]} dBTP  LRA {f["LRA"]}  clipped {f["clipped_samples"]}'
          + (f'  voice over music {rep["voice_over_music_dB"]} dB' if "voice_over_music_dB" in rep else ""))


if __name__ == "__main__":
    main()
