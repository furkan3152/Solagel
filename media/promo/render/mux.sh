#!/usr/bin/env bash
# Muxes cache/video.mp4 + cache/audio/final.wav into the deliverables:
#   out/videos/elymum-promo-master.mp4  (H.264 High, CRF 17, AAC 192k): archive / re-edit
#   out/videos/elymum-promo.mp4         (two-pass, about 27.8 MB, AAC 192k, < 30 MB): the one to post
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-/usr/bin/ffmpeg}
OUT=../../out/videos
mkdir -p "$OUT" cache/pass
V=cache/video.mp4
# -14 LUFS, true peak at or below -1.5 dBTP measured after AAC encoding
../gameplay/cache/venv/bin/python ../gameplay/render/finalize.py cache/audio/final.wav cache/audio/final-tp.wav
A=cache/audio/final-tp.wav
# the web copy's video bitrate: 26.5 MiB in all (under 30 MB) for the cut's length, less the audio
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V")
VB=$(python3 -c "print(int((26.5*8*1048576/$DUR - 192000*1.02)/1000))")
common=(-pix_fmt yuv420p -r 60 -profile:v high -level 4.2 -g 120 -bf 3 -color_primaries bt709 -color_trc bt709 -colorspace bt709)
"$FFMPEG" -v error -y -i "$V" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 17 "${common[@]}" \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/elymum-promo-master.mp4"
"$FFMPEG" -v error -y -i "$V" -an -c:v libx264 -preset slow -b:v ${VB}k -maxrate $((VB*8/5))k -bufsize $((VB*2))k "${common[@]}" \
  -pass 1 -passlogfile cache/pass/x264 -f mp4 /dev/null
"$FFMPEG" -v error -y -i "$V" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -b:v ${VB}k -maxrate $((VB*8/5))k -bufsize $((VB*2))k "${common[@]}" \
  -pass 2 -passlogfile cache/pass/x264 -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/elymum-promo.mp4"
ls -la "$OUT"/elymum-promo*.mp4
