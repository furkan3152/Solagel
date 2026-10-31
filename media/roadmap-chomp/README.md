# Elymum "Roadmap Chomp" (14 s, 1920x1080, 1080x1920 and 1080x1080, 60 fps)

Modern and minimal: the Storybook plain (`#F8F7F4`), a faint dot grid, one ink (`#04181C`) and lots of
air, a light grain and no vignette. The X profile coin (the sun coin of `brand/out/x`, drawn by the
NFT kit's `heroCoin`) gets a Pac-Man bite that opens and shuts on the eighth
notes. It wakas along a dotted line and eats the roadmap one heading at a time, letter by letter, and
grows with a pop on each downbeat: **01 WL OPEN** (4.0 s), **02 $1 MINT** (6.0 s), **03 GAME LIVE**
(8.0 s): the product order, WL → Mint → Play. It reaches the end, takes a big bite on 9.0 and settles as the closing card on
10.0: the coin grins, the wordmark, the site's host (`SITE_HOST`, the `PUBLIC_URL` host; default
elymum.io), @elymum. No VO: music and sound only, 120 BPM.

Landscape runs the headings in one row; portrait and square run three rows as a snake.

| Path | What it is |
| --- | --- |
| `timeline.json` | Size, duration, stem levels and the SFX cues (the waka on the eighths, the chomps, the grows). |
| `scenes/scenes.js` | The path, the headings and pellets, the coin's pose and mouth, the closing card. |
| `audio/sfx.py` | The waka, the chomp, the grow pop and the bloop (the mixer asks it before the promo's SFX). |
| `audio/music.py` | The score (the promo's instruments). |

## Re-render

```bash
SITE_HOST=<your host> node media/promo/render/render.mjs --project media/roadmap-chomp --preview 3.9,9.0,11   # stills
SITE_HOST=<your host> media/mint-film/render.sh media/roadmap-chomp elymum-roadmap-chomp \
  1920x1080: 1080x1920:-vertical 1080x1080:-square
```
