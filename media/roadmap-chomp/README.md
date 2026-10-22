# Slana "Roadmap Chomp" (14 s, 1920x1080, 1080x1920 and 1080x1080, 60 fps)

Modern and minimal: flat paper, a faint dot grid, one ink and lots of air, a light grain and no
vignette. The X profile coin (`brand/x/pfp.png`: gold, the reeded edge, the teal pass, the star and
the face; drawn by the NFT kit's `heroCoin`) gets a Pac-Man bite that opens and shuts on the eighth
notes. It wakas along a dotted line and eats the roadmap one heading at a time, letter by letter, and
grows with a pop on each downbeat: **01 GAME BETA** (4.0 s), **02 TOKEN LAUNCH** (6.0 s), **03 NFT
LAUNCH** (8.0 s). It reaches the end, takes a big bite on 9.0 and settles as the closing card on
10.0: the coin grins, the wordmark, slana.io, @slanaio. No VO: music and sound only, 120 BPM.

Landscape runs the headings in one row; portrait and square run three rows as a snake.

| Path | What it is |
| --- | --- |
| `timeline.json` | Size, duration, stem levels and the SFX cues (the waka on the eighths, the chomps, the grows). |
| `scenes/scenes.js` | The path, the headings and pellets, the coin's pose and mouth, the closing card. |
| `audio/sfx.py` | The waka, the chomp, the grow pop and the bloop (the mixer asks it before the promo's SFX). |
| `audio/music.py` | The score (the promo's instruments). |

## Re-render

```bash
node media/promo/render/render.mjs --project media/roadmap-chomp --preview 3.9,9.0,11   # stills
media/free-mint/render.sh media/roadmap-chomp slana-roadmap-chomp \
  1920x1080: 1080x1920:-vertical 1080x1080:-square
```
