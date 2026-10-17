# Slana gameplay video (Video A)

A cut of one real paid round in Penny Pond, about 64 s, 1920x1080, 30 fps,
H.264 + AAC, -14 LUFS: a mid-round join (the round chip), loot swept up, she
eats a player, a bot eats Daphne and she buys back in, the final minute (joins
closed), the last ten seconds, the bell and the "Round over" receipt with the
PAID stamp. Cuts sit on the bar lines of the game's own score (82 BPM). It is in
the same Paper Ticket language as the promo (`media/promo`): riso wordmark
with a teal ghost and pink misregistration, mono kickers with a pink dot,
ticket lower-thirds, stamps, tape and a perforated paper wipe.

This folder also holds the capture and render kit that the how-to-play video
(`media/how-to-play`) uses.

## Layout

| Path | What it is |
| --- | --- |
| `capture/lib.mjs` | Playwright kit. `Player` drives the real app (dev wallet, lobby, tickets, "Buy back in", held tickets, an in-page steering brain that eats, flees and seeks open water) and reads the arena round clock (`round()`, `untilRound()`). `Recorder` records a take: CDP screencast frames with their times, the game audio from the dev tap (`window.__slanaAudioTap`), and a 10 Hz telemetry log (HUD, the round's time left and phase, where Daphne, prey, threats and loot are on screen) plus store events (value floats, kills, rank, banners, the bell's round result, held tickets). |
| `capture/take-*.mjs` | One script per take: `arena` (a whole round: four staged rival wallets with real tickets, Daphne joins mid-round, eats, splits, buys back in if eaten, plays safe through the final minute, the bell, the receipt; run twice as `arena` and `arena2`), `loot` (a rival runs into a bot near Daphne, she sweeps the loot), `spill` (a bot eats Daphne, "Buy back in", the same round again), `held` (the lobby in a final minute: joins closed, a held ticket that joins the next round by itself), `practice` (growth, controls, cacti, coin rain), `controls` and `split` (optional extras), `lobby` (tickets, wallet, ticket sheet, the four arenas, ranks, guide), `music` (the score only, no video). The round takes wait for the right moment of the wall-clock round. |
| `capture/take-all.sh` | Records every take in turn. |
| `capture/pack.mjs` | Packs a take's JPEGs into `video.mkv` (CRF 18, one frame per screencast frame) and deletes them. True capture times stay in `frames.json`. |
| `capture/trim.py` | Drops unused time ranges of a packed take to save disk; the timeline stays valid. |
| `motion/motion.html`, `motion/motion.js` | The motion graphics: deterministic components (cards, wipes, lower-thirds, kickers, stamps, keycaps, mouse, hand-drawn rings, arrows and boxes, captions, receipts, fee-split bar, rank counter, the eating-rule diagram) drawn as a pure function of time. Coin characters come from `packages/art` (`motion/build-art.mjs`). |
| `render/timeline.mjs` | Edit toolkit: shots with speed ramps (integrated time maps), smart reframing from the telemetry (follows Daphne, leans toward nearby prey, threats and loot, critically damped), camera keyframes, punch-ins, shake, tracking helpers. |
| `render/overlays.mjs` | Renders the graphics layer frame by frame in headless Chromium. |
| `render/compose.py` | Picture: reframed footage (sub-pixel bicubic, sharpened on punch-ins, frame-blended slow motion) + graphics, piped to x264. |
| `render/sfx.py` | Procedural sound design (whooshes, impacts, stamps, paper, ticks, pops, coins, risers, printer, ka-ching, drum kit). |
| `render/audio.py` | Mix: varispeed take audio, cues, VO chain (same as the promo's), music with ducking, limiter, two-pass loudnorm to -14 LUFS / -1.5 dBTP. |
| `render/render.sh` | One edit to finished files (master and a < 30 MB web copy). |
| `edit.mjs` | Video A's edit decision list. |
| `tools/peek.py` | Tiles frames of takes at given times, for picking shots. |

`cache/` is gitignored: Python venv, Kokoro models, takes, edits, renders.

## Re-render

```bash
# 0. once: python env and the art bundle
python3 -m venv media/gameplay/cache/venv
media/gameplay/cache/venv/bin/pip install kokoro-onnx soundfile scipy numpy pillow
node media/gameplay/motion/build-art.mjs

# 1. takes (needs `pnpm demo` running with the default 5-minute rounds; ports 5173 and 8787 free first).
#    The game is admin-only by default; GAME_PUBLIC=1 opens it for the capture wallets.
GAME_PUBLIC=1 pnpm demo &                     # fake chain
media/gameplay/capture/take-all.sh            # ~45 min; logs in media/gameplay/cache/*.log
node media/gameplay/capture/take-arena.mjs --name arena2   # the second round take
node media/gameplay/capture/take-loot.mjs --name loot
# (or one take: node media/gameplay/capture/take-arena.mjs --name arena)

# 2. the cut and the render
node media/gameplay/edit.mjs
media/gameplay/render/render.sh media/gameplay/cache/edit/gameplay.json \
  media/gameplay/cache/edit/gameplay-music.json slana-gameplay
# -> out/videos/slana-gameplay.mp4 (web, < 30 MB) and slana-gameplay-master.mp4
```

Takes are live play, so a new recording tells a slightly different story.
`edit.mjs` finds its moments by marks and events (the mid-round join, the
loot pickups, the first player she eats, the death and the buy-back, the final
minute, the bell, the PAID stamp). A new recording tells a different story, so
check new takes with `tools/peek.py`. The delivered cut uses `arena2` (a round
she survives to the bell) and `arena` (a round where a bot eats her and she
buys back in).

## Notes

- Capture runs at about 25-45 fps (software raster at 1080p on 4 cores);
  everything is conformed to 30 fps by capture time, not frame count.
- Disk: a take's screencast JPEGs (quality `JPEG_Q`, default 80) take about
  10 MB per second of capture until `pack.mjs` replaces them with the mezzanine
  (about 4-5 MB per second); keep 4 GB free for a whole-round take.
- Rounds are wall-clock aligned (`ROUND_SECONDS`, default 300). The takes use
  the default so the round chip shows real five-minute times.
- The rivals (`mochi_moon`, `bonk_bae`, `lil_lamport`, `rug_ruth`) are real wallets with
  real (fake-chain) tickets, played by the capture script. Bots are the
  game's own.
- The end card reads slana.io and @slanaio (X).
- Colours follow the vivid palette (`docs/design/palette.md`, `packages/shared/src/palette.ts`);
  `motion/` repeats the hex values, so update both when the palette moves.
