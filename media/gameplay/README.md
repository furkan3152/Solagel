# Slana gameplay video (Video A)

A cut of a real paid round in Penny Pond, about 57 s, 1920x1080, **60 fps**, H.264 + AAC, -14 LUFS
(true peak at or below -1.5 dBTP after encoding): a mid-round join (the round chip), she eats a
player (slow motion through the gulp, a punch-in and the value floating off the coin), loot swept
up, a bot eats her and she buys back in, the final minute (joins closed), the last ten seconds with
a last gulp four seconds before the bell, the bell and the "Round over" receipt with the PAID stamp.
Cuts sit on the bar lines of the game's own score (82 BPM). It is in the same Paper Ticket language
as the promo (`media/promo`): riso wordmark with a teal ghost and pink misregistration, mono
kickers with a pink dot, ticket lower-thirds, stamps, value floats, tape and a perforated paper wipe.

## Deterministic capture

The footage is not a screen recording. A take records a **journal** of what the page received
(`capture/journal.mjs`): every WebSocket message and fetch response with its time, every input
event, and the clock. The recording page draws nothing, so the machine stays light and the times
stay true. `capture/replay.mjs` then plays the journal into a fresh page on a **virtual clock**
(`performance.now`, `Date`, timers, `requestAnimationFrame`, CSS and Web Animations all follow it)
and screenshots every frame at an exact time: 1/60 s apart, 1/240 s inside slow-motion windows,
plus the exact source time of every output frame an edit asks for, at 2x (arena) or 1.5x (UI)
resolution. The game client only interpolates server snapshots, so the replay is the take: the
coin positions match the live telemetry to a pixel or two. Nothing in `apps/web` changes; both
halves are Playwright init scripts.

This folder also holds the capture and render kit that the how-to-play video
(`media/how-to-play`) uses.

## Layout

| Path | What it is |
| --- | --- |
| `capture/lib.mjs` | Playwright kit. `Player` drives the real app (dev wallet, lobby, tickets, "Buy back in", held tickets, an in-page steering brain that eats, flees, seeks open water and keeps away from the world edge) and reads the arena round clock (`round()`, `untilRound()`). `Recorder` records a take: the journal (a player opened with `journal`), the game audio from the dev tap (`window.__slanaAudioTap`), and a 10 Hz telemetry log (HUD, the round's time left and phase, where Daphne, prey, threats and loot are on screen) plus store events (value floats, kills, rank, banners, the bell's round result, held tickets). |
| `capture/journal.mjs` | The journal recorder (WebSockets, fetch, input, clock) and the replay shim (virtual clock, journal-fed WebSocket and fetch, animations on the virtual clock). |
| `capture/replay.mjs` | Renders a journal take: `--edit a.json,b.json` captures every source span the edits use (padded), at 60 fps, 240 fps where a shot runs slower than 0.75x, and each output frame's exact source time. Writes `video.mkv`, `frames.json`, `pts.json` and `fsamples.json` (per-frame telemetry: the coin on screen, the camera, the world size). |
| `capture/take-*.mjs` | One script per take: `arena` (a whole round: five staged rival wallets with real tickets, Daphne joins mid-round, eats, buys back in if eaten, plays safe through the final minute, a rival comes at her in the last seconds, the bell, the receipt; recorded twice as `arena` and `arena2`), `spill` (a bot eats Daphne, "Buy back in", the same round again), `held` (the lobby in a final minute: joins closed, a held ticket that joins the next round by itself), `practice` (growth, controls, cacti, coin rain; the coin is steered back to open water before each beat), `lobby` (tickets, wallet, ticket sheet, the four arenas, ranks, guide), `music` (the score only, no video). The round takes wait for the right moment of the wall-clock round. |
| `capture/take-all.sh` | Records every take in turn. |
| `capture/pack.mjs`, `capture/trim.py` | For the older screencast takes (unused by journal takes). |
| `motion/motion.html`, `motion/motion.js` | The motion graphics: deterministic components (cards, wipes, lower-thirds, kickers, stamps, keycaps, mouse, hand-drawn rings, arrows and boxes, captions, receipts, fee-split bar, rank counter, the eating-rule diagram, value floats, the riso kinetic headline) drawn as a pure function of time, at any frame size (`?w=&h=`). Coin characters come from `packages/art` (`motion/build-art.mjs`). |
| `render/timeline.mjs` | Edit toolkit: shots with speed ramps (integrated time maps), smart reframing from the telemetry (follows Daphne, leans toward nearby prey, threats and loot, critically damped), camera keyframes, punch-ins, shake, tracking helpers. On replayed takes the reframing never shows the world edge: it zooms in and slides so the crop stays inside the world (per-frame camera telemetry). The output frame may differ from the source (the promo's vertical cut). |
| `render/overlays.mjs` | Renders the graphics layer frame by frame in headless Chromium (any frame size). |
| `render/compose.py` | Picture: reframed footage (an antialiased resample of the crop box from the high-resolution replay, exact frames, sharpened on punch-ins) + graphics, piped to x264. |
| `render/sfx.py` | Procedural sound design (whooshes, impacts, stamps, paper, ticks, pops, coins, risers, printer, ka-ching, drum kit). |
| `render/audio.py` | Mix: varispeed take audio, cues, VO chain (same as the promo's), music with ducking, limiter, two-pass loudnorm to -14 LUFS. |
| `render/finalize.py` | The last loudness step for every video: -14 LUFS with a 4x-oversampled look-ahead limiter whose ceiling is set by encoding AAC and measuring the true peak of the encoded file (at or below -1.5 dBTP). |
| `render/render.sh` | One edit to finished files (master and a < 30 MB web copy). |
| `edit.mjs` | Video A's edit decision list. |
| `tools/peek.py` | Tiles frames of takes at given times, for picking shots. |

`cache/` is gitignored: Python venv, Kokoro models, takes, edits, renders.

## Re-render

```bash
# 0. once: python env and the art bundle
python3 -m venv media/gameplay/cache/venv
media/gameplay/cache/venv/bin/pip install kokoro-onnx soundfile scipy numpy pillow pyloudnorm
node media/gameplay/motion/build-art.mjs

# 1. takes (journals). Needs the demo with the default 5-minute rounds and the game open to the
#    capture wallets; fewer arena bots so the staged beats survive. Ports 5173 and 8787 free first.
GAME_PUBLIC=1 ARENA_BOT_TARGET=15 pnpm demo &
media/gameplay/capture/take-all.sh            # ~30 min; logs in media/gameplay/cache/*.log
node media/gameplay/capture/take-arena.mjs --name arena2 --grow 75 --rival-mass 30 --join 272

# 2. the edits (they need the takes' events), then the frames they use
node media/gameplay/edit.mjs
node media/how-to-play/edit.mjs
node media/promo/vertical.mjs
node media/promo/render/footage-from-takes.mjs --plan
E=media/gameplay/cache/edit/gameplay.json,media/how-to-play/cache/edit/howto.json,media/promo/cache/vertical/vertical.json,$(ls media/promo/cache/footage-plan/*.json | paste -sd,)
for t in arena arena2; do node media/gameplay/capture/replay.mjs $t --edit $E --scale 2; done
for t in spill held practice lobby; do node media/gameplay/capture/replay.mjs $t --edit $E --scale 1.5; done
node media/gameplay/edit.mjs                  # again: the framing now uses the per-frame telemetry

# 3. the render
media/gameplay/render/render.sh media/gameplay/cache/edit/gameplay.json \
  media/gameplay/cache/edit/gameplay-music.json slana-gameplay
# -> out/videos/slana-gameplay.mp4 (web, < 30 MB) and slana-gameplay-master.mp4
```

Takes are live play, so a new recording tells a slightly different story. The edits find their
moments by marks and events (the mid-round join, the gulps, the loot pickups, the death and the
buy-back, the final minute, the last gulp, the bell, the PAID stamp); check a new take's events
before trusting the cut. The delivered cut uses `arena` (the join, the first gulp), `arena2` (loot,
the final minute, the last gulp, the bell and the receipt) and `spill` (eaten by a bot, buy back in).

## Notes

- A replay renders about 1.5-2 frames per second at 2x on 4 cores; the fast-forward between
  ranges skips the canvas draw. Disk: a journal is a few MB per minute; a replayed take holds only
  the frames the edits use (CRF 14 H.264).
- Rounds are wall-clock aligned (`ROUND_SECONDS`, default 300). The takes use the default so the
  round chip shows real five-minute times.
- The rivals (`mochi_moon`, `bonk_bae`, `lil_lamport`, `rug_ruth`, `pixel_penny`) are real wallets
  with real (fake-chain) tickets, played by the capture script. Bots are the game's own.
- The end card reads slana.io and @slanaio (X).
- Colours follow the vivid palette (`docs/design/palette.md`, `packages/shared/src/palette.ts`);
  `motion/` repeats the hex values, so update both when the palette moves.
