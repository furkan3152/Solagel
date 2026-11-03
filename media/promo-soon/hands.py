#!/usr/bin/env python3
"""Tracks her pointing index fingertip (MediaPipe HandLandmarker) over the "Can you see that?" window,
so the creature can perch on the fingertip. Reads the graded footage (output timing).

  python3 hands.py WORKDIR [--from 16.6] [--to 19.2]  -> WORKDIR/finger.json
    {"fps": 30, "frames": {"<output frame>": {"tip": [x, y], "pip": [x, y], "mcp": [x, y], "score": s}}}
"""
import argparse
import json
import os
import subprocess

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

W, H, FPS = 1920, 1080, 30


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('--from', dest='t0', type=float, default=16.6)
    ap.add_argument('--to', dest='t1', type=float, default=19.2)
    a = ap.parse_args()
    opt = vision.HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=os.path.join(a.work, 'hand_landmarker.task')),
                                       running_mode=vision.RunningMode.VIDEO, num_hands=2,
                                       min_hand_detection_confidence=0.3, min_tracking_confidence=0.3)
    lm = vision.HandLandmarker.create_from_options(opt)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(a.t0), '-i', os.path.join(a.work, 'graded.mp4'), '-t', str(a.t1 - a.t0),
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    out = {}
    i0 = int(round(a.t0 * FPS))
    k = 0
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3:
            break
        img = np.frombuffer(b, np.uint8).reshape(H, W, 3)
        r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=img), int(k * 1000 / FPS))
        best = None
        for hl, hd in zip(r.hand_landmarks, r.handedness):
            pts = np.array([[q.x * W, q.y * H] for q in hl])
            # a pointing hand: index extended (tip far from wrist relative to the other fingertips)
            ext = np.linalg.norm(pts[8] - pts[0]) / (np.mean([np.linalg.norm(pts[j] - pts[0]) for j in (12, 16, 20)]) + 1e-6)
            sc = hd[0].score * ext
            if best is None or sc > best[0]:
                best = (sc, pts, ext)
        if best is not None and best[2] > 1.1:
            pts = best[1]
            out[str(i0 + k)] = {'tip': pts[8].tolist(), 'pip': pts[6].tolist(), 'mcp': pts[5].tolist(), 'score': float(best[0])}
        k += 1
    p.wait()
    lm.close()
    json.dump({'fps': FPS, 'frames': out}, open(os.path.join(a.work, 'finger.json'), 'w'))
    ks = sorted(int(x) for x in out)
    print(f'pointing finger found in {len(out)}/{k} frames', (ks[0] / FPS, ks[-1] / FPS) if ks else '')
    for j in ks[::6]:
        f = out[str(j)]
        print(f'  t={j / FPS:.2f} tip=({f["tip"][0]:.0f},{f["tip"][1]:.0f}) mcp=({f["mcp"][0]:.0f},{f["mcp"][1]:.0f})')


if __name__ == '__main__':
    main()
