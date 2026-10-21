#!/usr/bin/env bash
# Muxes cache/video.mp4 + cache/audio/final.wav into the deliverables:
#   out/videos/slana-promo-master.mp4  (H.264 High, CRF 17, AAC 192k)  — archive / re-edit
#   out/videos/slana-promo.mp4         (two-pass 5 Mb/s, AAC 192k, < 30 MB) — the one to post
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-/usr/bin/ffmpeg}
OUT=../../out/videos
mkdir -p "$OUT" cache/pass
V=cache/video.mp4
# -14 LUFS, true peak at or below -1.5 dBTP measured after AAC encoding
../gameplay/cache/venv/bin/python ../gameplay/render/finalize.py cache/audio/final.wav cache/audio/final-tp.wav
A=cache/audio/final-tp.wav
common=(-pix_fmt yuv420p -r 60 -profile:v high -level 4.2 -g 120 -bf 3 -color_primaries bt709 -color_trc bt709 -colorspace bt709)
"$FFMPEG" -v error -y -i "$V" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 17 "${common[@]}" \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/slana-promo-master.mp4"
"$FFMPEG" -v error -y -i "$V" -an -c:v libx264 -preset slow -b:v 5000k -maxrate 8000k -bufsize 10000k "${common[@]}" \
  -pass 1 -passlogfile cache/pass/x264 -f mp4 /dev/null
"$FFMPEG" -v error -y -i "$V" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -b:v 5000k -maxrate 8000k -bufsize 10000k "${common[@]}" \
  -pass 2 -passlogfile cache/pass/x264 -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/slana-promo.mp4"
ls -la "$OUT"/slana-promo*.mp4
