#!/usr/bin/env python3
"""Final compositor for the Elymum SOON promo (16:9).

graded footage (beauty.py) -> push-in + creeping yellow before the bite -> graphics layer (overlay.mjs)
-> camera shake (landing bumps, rumble, the bite's heavy decaying shake with motion blur) -> x264 + mix.wav.

  python3 compose.py WORKDIR OUT.mp4 [--stills DIR]
"""
import argparse
import json
import os
import subprocess

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CUES = json.load(open(os.environ.get('PROMO_CUES') or os.path.join(HERE, 'cues.json')))
M, CARD = CUES['monster'], CUES['card']
W, H, FPS = 1920, 1080, CUES['fps']
SUN = np.array([0x4E, 0xC1, 0xF2], np.float32) / 255  # BGR

STILLS = {
    'beauty-after': 3.6, 'monster-enter': 13.75, 'monster-approach': 16.4, 'monster-see-that': 17.9,
    'monster-open': 18.8, 'monster-lunge': 19.3, 'chomp-jaws': 19.6, 'chomp-impact': 19.77,
    'soon-bounce': 20.2, 'soon-card': 21.8,
}


def env_decay(t, t0, tau, dur):
    d = t - t0
    return np.exp(-d / tau) if 0 <= d < dur else 0.0


def shake_amp(t):
    """(translation px, rotation deg) envelope."""
    a, r = 0.0, 0.0
    for h in M['hops'] + M.get('postHops', []):
        k = env_decay(t, h['land'], 0.06, 0.3)
        a = max(a, k * (2 + h['size'] / 90))
    if M['open'] <= t < M['jaws']:
        u = (t - M['open']) / (M['jaws'] - M['open'])
        a = max(a, 2 + 7 * u ** 1.5)
        r = max(r, 0.25 * u)
    if M['jaws'] <= t < M['impact']:
        a = max(a, 10)
        r = max(r, 0.4)
    k = env_decay(t, M['impact'], 0.17, 1.0)
    a = max(a, 48 * k)
    r = max(r, 1.8 * k)
    k = env_decay(t, CARD['soon'] + 0.12, 0.06, 0.3)  # the S lands
    a = max(a, 6 * k)
    return a, r


rs = np.random.default_rng(5)
PH = rs.uniform(0, 2 * np.pi, (3, 4))
FR = np.array([[23.0, 31.0, 47.0, 13.0], [19.0, 37.0, 53.0, 11.0], [17.0, 29.0, 41.0, 7.0]])


def shake(t):
    a, r = shake_amp(t)
    n = [(np.sin(2 * np.pi * FR[k] * t + PH[k]) * [0.45, 0.3, 0.15, 0.1]).sum() / 1.0 for k in range(3)]
    return a * n[0], a * n[1], r * n[2]


def warp(img, dx, dy, rot, extra_zoom):
    s = 1 + extra_zoom
    Mx = cv2.getRotationMatrix2D((W / 2, H / 2), rot, s)
    Mx[0, 2] += dx
    Mx[1, 2] += dy
    return cv2.warpAffine(img, Mx, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def read_video(path):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    p.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('out')
    ap.add_argument('--stills', default=None)
    a = ap.parse_args()
    face = json.load(open(os.path.join(a.work, 'face.json')))['frames']
    N = int(round(CUES['duration'] * FPS))
    ov_dir = os.path.join(a.work, 'ov-16x9')
    enc = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-i', os.path.join(a.work, 'mix.wav'),
        '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18',
        '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-shortest', a.out], stdin=subprocess.PIPE)
    vid = read_video(os.path.join(a.work, 'graded.mp4'))
    last = None
    prev_shake = (0.0, 0.0, 0.0)
    want = {int(round(v * FPS)): k for k, v in CUES.get('stills', STILLS).items()}
    for i in range(N):
        t = i / FPS
        if t < CUES['footageEnd']:
            fr = next(vid, None)
            if fr is not None:
                last = fr
        f = last.astype(np.float32) / 255
        # push-in toward her face and a creeping sun tint as the creature lunges
        if t >= M['open']:
            u = min(1.0, (t - M['open']) / (M['impact'] - M['open']))
            fi = face[min(len(face) - 1, i)]
            z = 1 + 0.07 * u ** 2
            Mz = cv2.getRotationMatrix2D((fi['cx'], fi['cy']), 0, z)
            f = cv2.warpAffine(f, Mz, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
            tint = 0.22 * max(0.0, (t - M['lunge']) / (M['impact'] - M['lunge'])) ** 1.5
            if tint > 0:
                f = f * (1 - tint) + (f * 0.35 + 0.65) * SUN * tint
        p = os.path.join(ov_dir, f'{i:05d}.png')
        ov = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if ov is not None:
            ov = ov.astype(np.float32) / 255
            if ov.shape[2] == 3:
                f = ov
            else:
                al = ov[..., 3:]
                f = f * (1 - al) + ov[..., :3] * al
        dx, dy, rot = shake(t)
        amp, _ = shake_amp(t)
        if amp > 0.5:
            zoom = (2 * amp + 4) / W * 1.2
            if amp > 12:
                # motion blur along the shake path (3 taps between the previous and current offsets)
                acc = np.zeros_like(f)
                for k, w in ((0.0, 0.25), (0.5, 0.35), (1.0, 0.4)):
                    px, py, pr = prev_shake
                    acc += w * warp(f, px + (dx - px) * (0.5 + k / 2), py + (dy - py) * (0.5 + k / 2), pr + (rot - pr) * (0.5 + k / 2), zoom)
                f = acc
            else:
                f = warp(f, dx, dy, rot, zoom)
        prev_shake = (dx, dy, rot)
        o = np.clip(f * 255 + 0.5, 0, 255).astype(np.uint8)
        enc.stdin.write(o.tobytes())
        if a.stills and i in want:
            cv2.imwrite(os.path.join(a.stills, f'{want[i]}.png'), o)
        if i % 90 == 0:
            print('frame', i, '/', N, flush=True)
    enc.stdin.close()
    enc.wait()
    print('wrote', a.out)


if __name__ == '__main__':
    main()
