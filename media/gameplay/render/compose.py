"""Composes the picture of an edit: reframed footage + motion-graphics overlay -> H.264.

  python compose.py EDIT_JSON OVERLAY_DIR OUT_MP4 [--from F --to F] [--crf 15] [--preview F,F,... --out-dir DIR]

For every output frame, edit.json (render/timeline.mjs) gives the take, the source time and the
crop (centre x/y and zoom, in source pixels). The source frame is the screencast JPEG on screen at
that time (frames.json); slow-motion shots blend the two neighbouring frames. The crop is a
sub-pixel affine resample (bicubic) with a touch of sharpening when zoomed in, then the overlay
PNG for that frame (render/overlays.mjs, manifest.json) is alpha-composited on top.
"""
import argparse
import bisect
import json
import os
import subprocess
import sys
from collections import OrderedDict

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TAKES = os.path.join(HERE, "..", "cache", "takes")
FF = os.environ.get("FFMPEG", "/usr/bin/ffmpeg")
PAPER = (241, 234, 219)


class Source:
    """Frames of a take by capture time: the JPEGs if present, else the packed video.mkv
    (decoded sequentially; a jump backwards or far ahead re-seeks by the frame's PTS)."""

    def __init__(self, name, size):
        self.dir = os.path.join(TAKES, name)
        self.times = json.load(open(os.path.join(self.dir, "frames.json")))
        meta = json.load(open(os.path.join(self.dir, "events.json")))
        # replayed takes (capture/replay.mjs) are rendered at `scale` pixels per CSS px, at exact times
        self.scale = meta.get("scale", 1)
        self.exact = bool(meta.get("replayed"))
        # the source frame: the take's own size (not the edit's: a vertical cut crops it)
        size = (round(meta.get("w", size[0]) * self.scale), round(meta.get("h", size[1]) * self.scale))
        self.jpeg = os.path.isdir(os.path.join(self.dir, "frames"))
        pp = os.path.join(self.dir, "pts.json")
        self.pts = None if self.jpeg or not os.path.exists(pp) else json.load(open(pp))
        self.size = size
        self.cache = OrderedDict()
        self.proc = None
        self.next = 0  # index of the next frame the decoder will hand out

    def index(self, t):
        if self.exact:
            # the frame nearest to t (frames sit on a 1/240 s lattice, gaps between ranges)
            i = bisect.bisect_left(self.times, t)
            if i >= len(self.times):
                return len(self.times) - 1
            if i > 0 and t - self.times[i - 1] < self.times[i] - t:
                return i - 1
            return i
        return max(0, min(len(self.times) - 1, bisect.bisect_right(self.times, t) - 1))

    def _open(self, i):
        if self.proc:
            self.proc.kill()
            self.proc.wait()
        ss = max(0.0, self.pts[i] - 0.002)
        self.proc = subprocess.Popen([FF, "-hide_banner", "-loglevel", "error", "-ss", f"{ss:.4f}", "-i", os.path.join(self.dir, "video.mkv"),
                                      "-vf", "setpts=N/(30*TB)", "-r", "30", "-fps_mode", "cfr", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10 ** 8)
        self.next = i

    def _read(self):
        w, h = self.size
        buf = self.proc.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            return None
        im = Image.frombuffer("RGB", (w, h), buf, "raw", "RGB", 0, 1)
        i = self.next
        self.next += 1
        return i, im

    def image(self, i):
        if i in self.cache:
            self.cache.move_to_end(i)
            return self.cache[i]
        if self.jpeg:
            im = Image.open(os.path.join(self.dir, "frames", f"f{i:06d}.jpg")).convert("RGB")
            im.load()
        else:
            if self.proc is None or i < self.next or i > self.next + 90:
                self._open(i)
            im = None
            while self.next <= i:
                r = self._read()
                if r is None:
                    break
                j, im2 = r
                self.cache[j] = im2
                if len(self.cache) > 8:
                    self.cache.popitem(last=False)
                im = im2 if j == i else im
            if im is None:
                im = self.cache[next(reversed(self.cache))]
        self.cache[i] = im
        if len(self.cache) > 8:
            self.cache.popitem(last=False)
        return im

    def at(self, t, blend):
        i = self.index(t)
        a = self.image(i)
        if not blend or i + 1 >= len(self.times):
            return a
        t0, t1 = self.times[i], self.times[i + 1]
        k = (t - t0) / max(1e-6, t1 - t0)
        if k < 0.04:
            return a
        b = self.image(i + 1)
        return Image.blend(a, b, min(1.0, k))


def frame(edit, sources, f, ov_dir, manifest):
    W, H = edit["w"], edit["h"]
    m = edit["map"][f]
    ov = manifest.get(str(f))
    if ov and ov[4]:  # an opaque card covers the frame: it is the frame
        return Image.open(os.path.join(ov_dir, f"f{f:06d}.jpg")).convert("RGB")
    elif m is None:
        base = Image.new("RGB", (W, H), PAPER)
    else:
        ti, t, cx, cy, z, blend = m
        S = sources[ti]
        src = S.at(t, blend and not S.exact)
        sw, sh = src.size
        left, top = cx - W / (2 * z), cy - H / (2 * z)
        k = S.scale
        if abs(z - 1) < 1e-3 and abs(left - round(left)) < 1e-3 and abs(top - round(top)) < 1e-3 and (sw, sh) == (W, H):
            base = src.copy()
        elif k != 1:
            # an antialiased resample of the crop box (sub-pixel), from the high-resolution render
            bw, bh = W / z * k, H / z * k
            x0 = min(max(left * k, 0.0), max(0.0, sw - bw))
            y0 = min(max(top * k, 0.0), max(0.0, sh - bh))
            box = (x0, y0, min(sw, x0 + bw), min(sh, y0 + bh))
            base = src.resize((W, H), Image.LANCZOS, box=box)
            if z > 1.05 * k:
                base = base.filter(ImageFilter.UnsharpMask(radius=1.2, percent=min(60, int((z / k - 1) * 90)), threshold=2))
        else:
            base = src.transform((W, H), Image.AFFINE, (1 / z, 0, left, 0, 1 / z, top), resample=Image.BICUBIC)
            if z > 1.1:
                base = base.filter(ImageFilter.UnsharpMask(radius=1.3, percent=min(70, int((z - 1) * 90)), threshold=2))
    if ov:
        x, y, w, h, _ = ov
        o = Image.open(os.path.join(ov_dir, f"f{f:06d}.png")).convert("RGBA")
        region = base.crop((x, y, x + o.width, y + o.height)).convert("RGBA")
        region.alpha_composite(o)
        base.paste(region.convert("RGB"), (x, y))
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edit")
    ap.add_argument("overlays")
    ap.add_argument("out")
    ap.add_argument("--from", dest="f0", type=int, default=0)
    ap.add_argument("--to", dest="f1", type=int, default=None)
    ap.add_argument("--crf", type=int, default=15)
    ap.add_argument("--preview", default="")
    ap.add_argument("--out-dir", default="")
    a = ap.parse_args()
    edit = json.load(open(a.edit))
    mp = os.path.join(a.overlays, "manifest.json")
    manifest = json.load(open(mp)) if os.path.exists(mp) else {}
    sources = [Source(n, (edit["w"], edit["h"])) for n in edit["takes"]]
    if a.preview:
        os.makedirs(a.out_dir, exist_ok=True)
        for f in [int(x) for x in a.preview.split(",")]:
            frame(edit, sources, f, a.overlays, manifest).save(os.path.join(a.out_dir, f"c{f:05d}.jpg"), quality=90)
        return
    f1 = a.f1 if a.f1 is not None else edit["frames"]
    enc = subprocess.Popen([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f'{edit["w"]}x{edit["h"]}', "-r", str(edit["fps"]), "-i", "-",
                            "-c:v", "libx264", "-preset", "medium", "-crf", str(a.crf), "-pix_fmt", "yuv420p", "-g", str(edit["fps"] * 2), a.out], stdin=subprocess.PIPE)
    for f in range(a.f0, f1):
        enc.stdin.write(frame(edit, sources, f, a.overlays, manifest).tobytes())
        if f % 300 == 0:
            print(f"compose: frame {f}/{f1}", file=sys.stderr, flush=True)
    enc.stdin.close()
    sys.exit(enc.wait())


if __name__ == "__main__":
    main()
