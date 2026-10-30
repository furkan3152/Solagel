# Elymum promo (45 s, 1920x1080, 60 fps) and its vertical cut (32 s, 1080x1920)

The launch film for Elymum, drawn in the Ring Storybook palette and type (it was cut in the old
Paper Ticket layout; the colours and fonts now follow `docs/specs/2026-10-29-elymum-on-elysium.md`). One idea runs through it: **the whole film
is printed**. It opens cold on real gameplay: Daphne's coin gulps a rival on the downbeat (1.2 s,
in slow motion with a punch-in), "+1,000 $ELYMUM" floats off the gulp into her purse, and the camera
pushes into the coin until it lands exactly where the printed coin of the next shot sits (match
cut). The coin spins into the riso dot of the wordmark, the camera pulls back to show the wordmark
printed on a ticket, the ticket gets a PAID stamp and a punched hole, and the camera dives through
the hole into the gameplay montage. A round clock runs down to the bell and the "Round over" receipt
prints. A page turn deals the four arena tickets, a whip pan crosses to the fee bar: one flat 5% of
profit. The floor-loot stub catches fire, and the fire burns through to a short, plain NFT mention:
the cards are dealt face up on the paper stock, "$1 IN HYPE", "Elymum NFTs.". An ink flood carries
it to the end card (the site's host from `SITE_HOST`, @elymum).

Everything is deterministic. No CSS animation and no wall clock are used, so any frame can be
re-rendered on its own.

## The cut

`timeline.json` keeps the scene timeline the scenes are drawn on ("scenes", "vo", "sfx", old
seconds, 52.8 s; the NFT beat's score sits after it, at 62.4 - 65.4) and lays the film out over it in `cut`: the cold open, pieces of the scene
timeline and the transitions between them. `audioCut` splices the score and the scene SFX on the
same beat-aligned pieces (the score is rendered on the scene timeline, then cut on bar phase), and
`vo2` / `sfx2` are the film's own voice and cue times.

| Film | Beat | On screen | VO (Kokoro `af_heart`) |
| --- | --- | --- | --- |
| 0:00.0 | Cold open | Real footage (shot H): the chase, the gulp at 1.2 (slow motion, punch-in, flash, ink burst), "+1,000 $ELYMUM" drops into the purse (1,000 to 2,000). "Eat a player. / Keep their tokens." | "Eat a player." "Keep their tokens." |
| 0:02.4 | Match cut | The push lands the coin on the printed coin; it spins into the riso dot. | |
| 0:03.6 | Logo drop | The `elymum` plates slam into register. "EAT / GROW / GET PAID" | "This is Elymum. Live coin arenas, on Elysium." |
| 0:06.5 | Ticket | "Buy a ticket. / Enter a live room." PAID stamp, hole punch, the dive. | "Buy a ticket. Drop into a live round." |
| 0:13.2 | Montage | Replayed 60 fps footage in a ticket frame, cut on the beat: the room, a last-second gulp (EATEN), loot swept up, a big coin, the real receipt getting PAID. "Eat. Take. Grow." | "Eat smaller players. Take what they carry. And grow." |
| 0:19.2 | Rounds | The round clock to the bell, the "Round over" receipt, PAID, the 5% sticker. | "Five-minute rounds." ... "Still standing at the bell? You get paid." |
| 0:24.6 | Page turn | | |
| 0:25.2 | Arenas | Four tickets dealt on the beat: 1,000 / 10,000 / 50,000 / 250,000 $ELYMUM; they clear off and the four arena posters (`brand/out/posters`, from `brand/generate.mjs`) are pinned up on the beat. | "Four arenas, open to everyone. From one thousand, to two hundred fifty thousand Elymum." |
| 0:30.6 | Whip pan | | |
| 0:31.2 | Fee | "One flat fee. / 5% of profit." The floor-loot stub burns through. | "One flat fee: five percent of profit. Floor loot at the bell? Burned." |
| 0:36.0 | NFT | The NFT kit's plain beat (`media/mint-film/scenes/nft.js`, `drawBeat` with `plain`) on the paper stock: the three cards (Goldie, Bubbles, Minty) dealt face up on the drop, a "$1 IN HYPE" kicker, "Elymum NFTs."; an ink flood to night (3.0 s). | "Elymum NFTs. One dollar, in HYPE." |
| 0:39.0 | End card | The wordmark, "Eat. Grow. Last the round.", `SITE_HOST` / $ELYMUM, X @ELYMUM, sting. | "Eat. Grow. Last the round. @elymum." |

Music: 100 BPM, Fmaj7 / G6 / Em7 / Am7, silence-then-drop into the logo and the end card.

The vertical cut (`vertical.mjs`) is built with the gameplay kit at 1080x1920: the gulp with the
riso headline, "Five-minute rounds." over the drop-in and the round clock, "Alive at the bell?"
over the last ten seconds (a last gulp), "Get paid." over the bell and the receipt, the plain NFT
mention (the gameplay kit's `nft` component with `plain`, one bar, on the 82 BPM grid) and the end card with the site's host and
@elymum, on the game's 82 BPM score with the promo's voice lines.

## Voice

Kokoro TTS (local ONNX, `kokoro-v1.0`), voice `af_heart`, for every video. Three
representative lines (the hook, the bell rule, the fee example) were auditioned in eight voices
with `media/gameplay/render/voice.py audition`, which writes the reels and `audition.json`:

| Voice | Kokoro grade | Read (words/min) | Pitch movement (semitones, sd) |
| --- | --- | --- | --- |
| **af_heart** | A | 140-169 | 3.7-4.2 |
| af_bella | A- | 150-182 | 2.2-2.9 |
| af_nicole | B- | 113-137 | 2.6-5.4 |
| af_sarah | C+ | 113-170 | 3.9-4.5 |
| am_michael | C+ | 128-154 | 3.3-4.4 |
| am_fenrir | C+ | 137-179 | 4.2-5.1 |
| bf_emma | B- | 125-149 | 2.1-2.6 |
| bm_george | C | 105-130 | 4.4-5.0 |

`af_heart` is chosen: the highest Kokoro grade, a natural conversational pace, and the liveliest
intonation of the top-graded voices (af_bella and bf_emma measure flatter). Switching is one flag
(`tts.py --voice`).

The scripts are written for the ear: short sentences, contractions, numbers in words ("one
thousand", "five percent", "at elymum"). Script marks (`voice.py`): `|` a breath, `||` a beat,
`{0.6}` a pause, `*word*` an emphasis (its own chunk, read a touch slower after a lift-in pause);
each chunk is synthesised on its own and joined with the pauses. Fixed pronunciations: Elymum
/ˈɛlɪməm/, $ELYMUM, Elysium /ɪlˈɪziəm/, HYPE, @elymum. The promo reads punchier
(per-line speeds up to 1.12x, emphasis on the payoffs) than the how-to (1.0x, more air).
The mixer gives every line the same loudness (-19 LUFS before the bus), runs the VO chain
(high-pass 80 Hz, mud cut, presence, air, de-esser, 3:1 compression, light room) and ducks the
music 8 dB under the voice with a 150 ms look-ahead, a hold through the breaths and smooth ramps.

## Layout

| Path | What it is |
| --- | --- |
| `timeline.json` | The single source of timing. It holds the scene list, VO cue times, SFX cues and the footage shots. The grid is 100 BPM (1 beat = 0.6 s = 36 frames). |
| `scenes/promo.html` | The stage: one 1920x1080 canvas. |
| `scenes/lib.js` | The drawing kit: easing and springs, paper, grain and halftone, the kinetic headline with riso misregistration, kicker labels, tickets, tape, stamps, the brand mark and wordmark, odometers, particles, ink and burn blobs. |
| `scenes/scenes.js` | The ten scenes and the NFT beat of the cut, the transitions between them (match cut, pull-back, punch-hole dive, receipt wipe, ink flood, page turn, whip pan, morph, burn-through) and the motion-blur windows. |
| `scenes/main.js` | Boot code: fonts, textures, `window.renderAt(t)` and sub-frame motion blur. |
| `scenes/art-entry.ts` | Browser bundle entry for `packages/art` (coin characters, palette). |
| `render/build-art.mjs` | Bundles the art package to `cache/art.js`. |
| `render/footage-from-takes.mjs` | Cuts the gameplay shots in `timeline.json` ("footage": take, source second or `align` (a source second at a local second), duration, reframing, speed ramps) out of the replayed takes of `media/gameplay` into `cache/footage/<id>/NNNN.jpg` (1920x1080, 60 fps) plus `track.json` (the coin per frame), with the gameplay kit's reframing and compositor. `--plan` only writes the shot edits for `capture/replay.mjs --edit`. |
| `vertical.mjs` | The vertical cut's edit (gameplay kit, 1080x1920). |
| `render/render.mjs` | Headless-Chromium frame renderer. It runs parallel workers, pipes frames to ffmpeg and writes `cache/video.mp4`. `--preview t1,t2` writes stills. `--project DIR --w W --h H` renders another scene set with the same stage contract at any size (the mint film, Roadmap Chomp); `/media/...` is served from the repo's `media/`. |
| `render/mux.sh` | Muxes the picture and the mix into `out/videos/`. |
| `audio/vo-lines.json` | The VO script, one entry per cue. |
| `audio/tts.py` | The promo's voiceover (`audio/vo-lines.json`) through the shared voice kit `media/gameplay/render/voice.py`. |
| `audio/music.py` | The original score, synthesised in numpy and scored to the cut list. |
| `audio/sfx.py` | Procedural SFX: stamps, paper, tape, punch, printer, coins, ink, page, wax seal, fire and more. |
| `audio/mix.py` | Splices the score and the scene SFX along the cut, adds the cut's cues, the VO chain (ffmpeg), sidechain ducking, stem levels, a limiter and two-pass loudnorm to -14 LUFS. `render/mux.sh` then runs `media/gameplay/render/finalize.py` (true peak at or below -1.5 dBTP after AAC). |

`cache/` is gitignored. It holds the TTS models, art bundle, footage frames,
renders and audio stems.

## Re-render

```bash
cd media/promo
# 0. python env (once): the gameplay kit's venv and Kokoro models serve both (media/gameplay/README.md)
PY=../gameplay/cache/venv/bin/python

# 1. art bundle + footage (the takes replayed first, see media/gameplay/README.md)
node render/build-art.mjs
node render/footage-from-takes.mjs

# 2. picture (about 6-8 min on 4 cores with SwiftShader)
node render/render.mjs --preview 1.2,2.4,13.6,25.0   # spot-check stills in cache/preview/
node render/render.mjs --workers 3                   # -> cache/video.mp4 (45 s)

# 3. sound (the score and SFX on the scene timeline, then cut)
$PY audio/tts.py --models ../gameplay/cache/models --out cache/vo-raw --voice af_heart
$PY audio/music.py cache/audio/music.wav
$PY audio/sfx.py cache/audio/sfx.wav
$PY audio/sfx.py cache/audio/sfx2.wav --cues sfx2
$PY audio/mix.py cache            # -> cache/audio/final.wav (-14 LUFS)

# 4. deliverables
render/mux.sh   # -> out/videos/elymum-promo.mp4 (< 30 MB) and elymum-promo-master.mp4

# vertical cut (from the repo root)
node media/promo/vertical.mjs
MASTER_AUDIO=192k media/gameplay/render/render.sh media/promo/cache/vertical/vertical.json \
  media/promo/cache/vertical/vertical-music.json elymum-promo-vertical media/promo/cache/vo-raw
```

If you change a cue in `timeline.json`, re-run the steps that read it. The scene code mirrors the
beats with its own literal times in `scenes.js` (scene timeline seconds); `cut` maps them to film
time. New takes need new `footage` entries (pick moments with the takes' events).

## Brand values

- The site's host (`SITE_HOST`, the `PUBLIC_URL` host; default elymum.io) and **@elymum** (X) on the end card (`sceneEnd` in `scenes/scenes.js`).
- The NFT: the promo says only "Elymum NFTs." and "$1 in HYPE" (no other mint terms, no WL, no HYPE amount,
  no supply, no dates, no perks).
- **$ELYMUM** is the token name on the end card, the ticket stub, the receipt and the tags.
- Colours: `C` in `scenes/lib.js` holds the Ring Storybook paints under the old names (the spec's section 6.3,
  `packages/shared/src/palette.ts`: pink -> cyan, mustard -> sun, night -> trench); type is Fraunces and Geist
  Mono; the coin art comes from `packages/art`.

Room names, player names and numbers (Asphodel Meadow, 1,000 entry, the 1,712.5
receipt) are illustrative demo values that match the app's demo data. The
arena entry fees and the flat 5% fee on profit match `docs/PROJECT.md` and the
in-app guide.
