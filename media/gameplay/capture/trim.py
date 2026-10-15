"""Keeps only some time ranges of a packed take (to save disk), without changing its timeline.

  python trim.py TAKE_DIR from-to [from-to ...]     (seconds of take time)

Frames outside the ranges are dropped from video.mkv; frames.json keeps the true capture times of
the frames that remain, so edits that point into the kept ranges still work unchanged. pts.json is
rewritten (frame n at n/30 s). events.json and audio.wav are kept whole.
"""
import json, os, subprocess, sys

d = sys.argv[1]
ranges = [tuple(map(float, r.split("-"))) for r in sys.argv[2:]]
times = json.load(open(os.path.join(d, "frames.json")))
keep = [i for i, t in enumerate(times) if any(a <= t <= b for a, b in ranges)]
if not keep:
    sys.exit("nothing to keep")
# contiguous index runs for the select expression
runs, s = [], keep[0]
for a, b in zip(keep, keep[1:] + [None]):
    if b != a + 1:
        runs.append((s, a))
        s = b
expr = "+".join(f"between(n,{a},{b})" for a, b in runs)
tmp = os.path.join(d, "video.trim.mkv")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.path.join(d, "video.mkv"), "-vf", f"select='{expr}',setpts=N/(30*TB)",
                "-r", "30", "-fps_mode", "cfr", "-c:v", "libx264", "-preset", "faster", "-crf", "15", "-pix_fmt", "yuv420p", "-g", "30", tmp], check=True)
n = int(subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", tmp], capture_output=True, text=True).stdout.strip())
if n < len(keep):
    sys.exit(f"trim produced {n} frames, expected {len(keep)}")
os.replace(tmp, os.path.join(d, "video.mkv"))
json.dump([times[i] for i in keep], open(os.path.join(d, "frames.json"), "w"))
json.dump([k / 30 for k in range(len(keep))], open(os.path.join(d, "pts.json"), "w"))
print(f"trimmed {d}: kept {len(keep)} of {len(times)} frames")
