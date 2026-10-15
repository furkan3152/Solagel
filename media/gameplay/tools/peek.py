"""Tiles proxy frames of takes at given times, for picking shots.
  python peek.py OUT.jpg take:t take:t ...   (t in seconds; uses takes/<take>/proxy.mp4)"""
import os, subprocess, sys
from PIL import Image, ImageDraw
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cache", "takes")
out, specs = sys.argv[1], sys.argv[2:]
tiles = []
for s in specs:
    take, t = s.rsplit(":", 1)
    import json, bisect
    d = os.path.join(T, take)
    times = json.load(open(os.path.join(d, "frames.json")))
    pts = json.load(open(os.path.join(d, "pts.json")))
    i = max(0, bisect.bisect_right(times, float(t)) - 1)
    p = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{max(0, pts[i] - 0.002):.4f}", "-i", os.path.join(d, "video.mkv"), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    im = Image.open(__import__("io").BytesIO(p.stdout)).convert("RGB").resize((640, 360))
    ImageDraw.Draw(im).text((8, 6), s, fill=(230, 0, 60))
    tiles.append(im)
cols = 4
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (640 * cols, 360 * rows), "white")
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % cols) * 640, (i // cols) * 360))
sheet.save(out, quality=85)
