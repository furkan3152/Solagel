# How to play Elymum (Video B)

A narrated tutorial, about 2:45, 1920x1080, 30 fps (every frame an exact replayed game frame), H.264 +
AAC, -14 LUFS with the true peak at or below -1.5 dBTP after encoding, in seven chapters with the
brand's ticket chapter cards:

1. What Elymum is
2. Warm up in Practice
3. Controls (steer, split, tip mass, stickers, chat; keycap and mouse callouts)
4. Eat and avoid (the 1.25x rule as a diagram, running from bigger coins,
   rug cacti, loot when a bot eats you)
5. Arenas and tickets (wallet, the four arenas, open to everyone, and their
   entry fees 1,000 / 10,000 / 50,000 / 250,000, the ticket sheet, your till)
6. Rounds and payouts (5-minute wall-clock rounds and joining a running one;
   joins close in the final minute and a ticket bought then is held for the
   next round; eaten means buy back in at the same fee; everyone alive at the
   bell is paid their till; the guide's worked example as a printing "Round
   over" receipt: 1,000 in, 2,000 at the bell, fee 50 (a flat 5% of profit,
   paid to the operator), net 1,950; no profit, no fee; floor loot left at the
   bell is burned)
7. Tips (warm up, split only when sure, play safe in the final minute), then
   the NFT card (one line: the Elymum NFT mints for $1 in HYPE, the WL comes first; the sealed cards
   of `media/mint-film/scenes/nft.js` through the gameplay kit's `nft` component) and the end card
   (the site's host from `SITE_HOST`, @elymumio)

Every rule and number on screen and in the voiceover comes from the in-app
guide (`apps/web/src/ui/docs/content.en.ts` and `facts.ts`), `docs/PROJECT.md` and the controls
from `apps/web/src/game/input.ts`. Arenas have no cash-out key.

## Layout

| Path | What it is |
| --- | --- |
| `audio/vo-lines.json` | The voiceover script, one line per cue. |
| `audio/tts.py` | Kokoro TTS (local ONNX), voice `af_heart`, the promo's voice; "Elymum" is forced to /ˈɛlɪməm/ like in the promo. |
| `edit.mjs` | The edit: lays the picture out along the VO durations, chapter cards between, captions that echo the VO, callouts. |

Footage, motion graphics, the compositor and the mixer are shared with the
gameplay video: see `media/gameplay/README.md`. The takes it uses are `lobby`,
`practice`, `spill`, `held`, `arena` and `arena2`, all journals replayed frame by frame.

## Re-render

```bash
# once: the env, models and art bundle (see media/gameplay/README.md), then
mkdir -p media/gameplay/cache/models && cd media/gameplay/cache/models && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin && cd -

# 1. voiceover
media/gameplay/cache/venv/bin/python media/how-to-play/audio/tts.py \
  --models media/gameplay/cache/models --out media/how-to-play/cache/vo-raw --speed 1.07

# 2. the edit, the replayed frames it uses (media/gameplay/README.md, step 2), the render
node media/how-to-play/edit.mjs
media/gameplay/render/render.sh media/how-to-play/cache/edit/howto.json \
  media/how-to-play/cache/edit/howto-music.json elymum-how-to-play media/how-to-play/cache/vo-raw
# -> out/videos/elymum-how-to-play.mp4 (web, < 30 MB) and elymum-how-to-play-master.mp4
```

The VO is processed in the mixer with the promo's chain (high-pass 80 Hz, mud
cut, presence, air, de-esser, 3:1 compression, a light synthetic room) and the
music bed (the game's in-room score, captured from the audio tap) ducks under
it.
