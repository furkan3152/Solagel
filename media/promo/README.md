# Slana promo (52.8 s, 1920x1080, 60 fps)

The launch film for Slana, in the Paper Ticket brand. One idea runs through
it: **the whole film is printed**. A coin character eats another coin and
becomes the riso dot of the wordmark. The camera pulls back to show the
wordmark printed on a ticket. The ticket gets a PAID stamp and a punched
hole, and the camera dives through the hole into real gameplay. A round clock
runs down to the bell and the "Round over" receipt prints over the footage. A stamp floods the screen with ink into a night
print, a page turn deals the four arena tickets, a whip pan crosses to the
late-join and buy-back desk, and a paper feed brings up the fee bar: one flat
5% of profit. The floor-loot stub catches fire, and the fire burns through to
the end card.

Everything is deterministic. No CSS animation and no wall clock are used, so
any frame can be re-rendered on its own.

## Beat sheet

| Time | Beat | On screen | VO (Kokoro `af_heart`) |
| --- | --- | --- | --- |
| 0:00.0 | Hook | A pink coin stalks a mint coin carrying 1,750 $SLANA, gulps it on the downbeat (2.4) and its purse rolls up. "Eat a player. / Keep their tokens." | "Eat a player. And keep their tokens." |
| 0:03.7 | Match cut | The coin spins into the riso dot of the wordmark. 0.18 s breath. | |
| 0:04.8 | Logo drop | The `slana` plates slam into register over a pink halftone sun. "EAT / GROW / GET PAID" | "This is Slana. The on-chain arena on Solana." |
| 0:07.7 | Pull-back | The logo turns out to be printed on a Penny Pond ticket. | |
| 0:08.4 | Ticket | "Buy a ticket. / Enter a live room." Tape lands, room coins pop up, PAID stamp (10.8), hole punch (11.4). | "Buy a ticket, and drop into a live round." |
| 0:12.3 | Dive | The camera falls through the punch hole into live gameplay. | |
| 0:14.4 | Montage | Real 1080p footage of the current build in a ticket frame, cut on the beat (15.6 / 16.8 / 18.0 / 19.2): a mid-round join, a player eaten, a rug cactus popping a coin, loot swept up. "Eat. Take. Grow." EATEN stamp (16.2). The last shot is the real "Round over" receipt getting its PAID stamp. | "Eat smaller players... take what they carry... and grow." |
| 0:20.1 | Paper-feed wipe | A printout wipes up over the montage. | |
| 0:20.4 | Rounds | A Penny Pond round clock spins from 5:00 down to 0:03, ticks 3, 2, 1 (the final-minute zone in mustard) and rings the bell at 22.2; the clock swings away and the "Round over" receipt prints (entry 1,000, +750, till at the bell 1,750, fee 5% of profit -37.5, paid 1,712.5), PAID (24.0), a "5% flat fee" sticker (24.6). "Five-minute rounds. / Alive at the bell? / Get paid." | "Five-minute rounds." ... (bell) ... "Everyone still standing at the bell gets paid." |
| 0:25.75 | Ink flood | The stamp's ink floods into a night print. | |
| 0:26.4 | Bots | "Bots carry no value. / Their kills spill loot." The bot (0 $SLANA) eats Daphne (28.8), 1,750 $SLANA spills as loot and two players sweep it up. | "Bots carry no value. But when a bot eats you, your tokens spill as loot." |
| 0:30.5 | Page turn | | |
| 0:31.0 | Arenas | "Four arenas. / Pick your stakes." Four tickets are dealt on the beat (31.45 / 32.05 / 32.65 / 33.25), each in its arena ink: Penny Pond 1,000, Silver Creek 10,000, Gold Lake 50,000, Whale Bay 250,000 $SLANA. OPEN stamps (34.2 to 36.0). "Same game in every room. Only the entry fee differs." | "Four arenas, open to everyone. From one thousand to two hundred fifty thousand Slana." |
| 0:36.85 | Whip pan | | |
| 0:37.2 | Join | "Join mid-round. / Eaten? Buy back in." A lobby row ("Round ends in 3:12") gets a JOIN stamp (38.15); the death sheet's "Buy back in / 1,000 $SLANA" button is pressed (39.95) and stamped BACK IN (40.2). "Joins close in the final minute; a ticket bought then joins the next round." | "Join a round that's already running. Eaten? Buy back in, same fee." |
| 0:41.35 | Paper feed | | |
| 0:42.0 | Fee | "One flat fee. / 5% of profit." The profit bar fills 95% teal (yours) and 5% pink (the fee, paid to the operator). "No profit, no fee." The floor-loot stub lands (43.55) and catches fire (44.4), BURNED. | "One flat fee: five percent of profit. Floor loot left at the bell is burned." |
| 0:45.9 | Burn-through | The fire burns a hole into the end card. 0.18 s breath. | |
| 0:46.8 | End card | The wordmark slams in. "Eat. Grow. Last the round." The slana.io / $SLANA ticket and "X @slanaio" appear, coins peek up, sting (51.6). | "Slana... Eat... Grow... Last the round." |

Music: 100 BPM, Fmaj7 / G6 / Em7 / Am7. Silence-then-drop at 4.8 and
46.8. The drums drop out under the ink flood. The bots get a half-time
minor section from 28.8. A crash lands on the whip pan.

## Layout

| Path | What it is |
| --- | --- |
| `timeline.json` | The single source of timing. It holds the scene list, VO cue times, SFX cues and the footage shots. The grid is 100 BPM (1 beat = 0.6 s = 36 frames). |
| `scenes/promo.html` | The stage: one 1920x1080 canvas. |
| `scenes/lib.js` | The drawing kit: easing and springs, paper, grain and halftone, the kinetic headline with riso misregistration, kicker labels, tickets, tape, stamps, the brand mark and wordmark, odometers, particles, ink and burn blobs. |
| `scenes/scenes.js` | The ten scenes, the transitions between them (match cut, pull-back, punch-hole dive, receipt wipe, ink flood, page turn, whip pan, morph, burn-through) and the motion-blur windows. |
| `scenes/main.js` | Boot code: fonts, textures, `window.renderAt(t)` and sub-frame motion blur. |
| `scenes/art-entry.ts` | Browser bundle entry for `packages/art` (coin characters, palette). |
| `render/build-art.mjs` | Bundles the art package to `cache/art.js`. |
| `render/footage-from-takes.mjs` | Cuts the gameplay shots in `timeline.json` ("footage": take, source second, duration, reframing) out of the 1080p capture takes of `media/gameplay` into `cache/footage/<id>/NNNN.jpg` (1920x1080, 30 fps), with the gameplay kit's reframing and compositor. |
| `render/render.mjs` | Headless-Chromium frame renderer. It runs parallel workers, pipes frames to ffmpeg and writes `cache/video.mp4`. `--preview t1,t2` writes stills. |
| `render/mux.sh` | Muxes the picture and the mix into `out/videos/`. |
| `audio/vo-lines.json` | The VO script, one entry per cue. |
| `audio/tts.py` | Kokoro TTS (local ONNX), voice `af_heart`. "Slana" is forced to the phonemes /slˈɑːnə/. |
| `audio/music.py` | The original score, synthesised in numpy and scored to the cut list. |
| `audio/sfx.py` | Procedural SFX: stamps, paper, tape, punch, printer, coins, ink, page, wax seal, fire and more. |
| `audio/mix.py` | The VO chain (ffmpeg), sidechain ducking, stem levels, a limiter and two-pass loudnorm to -14 LUFS. |

`cache/` is gitignored. It holds the TTS models, art bundle, footage frames,
renders and audio stems.

## Re-render

```bash
cd media/promo
# 0. python env (once)
python3 -m venv cache/venv && cache/venv/bin/pip install kokoro-onnx soundfile numpy scipy pyloudnorm
mkdir -p cache/models && cd cache/models && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin && cd ../..

# 1. art bundle + footage
node render/build-art.mjs
node render/footage-from-takes.mjs    # needs the take arena2 (media/gameplay/README.md)

# 2. picture (about 6-8 min on 4 cores with SwiftShader)
node render/render.mjs --preview 2.4,4.9,11.5,23.5   # spot-check stills in cache/preview/
node render/render.mjs --workers 3                   # → cache/video.mp4

# 3. sound
cache/venv/bin/python audio/tts.py --models cache/models --out cache/vo-raw --voice af_heart   # all lines (it rewrites durations.json)
cache/venv/bin/python audio/music.py cache/audio/music.wav
cache/venv/bin/python audio/sfx.py cache/audio/sfx.wav
cache/venv/bin/python audio/mix.py cache            # → cache/audio/final.wav (-14 LUFS)

# 4. deliverables
render/mux.sh   # → out/videos/slana-promo.mp4 (< 30 MB) and slana-promo-master.mp4
```

If you change a cue in `timeline.json`, re-run the steps that read it.
`sfx.py`, `mix.py` and `music.py` read the cue times, and the scene code
mirrors the beats with its own literal times in `scenes.js`.

The footage shot times in `timeline.json` point into the capture takes. If
you record new takes, pick new start times with `media/gameplay/tools/peek.py`
and update the `footage` entries.

## Brand values

- **slana.io** and **@slanaio** (X) on the end card (`sceneEnd` in `scenes/scenes.js`).
- **$SLANA** is the token name on the end card, the ticket stub, the receipt and the tags.
- Colours: `C` in `scenes/lib.js` mirrors the vivid palette (`docs/design/palette.md`,
  `packages/shared/src/palette.ts`); the coin art comes from `packages/art`.

Room names, player names and numbers (Penny Pond, 1,000 entry, the 1,712.5
receipt) are illustrative demo values that match the app's demo data. The
arena entry fees and the flat 5% fee on profit match `docs/PROJECT.md` and the
in-app guide.
