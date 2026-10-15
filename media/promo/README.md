# Slana promo (52.8 s, 1920x1080, 60 fps)

The launch film for Slana, in the Paper Ticket brand. One idea runs through
it: **the whole film is printed**. A coin character eats another coin and
becomes the riso dot of the wordmark. The camera pulls back to show the
wordmark printed on a ticket. The ticket gets a PAID stamp and a punched
hole, and the camera dives through the hole into real gameplay. A round clock
runs down to the bell and the "Round over" receipt prints over the footage. A stamp floods the screen with ink into a night
print, a page turn opens a Pass envelope, and a whip pan crosses to the
season table. The season pool turns into the fee bar, the burned fifth
catches fire, and the fire burns through to the end card.

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
| 0:14.4 | Montage | Real 1080p footage of the current build in a ticket frame, cut on the beat (15.6 / 16.8 / 18.0 / 19.2): a mid-round join, a player eaten in the last ten seconds, a split, loot swept up. "Eat. Take. Grow." EATEN stamp (16.2). The last shot is the real "Round over" receipt getting its PAID stamp. | "Eat smaller players... take what they carry... and grow." |
| 0:20.1 | Paper-feed wipe | A printout wipes up over the montage. | |
| 0:20.4 | Rounds | A Penny Pond round clock spins from 5:00 down to 0:03, ticks 3, 2, 1 (the final-minute zone in mustard) and rings the bell at 22.2; the clock swings away and the "Round over" receipt prints (entry 1,000, +750, till at the bell 1,750, fee 5% of profit -37.5, paid 1,712.5), PAID (24.0), a "2% with a Pass" sticker (24.6). "Five-minute rounds. / Alive at the bell? / Get paid." | "Five-minute rounds." ... (bell) ... "Everyone still standing at the bell gets paid." |
| 0:25.75 | Ink flood | The stamp's ink floods into a night print. | |
| 0:26.4 | Bots | "Bots carry no value. / Their kills spill loot." The bot (0 $SLANA) eats Daphne (28.8), 1,750 $SLANA spills as loot and two players sweep it up. | "Bots carry no value. But when a bot eats you, your tokens spill as loot." |
| 0:30.5 | Page turn | | |
| 0:31.0 | Pass | "Free to mint. / Plays better." Airmail envelope, the wax seal cracks (32.4), the passport slides out and opens on the Pass card. Perks are stamped on the beat: 2% FEE, PASS ROOMS, +15% START, SEASON PRIZES, COIN LOOK. | "The Slana Pass is free to mint. Lower fees, Pass rooms, and a head start." |
| 0:36.85 | Whip pan | | |
| 0:37.2 | Season | "Play the season. / Top 10 split the pool." The standings print, the pool counts to 84,200 and payouts fly to the 10 rows (shares 30 to 2%). | "Every season, the top ten split the pool." |
| 0:41.35 | Morph | The pool ticket stretches into the fee bar. | |
| 0:42.0 | Split | "One fee, three ways. / A fifth is burned." 50% treasury / 30% season pool / 20% burned. The burned stub catches fire (44.4). "No team money pays rewards." | "Fees split three ways. A fifth is burned. Players pay players." |
| 0:45.9 | Burn-through | The fire burns a hole into the end card. 0.18 s breath. | |
| 0:46.8 | End card | The wordmark slams in. "Eat. Grow. Last the round." The slana.xyz / $SLANA ticket appears, coins peek up, sting (51.6). | "Slana... Eat... Grow... Last the round." |

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
| `scenes/art-entry.ts` | Browser bundle entry for `packages/art` (coin characters, Pass card). |
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
node render/footage-from-takes.mjs    # needs the takes arena, arena2, loot (media/gameplay/README.md)

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

## Placeholders to replace before publishing

- **`slana.xyz`**: the URL on the end-card ticket (`sceneEnd` in `scenes/scenes.js`).
- **`$SLANA`**: the ticker on the end card, the ticket stub, the receipt and the tags.

Both are placeholders until the real domain and mint are final. Search
`scenes.js` for `slana.xyz` and `$SLANA`.

Room names, player names and numbers (Penny Pond, 1,000 entry, the 1,712.5
receipt, the 84,200 pool) are illustrative demo values that match the app's
demo data. The prize shares (30/20/14/10/8/6/4.5/3/2.5/2 %) and the
50/30/20 fee split come from the protocol constants.
