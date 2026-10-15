#!/usr/bin/env bash
# Records every take the two videos use, one after another (each packs itself when done).
# Needs `pnpm demo` running (fake chain). Logs go to media/gameplay/cache/<take>.log.
set -u
cd "$(dirname "$0")/../../.."
C=media/gameplay/capture
L=media/gameplay/cache
nice -n -10 node $C/take-arena.mjs --name arena "$@" > $L/arena.log 2>&1
nice -n -10 node $C/take-lobby.mjs --name lobby --fresh > $L/lobby.log 2>&1
nice -n -10 node $C/take-practice.mjs --name practice > $L/practice.log 2>&1
nice -n -10 node $C/take-spill.mjs --name spill > $L/spill.log 2>&1
nice -n -10 node $C/take-music.mjs > $L/music.log 2>&1
