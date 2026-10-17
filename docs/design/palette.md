# Slana palette: fresh riso inks on bright paper

The "Paper Ticket" palette, vivid pass (October 2026). Use these values for every new piece of brand art: the X
profile picture, the banner, video grades, slides. The paper texture, riso inks and misregistration stay; the inks
are the saturated, fresh-from-the-drum versions, and the paper is brighter and cleaner.

Sources of truth in the code:

- `packages/shared/src/palette.ts`: the riso inks, ink, paper and night stock (the canvas art, food, coins, stickers
  and arena inks read this file; `@slana/art` re-exports it).
- `apps/web/src/design/tokens.css`: the CSS tokens, including the text-safe accent inks.
- `apps/web/test/palette.test.ts`: keeps the two in step, checks every text and background pair for at least 4.5:1
  (WCAG AA) in both prints, and fails if a riso ink drops below OKLCH chroma 0.11.

## Brand core

| Name | Hex | OKLCH | Use |
| --- | --- | --- | --- |
| Ink black | `#1B1732` | `oklch(0.225 0.051 288)` | outlines, faces, body text, the ink button; a deep indigo black, never pure black |
| Paper | `#FCF4DF` | `oklch(0.968 0.029 90)` | page and world stock (paper print) |
| Card | `#FFFDF6` | `oklch(0.994 0.009 94)` | tickets, cards, highlights, text on ink |
| Riso pink | `#FB2F85` | `oklch(0.655 0.240 2)` | the hero ink: primary buttons, the misregistered offset shadow, the logo |
| Riso teal | `#01ACA4` | `oklch(0.671 0.116 189)` | the second ink: stamps, overprints, success |
| Gold | `#FFB413` | `oklch(0.820 0.168 78)` | coins, loot, tape, the leader crown (`RISO.mustard` / `--mustard` in code) |

### Arena inks

Each arena ticket prints in its own riso ink (stripe and stamp). Code: `ARENA_META` in `packages/shared/src/arenas.ts`.

| Arena | Ink | Hex | OKLCH |
| --- | --- | --- | --- |
| 1 Penny Pond | red | `#F72E1C` | `oklch(0.630 0.235 30)` |
| 2 Silver Creek | teal | `#01ACA4` | `oklch(0.671 0.116 189)` |
| 3 Gold Lake | gold | `#FFB413` | `oklch(0.820 0.168 78)` |
| 4 Whale Bay | blue | `#3055FC` | `oklch(0.540 0.249 267)` |

## Full riso set

Fills, strokes, art and large type. On paper only the darker ones (blue, purple, brown) are dark enough for small text;
use the text-safe inks below for that.

| Ink | Hex | OKLCH | Previous |
| --- | --- | --- | --- |
| pink (`fluoPink`) | `#FB2F85` | `oklch(0.655 0.240 2)` | `#FF4F87` |
| teal | `#01ACA4` | `oklch(0.671 0.116 189)` | `#0E9C9A` |
| gold (`mustard`) | `#FFB413` | `oklch(0.820 0.168 78)` | `#F2B705` |
| blue | `#3055FC` | `oklch(0.540 0.249 267)` | `#3B5BDB` |
| green | `#17AD65` | `oklch(0.659 0.158 155)` | `#1F9D61` |
| red | `#F72E1C` | `oklch(0.630 0.235 30)` | `#E5402B` |
| orange | `#FF7024` | `oklch(0.710 0.192 44)` | `#FF7A3D` |
| purple | `#7F39F4` | `oklch(0.549 0.255 293)` | `#7B4FD6` |
| aqua | `#1AC9E7` | `oklch(0.770 0.132 214)` | `#3CC6E0` |
| lilac | `#B38FFF` | `oklch(0.729 0.161 297)` | `#B49CF0` |
| mint | `#30DDA4` | `oklch(0.800 0.158 165)` | `#5FD3A6` |
| brown | `#9C5223` | `oklch(0.520 0.115 50)` | `#8C5A3C` |

Ink black was `#1E1B2E`, paper `#F1EADB`, card `#FFFCF4`.

How the inks were built: each ink keeps its hue and moves to the lightness where the sRGB gamut allows the most chroma
for that hue, then takes about 95% of that maximum chroma (full gamut edge reads as neon on screens). Muddy mid-tones
(the old greyish teal, the dusty blue and the brown) gained the most.

## Paper print (light theme)

| Token | Hex | On paper | On card |
| --- | --- | --- | --- |
| `--paper` | `#FCF4DF` | | |
| `--card` | `#FFFDF6` | | |
| `--ink` | `#1B1732` | 15.75 | 16.98 |
| `--ink-2` (secondary text) | `#5B5577` | 6.36 | 6.85 |
| `--pink-ink` | `#D1166B` | 4.74 | 5.11 |
| `--pink-text` | `#C71466` | 5.15 | 5.55 |
| `--teal-ink` | `#0F736E` | 5.18 | 5.58 |
| `--mustard-ink` | `#90650E` | 4.72 | 5.09 |
| `--mustard-text` | `#885F0D` | 5.19 | 5.59 |
| `--blue-ink` | `#2F53F9` | 5.14 | 5.54 |
| `--green-ink` | `#0F7644` | 5.18 | 5.58 |
| `--red-ink` | `#CB1C0D` | 5.16 | 5.56 |

Text on fills: ink black on riso pink 4.81, on teal 6.12, on gold 9.70; `--pink-sub` `#3C0C26` (button sub-labels) on
pink 4.59; card on `--danger` `#CB1C0D` (alert banners) 5.56.

## Night print (dark theme)

Deep but colourful: a violet-black stock instead of a neutral one. The riso fills are the same inks as on paper.

| Token | Hex | On night paper | On night card |
| --- | --- | --- | --- |
| `--paper` | `#19142E` | | |
| `--card` | `#251F3D` | | |
| `--ink` | `#F5EEDC` | 15.37 | 13.52 |
| `--ink-2` | `#B1ACCC` | 8.17 | 7.18 |
| `--pink-ink` / `--pink-text` | `#FC739F` | 6.85 | 6.03 |
| `--teal-ink` | `#21C2B9` | 8.03 | 7.07 |
| `--mustard-ink` / `--mustard-text` | `#FFB413` | 9.98 | 8.79 |
| `--blue-ink` | `#7A9EFB` | 6.87 | 6.04 |
| `--green-ink` | `#21C776` | 8.04 | 7.08 |
| `--red-ink` | `#FC7B68` | 6.92 | 6.09 |

## The arena sheet (canvas)

| Part | Paper print | Night print |
| --- | --- | --- |
| World paper | `#FCF4DF` | `#19142E` |
| Outside the map | `#EBE1CC` with ink hatching | `#0E0A1F` |
| Millimetre grid, minor / major | `rgba(40,130,235,0.15)` / `0.32` | `rgba(120,160,255,0.09)` / `0.21` |
| Map edge | ink black over riso pink | night ink over riso pink |

Food is riso confetti in pink, teal, gold, blue, orange and green, each with a misregistered second ink and an ink
rim; golden coins and loot are gold with an ink rim, so they read on both grids.

## Notes for brand art

- Grain and misregistration are part of the look: offset the second ink by about 3/40 of the shape's size, down and
  to the right, and multiply it under the first.
- Pink is the hero; teal and gold are its partners. Use red and blue for the arena tickets, not as general accents.
- Threat cues in the game are shapes, not colours (scared and hungry faces, size); keep it that way so the cues work
  for colour-blind players.
- Keep text on paper in ink black or a text-safe ink; the bright riso fills are not text colours at small sizes.
