#!/usr/bin/env bash
# Cuts the gameplay shots listed in timeline.json ("footage") out of the
# source recordings into cache/footage/<id>/NNNN.jpg (30 fps, 1280x720).
#   render/extract-footage.sh walkthrough=/path/to/slana-full-walkthrough.mp4 [name=path ...]
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-/usr/bin/ffmpeg}
declare -A SRC
for kv in "$@"; do SRC[${kv%%=*}]=${kv#*=}; done
python3 - <<'PY' > cache/.shots
import json
for s in json.load(open('timeline.json'))['footage']:
    print(s['id'], s['src'], s['start'], s['dur'])
PY
while read -r id src start dur; do
  in=${SRC[$src]:-}
  [ -n "$in" ] || { echo "no source given for '$src' (pass $src=/path.mp4)"; exit 1; }
  rm -rf "cache/footage/$id"; mkdir -p "cache/footage/$id"
  "$FFMPEG" -nostdin -v error -y -ss "$start" -t "$dur" -i "$in" -vf "fps=30,scale=1280:720:flags=lanczos" -q:v 2 "cache/footage/$id/%04d.jpg"
  echo "shot $id: $(ls cache/footage/$id | wc -l) frames"
done < cache/.shots
