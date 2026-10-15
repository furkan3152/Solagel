# Slana gameplay video (Video A)

A cut of real play in Penny Pond, about 72 s, 1920x1080, 30 fps, H.264 + AAC,
-14 LUFS. Cuts sit on the bar lines of the game's own score (82 BPM). It is in
the same Paper Ticket language as the promo (`media/promo`): riso wordmark
with a teal ghost and pink misregistration, mono kickers with a pink dot,
ticket lower-thirds, stamps, tape and a perforated paper wipe.

This folder also holds the capture and render kit that the how-to-play video
(`media/how-to-play`) uses.

## Layout

| Path | What it is |
| --- | --- |
| `capture/lib.mjs` | Playwright kit. `Player` drives the real app (dev wallet, lobby, tickets, an in-page steering brain that eats, flees and seeks open water). `Recorder` records a take: CDP screencast frames with their times, the game audio from the dev tap (`window.__slanaAudioTap`), and a 10 Hz telemetry log (HUD, where Daphne, prey, threats and loot are on screen) plus store events (value floats, kills, rank, banners, cash-out). |
| `capture/take-*.mjs` | One script per take: `arena` (Daphne and three staged rival wallets with real tickets in Penny Pond; loot, rank climb, cash-out), `practice` (growth, cacti, coin rain), `controls` (each control on its own), `split` (split-catches), `spill` (a bot eats Daphne, tokens spill), `lobby` (tickets, wallet, ticket sheet, Pass, ranks, guide), `music` (the score only, no video). |
| `capture/take-all.sh` | Records every take in turn. |
| `capture/pack.mjs` | Packs a take's JPEGs into `video.mkv` (one frame per screencast frame) and deletes them. True capture times stay in `frames.json`. |
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

# 1. takes (needs `pnpm demo` running; ports 5173 and 8787 free first)
pnpm demo &                                   # fake chain
media/gameplay/capture/take-all.sh            # ~40 min; logs in media/gameplay/cache/*.log
# (or one take: node media/gameplay/capture/take-arena.mjs --name arena)

# 2. the cut and the render
node media/gameplay/edit.mjs
media/gameplay/render/render.sh media/gameplay/cache/edit/gameplay.json \
  media/gameplay/cache/edit/gameplay-music.json slana-gameplay
# -> out/videos/slana-gameplay.mp4 (web, < 30 MB) and slana-gameplay-master.mp4
```

Takes are live play, so a new recording tells a slightly different story.
`edit.mjs` finds its moments by marks and events (the split that caught
something, the cash-out, the PAID time), but some shot times are literal
source seconds picked from contact sheets of the takes used for the delivered
cut (`arena`, `arena-t4`, `arena-t7`, `split`). After recording new takes,
check them with `tools/peek.py` and update those times.

## Notes

- Capture runs at about 25-45 fps (software raster at 1080p on 4 cores);
  everything is conformed to 30 fps by capture time, not frame count.
- The rivals (`mochi_moon`, `bonk_bae`, `lil_lamport`) are real wallets with
  real (fake-chain) tickets, played by the capture script. Bots are the
  game's own.
- `slana.xyz` on the end card is the promo's placeholder URL.
