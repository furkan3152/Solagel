#!/usr/bin/env bash
# Renders one edit to finished files.
#   render/render.sh <edit.json> <music.json> <out-name> [vo-dir]
# Steps: graphics (overlays.mjs) -> picture (compose.py) -> soundtrack (audio.py, -14 LUFS)
# -> out/videos/<out-name>-master.mp4 (CRF 17) and out/videos/<out-name>.mp4 (two-pass, < 30 MB).
# Env: SKIP_OVERLAYS=1 / SKIP_PICTURE=1 / SKIP_AUDIO=1 to reuse a previous step.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PY="$ROOT/media/gameplay/cache/venv/bin/python"
FF="${FFMPEG:-/usr/bin/ffmpeg}"
EDIT="$(realpath "$1")"; MUSIC="$(realpath "$2")"; NAME="$3"; VO="${4:-}"
WORK="$(dirname "$EDIT")/$NAME"
OUT="$ROOT/out/videos"
mkdir -p "$WORK" "$OUT"
DUR=$(node -e "console.log(require('$EDIT').duration)")
FPS=$(node -e "console.log(require('$EDIT').fps)")

if [ -z "${SKIP_OVERLAYS:-}" ]; then
  rm -rf "$WORK/ov"
  nice -n 5 node "$HERE/overlays.mjs" "$EDIT" "$WORK/ov" --pages 3
fi
if [ -z "${SKIP_PICTURE:-}" ]; then
  nice -n 5 "$PY" "$HERE/compose.py" "$EDIT" "$WORK/ov" "$WORK/picture.mp4" --crf 14 2>&1 | grep -v "Broken pipe\|muxing a packet\|trailer\|closing file" || true
fi
if [ -z "${SKIP_AUDIO:-}" ]; then
  "$PY" "$HERE/audio.py" "$EDIT" "$WORK/mix.wav" --music "$MUSIC" --stems "$WORK/stems" ${VO:+--vo-dir "$VO"} ${AUDIO_ARGS:-} | tee "$WORK/loudness.json"
  # -14 LUFS with the true peak at or below -1.5 dBTP measured after AAC encoding
  "$PY" "$HERE/finalize.py" "$WORK/mix.wav" "$WORK/mix-final.wav" | tee -a "$WORK/loudness.json"
fi

# master: high quality
"$FF" -hide_banner -loglevel error -y -i "$WORK/picture.mp4" -i "$WORK/mix-final.wav" -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 17 -tune animation -pix_fmt yuv420p -r $FPS -g $((FPS * 2)) -profile:v high -level 4.2 \
  -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest "$OUT/$NAME-master.mp4"
# web: two-pass to about 28 MB (under 30 MB) with 192 kb/s audio
VB=$(node -e "console.log(Math.floor((26.5*8*1024*1024/$DUR - 192000*1.02)/1000))")
cd "$WORK"
"$FF" -hide_banner -loglevel error -y -i picture.mp4 -c:v libx264 -preset slow -tune animation -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -pix_fmt yuv420p -r $FPS -g $((FPS * 2)) -pass 1 -passlogfile x264 -an -f mp4 /dev/null
"$FF" -hide_banner -loglevel error -y -i picture.mp4 -i mix-final.wav -map 0:v -map 1:a -c:v libx264 -preset slow -tune animation -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -pix_fmt yuv420p -r $FPS -g $((FPS * 2)) -pass 2 -passlogfile x264 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$OUT/$NAME.mp4"
rm -f x264*.log x264*.mbtree
ls -la "$OUT/$NAME.mp4" "$OUT/$NAME-master.mp4"
