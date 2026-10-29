#!/usr/bin/env bash
# Renders a short motion-graphics film (the mint film, Roadmap Chomp) to finished files.
#   media/mint-film/render.sh <project-dir> <out-name> <variant:WxH:suffix> [...]
#   e.g. media/mint-film/render.sh media/mint-film elymum-mint-film 1920x1080: 1080x1920:-vertical
# Steps: picture per variant (media/promo/render/render.mjs --project, 60 fps, near-lossless)
# -> score (<project>/audio/music.py) -> mix (media/mint-film/audio/mix.py) -> -14 LUFS with the true
# peak at or below -1.5 dBTP after AAC (media/gameplay/render/finalize.py)
# -> out/videos/<name><suffix>-master.mp4 (CRF 12) and out/videos/<name><suffix>.mp4 (two-pass, < 30 MB).
# Env: SKIP_PICTURE=1 / SKIP_AUDIO=1 to reuse a previous step, WORKERS (default 3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJ="$(realpath "$1")"; NAME="$2"; shift 2
PY="$ROOT/media/gameplay/cache/venv/bin/python"
FF="${FFMPEG:-/usr/bin/ffmpeg}"
OUT="$ROOT/out/videos"
mkdir -p "$OUT" "$PROJ/cache/audio" "$PROJ/cache/pass"
FPS=$(node -e "console.log(require('$PROJ/timeline.json').fps)")
DUR=$(node -e "console.log(require('$PROJ/timeline.json').duration)")
if [ -z "${SKIP_AUDIO:-}" ]; then
  "$PY" "$PROJ/audio/music.py" "$PROJ/cache/audio/music.wav"
  "$PY" "$ROOT/media/mint-film/audio/mix.py" "$PROJ"
  "$PY" "$ROOT/media/gameplay/render/finalize.py" "$PROJ/cache/audio/premix.wav" "$PROJ/cache/audio/final.wav" | tee "$PROJ/cache/audio/loudness.json"
fi
A="$PROJ/cache/audio/final.wav"
for v in "$@"; do
  IFS=: read -r size suffix <<< "$v"
  w=${size%x*}; h=${size#*x}
  PIC="$PROJ/cache/picture-$w"x"$h.mp4"
  if [ -z "${SKIP_PICTURE:-}" ]; then
    nice -n 5 node "$ROOT/media/promo/render/render.mjs" --project "$PROJ" --w "$w" --h "$h" --workers "${WORKERS:-3}" --out "$PIC"
  fi
  common=(-pix_fmt yuv420p -r "$FPS" -g $((FPS * 2)) -bf 3 -profile:v high -level 4.2 -color_primaries bt709 -color_trc bt709 -colorspace bt709)
  "$FF" -hide_banner -loglevel error -y -i "$PIC" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 12 -tune animation "${common[@]}" \
    -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/$NAME$suffix-master.mp4"
  VB=$(node -e "console.log(Math.min(14000, Math.floor((26.5*8*1024*1024/$DUR - 192000*1.02)/1000)))")
  "$FF" -hide_banner -loglevel error -y -i "$PIC" -an -c:v libx264 -preset slow -tune animation -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k "${common[@]}" \
    -pass 1 -passlogfile "$PROJ/cache/pass/x264" -f mp4 /dev/null
  "$FF" -hide_banner -loglevel error -y -i "$PIC" -i "$A" -map 0:v -map 1:a -c:v libx264 -preset slow -tune animation -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k "${common[@]}" \
    -pass 2 -passlogfile "$PROJ/cache/pass/x264" -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT/$NAME$suffix.mp4"
  rm -f "$PROJ"/cache/pass/x264*
  ls -la "$OUT/$NAME$suffix.mp4" "$OUT/$NAME$suffix-master.mp4"
done
