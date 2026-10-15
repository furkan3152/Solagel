# How to play Slana (Video B)

A narrated tutorial, about 2:29, 1920x1080, 30 fps, H.264 + AAC, -14 LUFS, in
eight chapters with the brand's ticket chapter cards:

1. What Slana is
2. Start free in Practice
3. Controls (steer, split, tip mass, stickers, chat; keycap and mouse callouts)
4. Eat and avoid (the 1.25x rule as a diagram, running from bigger coins,
   rug cacti, loot when a bot eats you)
5. Arenas and tickets (wallet, the four arenas and their entry fees, the
   ticket sheet, your till)
6. Cash out (C, the 3 s channel, the receipt; the guide's worked example as
   two printing receipts: 1,000 in, 2,000 out, fee 50 or 20 with a Pass, net
   1,950 or 1,980; the 50/30/20 fee split)
7. The Slana Pass and seasons
8. Tips, then the end card

Every rule and number on screen and in the voiceover comes from the in-app
guide (`apps/web/src/ui/docs/content.en.ts` and `facts.ts`) and the controls
from `apps/web/src/game/input.ts`.

## Layout

| Path | What it is |
| --- | --- |
| `audio/vo-lines.json` | The voiceover script, one line per cue. |
| `audio/tts.py` | Kokoro TTS (local ONNX), voice `af_heart`, the promo's voice; "Slana" is forced to /slˈɑːnə/ like in the promo. |
| `edit.mjs` | The edit: lays the picture out along the VO durations, chapter cards between, captions that echo the VO, callouts. |

Footage, motion graphics, the compositor and the mixer are shared with the
gameplay video: see `media/gameplay/README.md`. The takes it uses are `lobby`,
`practice`, `controls`, `spill`, `arena`, `arena-t7`.

## Re-render

```bash
# once: the env, models and art bundle (see media/gameplay/README.md), then
mkdir -p media/gameplay/cache/models && cd media/gameplay/cache/models && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx && \
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin && cd -

# 1. voiceover
media/gameplay/cache/venv/bin/python media/how-to-play/audio/tts.py \
  --models media/gameplay/cache/models --out media/how-to-play/cache/vo-raw --speed 1.07

# 2. the edit and the render (takes recorded as in media/gameplay)
node media/how-to-play/edit.mjs
media/gameplay/render/render.sh media/how-to-play/cache/edit/howto.json \
  media/how-to-play/cache/edit/howto-music.json slana-how-to-play media/how-to-play/cache/vo-raw
# -> out/videos/slana-how-to-play.mp4 (web, < 30 MB) and slana-how-to-play-master.mp4
```

The VO is processed in the mixer with the promo's chain (high-pass 80 Hz, mud
cut, presence, air, de-esser, 3:1 compression, a light synthetic room) and the
music bed (the game's in-room score, captured from the audio tap) ducks under
it.
