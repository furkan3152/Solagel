"""Listen by proxy: loudness (EBU R128 integrated, LRA, true peak), sample peaks and clipping,
the noise floor, octave-band balance, and a short-term loudness profile per film section, so the
score's shape (quiet intro, the pulse, the final-minute rise, the bell, the resolve) can be read
without ears.

  python3 check.py FILE [FILE ...] [--sections] [--json OUT.json]

Flags printed at the end:
  CLIP     any sample at full scale, or true peak above -1 dBTP on a file meant for delivery
  BOOM     sub (20-60 Hz) within 6 dB of the loudest band
  MUD      low-mid (120-250 Hz) the loudest band by more than 3 dB over the 1-2 kHz bands
  HARSH    2-4 kHz or 4-8 kHz louder than the mid band
  DULL     8-16 kHz more than 30 dB under the loudest band (music) / 35 dB (voice)
"""
import argparse
import json
import os
import re

import numpy as np

import dsp

HERE = os.path.dirname(os.path.abspath(__file__))


def short_term(path):
    r = dsp.ff(["-v", "verbose", "-i", path, "-af", "ebur128=framelog=verbose", "-f", "null", "-"], check=False)
    rows = re.findall(r"t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)", r.stderr)
    t = np.array([float(a) for a, _, _ in rows])
    s = np.array([float(c) if c != "-inf" else -120.0 for _, _, c in rows])
    return t, s


def sections_profile(path):
    cues = json.load(open(os.path.join(HERE, "..", "cues.json")))
    mu = sorted(cues["music"].items(), key=lambda kv: kv[1])
    t, s = short_term(path)
    out = []
    for (name, a), (_, b) in zip(mu, mu[1:]):
        m = (t >= a + 1.5) & (t < b)  # the 3 s window lags: skip the first 1.5 s
        if m.sum():
            out.append({"section": name, "from": a, "to": b, "S_mean": round(float(np.mean(s[m])), 1), "S_max": round(float(np.max(s[m])), 1)})
    return out


def flags(r, voice=False):
    f = []
    b = r["bands_dB"]
    if r.get("clipped_samples", 0) > 0 or (np.isfinite(r.get("TP", np.nan)) and r["TP"] > -1.0):
        f.append("CLIP/TP")
    if b["sub"] > -6:
        f.append("BOOM")
    if b["lowmid"] > max(b["1k"], b["2k"]) + 3 and b["lowmid"] == 0:
        f.append("MUD")
    if max(b["2k"], b["4k"]) > b["mid"] + 2:
        f.append("HARSH")
    if b["8k"] < (-35 if voice else -30):
        f.append("DULL")
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--sections", action="store_true")
    ap.add_argument("--voice", action="store_true", help="judge the band balance as speech")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    rows = []
    for p in a.files:
        r = dsp.report(p)
        if a.sections:
            r["sections"] = sections_profile(p)
        r["flags"] = flags(r, a.voice or "vo" in os.path.basename(p))
        rows.append(r)
        print(f'\n{r["file"]}  {r["dur_s"]}s  I {r["I"]} LUFS  LRA {r["LRA"]}  TP {r["TP"]} dBTP  '
              f'peak {r["sample_peak_dBFS"]} dBFS  clipped {r["clipped_samples"]}  RMS {r.get("RMS level dB")} dB  '
              f'RMS peak {r.get("RMS peak dB")} dB  floor {r.get("Noise floor dB")} dB  DC {r.get("DC offset")}  S_max {r.get("S_max")}')
        print("  bands dB:", "  ".join(f"{k} {v}" for k, v in r["bands_dB"].items()))
        for s in r.get("sections", []):
            print(f'  {s["section"]:9s} {s["from"]:6.1f}-{s["to"]:6.1f}s  short-term mean {s["S_mean"]:6.1f}  max {s["S_max"]:6.1f} LUFS')
        print("  flags:", ", ".join(r["flags"]) or "none")
    if a.json:
        dsp.dump(rows, a.json)


if __name__ == "__main__":
    main()
