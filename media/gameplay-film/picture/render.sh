#!/usr/bin/env bash
# The narrated gameplay film, end to end (after the takes: take-site.mjs, take-arena.mjs).
# Needs the fake-chain stack the takes were recorded on (web on FILM_WEB, default localhost:5437).
set -euo pipefail
cd "$(dirname "$0")"
W=${FILM_WORK:-../../../out/work/film}
# the end card is a page of its own, served by the web dev server
ln -sfn "$(cd ../../../apps/web && pwd)/node_modules" endcard/node_modules
mkdir -p "$W/takes/card"
node -e "
const fs=require('fs');const w=process.argv[1];const url=(process.env.FILM_WEB||'http://localhost:5437')+'/@fs'+require('path').resolve('endcard/index.html');
fs.writeFileSync(w+'/takes/card/events.json',JSON.stringify({name:'card',kind:'card',w:1920,h:1080,t0:1000,journal:'journal.jsonl',marks:[]}));
fs.writeFileSync(w+'/takes/card/journal.jsonl',JSON.stringify({k:'clock',perf:0,date:1000000,href:url})+'\n');" "$W"
rm -f "$W"/edit/times-*.json
node edit.mjs ${EDIT_ARGS:-}
for f in "$W"/edit/times-*.json; do
  t=$(basename "$f" .json); t=${t#times-}
  rm -rf "$W/frames/$t"
  node replay.mjs "$t" "$W/edit/times-$t.json" "$W/frames/$t"
done
node compose.mjs
