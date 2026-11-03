#!/usr/bin/env python3
"""Soft "baby face" beauty pass + gentle grade for the Elymum SOON promo.

Reads the source clip (START..END), finds the face per frame with MediaPipe FaceLandmarker,
smooths the landmarks over time (centred Gaussian, no lag), builds a feathered skin mask
(face oval minus eyes, brows, lips, gated by skin colour), then applies edge-preserving
smoothing (guided filter) with micro texture added back, a little glow and lift on the skin,
and a gentle global grade (lifted shadows, warm balance, soft bloom, vignette).

Writes  <work>/graded.mp4  (near-lossless intermediate, same timing as the source window)
        <work>/face.json    (per-frame face centre / width, for the vertical crop and the monster's gaze)
        <work>/before_after.png

usage: python3 beauty.py SRC WORKDIR [--start 16.8] [--end 36.8] [--model face_landmarker.task]
"""
import argparse
import json
import os
import subprocess

import cv2
import numpy as np

W, H, FPS = 1920, 1080, 30

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
             150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EYE_L = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]
EYE_R = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
BROW_L = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
BROW_R = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
NOSTRILS = [98, 97, 2, 326, 327, 294, 278, 344, 440, 275, 4, 45, 220, 115, 48, 64]
CHEEKS = [50, 280, 101, 330, 205, 425]


def read_frames(src, start, end):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{start}', '-i', src, '-t', f'{end - start}', '-f', 'rawvideo',
           '-pix_fmt', 'bgr24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    p.wait()


def detect_all(src, start, end, model):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    opt = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=model),
                                       running_mode=vision.RunningMode.VIDEO, num_faces=1,
                                       min_face_detection_confidence=0.3, min_tracking_confidence=0.3)
    lm = vision.FaceLandmarker.create_from_options(opt)
    pts = []
    for i, f in enumerate(read_frames(src, start, end)):
        r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)),
                                int(i * 1000 / FPS))
        if r.face_landmarks:
            pts.append(np.array([[q.x * W, q.y * H] for q in r.face_landmarks[0]], np.float32))
        else:
            pts.append(None)
    lm.close()
    # fill gaps with the nearest detection
    idx = [i for i, p in enumerate(pts) if p is not None]
    if not idx:
        raise SystemExit('no face found')
    for i in range(len(pts)):
        if pts[i] is None:
            j = min(idx, key=lambda k: abs(k - i))
            pts[i] = pts[j]
    A = np.stack(pts)  # (N, 478, 2)
    # centred temporal smoothing (sigma 1.2 frames): kills jitter without lag
    k = np.exp(-0.5 * (np.arange(-4, 5) / 1.2) ** 2)
    k /= k.sum()
    pad = np.concatenate([A[:1].repeat(4, 0), A, A[-1:].repeat(4, 0)])
    S = np.zeros_like(A)
    for j, w in enumerate(k):
        S += w * pad[j:j + len(A)]
    return S, len(idx), len(A)


def poly(mask, p, idx, val=1.0):
    cv2.fillPoly(mask, [np.round(p[idx]).astype(np.int32)], val, lineType=cv2.LINE_AA)


def hull(mask, p, idx, val=0.0):
    h = cv2.convexHull(np.round(p[idx]).astype(np.int32))
    cv2.fillConvexPoly(mask, h, val, lineType=cv2.LINE_AA)


def skin_mask(p, frame_f):
    """Feathered skin mask (float32 HxW, 0..1) and the ROI it lives in."""
    fw = float(np.linalg.norm(p[454] - p[234]))  # face width
    x0, y0 = p[FACE_OVAL].min(0) - fw * 0.15
    x1, y1 = p[FACE_OVAL].max(0) + fw * 0.15
    x0, y0 = int(max(0, x0)), int(max(0, y0))
    x1, y1 = int(min(W, x1)), int(min(H, y1))
    q = p - [x0, y0]
    h, w = y1 - y0, x1 - x0
    m = np.zeros((h, w), np.float32)
    poly(m, q, FACE_OVAL, 1.0)
    m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, int(fw * 0.04)) | 1,) * 2))
    hole = np.zeros((h, w), np.float32)
    for e in (EYE_L, EYE_R):
        hull(hole, q, e, 1.0)
    for b in (BROW_L, BROW_R):
        hull(hole, q, b, 1.0)
    hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(fw * 0.07) | 1,) * 2))
    lips = np.zeros((h, w), np.float32)
    poly(lips, q, LIPS, 1.0)
    lips = cv2.dilate(lips, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(fw * 0.035) | 1,) * 2))
    nos = np.zeros((h, w), np.float32)
    hull(nos, q, NOSTRILS, 1.0)
    m = m * (1 - np.maximum(hole, lips)) * (1 - 0.5 * nos)
    m = cv2.GaussianBlur(m, (0, 0), fw * 0.03)
    # skin-colour gate (soft): distance to the cheek colour in CrCb
    roi = frame_f[y0:y1, x0:x1]
    ycc = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    ref = []
    for c in CHEEKS:
        cx, cy = np.round(q[c]).astype(int)
        cx, cy = np.clip(cx, 2, w - 3), np.clip(cy, 2, h - 3)
        ref.append(ycc[cy - 2:cy + 3, cx - 2:cx + 3, 1:].reshape(-1, 2))
    ref = np.median(np.concatenate(ref), 0)
    d = np.linalg.norm(ycc[..., 1:] - ref, axis=-1)
    gate = np.exp(-0.5 * (d / 0.045) ** 2)
    gate = cv2.GaussianBlur(gate, (0, 0), 2.0)
    m = m * (0.25 + 0.75 * gate)
    return m, (x0, y0, x1, y1), fw


def beauty(frame, p):
    f = frame.astype(np.float32) / 255.0
    m, (x0, y0, x1, y1), fw = skin_mask(p, f)
    roi = f[y0:y1, x0:x1]
    r = max(4, int(fw * 0.022))
    gf = cv2.ximgproc.guidedFilter(roi, roi, r, 0.0012)
    fine = roi - cv2.GaussianBlur(roi, (0, 0), 0.9)  # pores / grain: keep a bit so it does not go plastic
    smooth = gf + 0.6 * fine
    # a touch of lift, glow and warmth on the skin only
    glow = cv2.GaussianBlur(smooth, (0, 0), fw * 0.02)
    smooth = 1 - (1 - smooth) * (1 - 0.05 * glow)  # screen
    smooth = smooth + 0.012 * (1 - smooth)
    smooth = smooth * np.array([0.985, 1.0, 1.012], np.float32)  # BGR: a hair warmer
    a = (0.5 * m)[..., None]
    out = f.copy()
    out[y0:y1, x0:x1] = roi + a * (smooth - roi)
    return out


def make_grade():
    x = np.arange(256, dtype=np.float32) / 255.0
    lift = x + 0.07 * (1 - x) ** 3 * x ** 0.5 * 2.2  # shadows up, blacks kept
    lift = np.clip(lift, 0, 1) ** 0.98
    b = np.clip(lift * 0.985, 0, 1)
    g = np.clip(lift * 1.0, 0, 1)
    r = np.clip(lift * 1.01 + 0.004, 0, 1)
    return [np.clip(c * 255 + 0.5, 0, 255).astype(np.uint8) for c in (b, g, r)]


def grade(f, luts, vig):
    u8 = np.clip(f * 255 + 0.5, 0, 255).astype(np.uint8)
    u8 = cv2.merge([cv2.LUT(c, l) for c, l in zip(cv2.split(u8), luts)])
    g = u8.astype(np.float32) / 255
    # soft bloom (pro-mist): screen a blurred copy of the highlights
    small = cv2.resize(g, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    hi = np.clip((small - 0.55) / 0.45, 0, 1)
    hi = cv2.GaussianBlur(hi, (0, 0), 9)
    hi = cv2.resize(hi, (W, H), interpolation=cv2.INTER_LINEAR)
    g = 1 - (1 - g) * (1 - 0.10 * hi)
    # slight desaturation of the very red/pink wall-cast, keep skin warm
    gray = g.mean(-1, keepdims=True)
    g = gray + 0.95 * (g - gray)
    g = g * vig
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('work')
    ap.add_argument('--start', type=float, default=16.8)
    ap.add_argument('--end', type=float, default=36.8)
    ap.add_argument('--model', default=None)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    model = a.model or os.path.join(a.work, 'face_landmarker.task')
    S, found, n = detect_all(a.src, a.start, a.end, model)
    print(f'landmarks: face found in {found}/{n} frames')
    face = [{'cx': float(p[FACE_OVAL, 0].mean()), 'cy': float(p[FACE_OVAL, 1].mean()),
             'w': float(np.linalg.norm(p[454] - p[234])), 'eyes_y': float((p[159, 1] + p[386, 1]) / 2)} for p in S]
    json.dump({'start': a.start, 'fps': FPS, 'frames': face}, open(os.path.join(a.work, 'face.json'), 'w'))

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H * 0.45) / (H / 2)) ** 2)
    vig = (1 - 0.20 * np.clip(rr - 0.35, 0, None) ** 1.6)[..., None].astype(np.float32)
    luts = make_grade()

    out = os.path.join(a.work, 'graded.mp4')
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}',
                            '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'fast', '-crf', '9',
                            '-pix_fmt', 'yuv444p', out], stdin=subprocess.PIPE)
    ba_t = 3.6  # before/after still
    for i, fr in enumerate(read_frames(a.src, a.start, a.end)):
        if i >= len(S):
            break
        b = beauty(fr, S[i])
        g = grade(b, luts, vig)
        o = np.clip(g * 255 + 0.5, 0, 255).astype(np.uint8)
        enc.stdin.write(o.tobytes())
        if i == int(ba_t * FPS):
            p = S[i]
            cx, cy = int(p[FACE_OVAL, 0].mean()), int(p[FACE_OVAL, 1].mean())
            x0, y0 = max(0, cx - 330), max(0, cy - 380)
            A = fr[y0:y0 + 760, x0:x0 + 660]
            B = o[y0:y0 + 760, x0:x0 + 660]
            cv2.imwrite(os.path.join(a.work, 'before_after.png'), np.concatenate([A, np.full((760, 8, 3), 255, np.uint8), B], 1))
            cv2.imwrite(os.path.join(a.work, 'before_full.png'), fr)
            cv2.imwrite(os.path.join(a.work, 'after_full.png'), o)
        if i % 60 == 0:
            print('frame', i, flush=True)
    enc.stdin.close()
    enc.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
