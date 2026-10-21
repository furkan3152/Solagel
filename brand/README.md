# Slana brand kit

Everything here is drawn in code in the "Paper Ticket" riso style (ink misregistration, halftone, tickets, stamps,
tape, perforations and the coin characters from `packages/art`), with the inks from `packages/shared/src/palette.ts`
(see `docs/design/palette.md`) and the web app's Bricolage Grotesque and DM Mono. Every generator is deterministic:
re-running it only changes a file when the art, the palette or the script changes.

Rebuild all of it from the repo root, after `pnpm install` (brand/x is separate):

```
node brand/generate-all.mjs
```

| Folder | What | Re-run |
| --- | --- | --- |
| [`brand-sheet.png`](brand-sheet.png) | the brand sheet: logo lockups (paper and night stock), palette with hex, type, mascot and cast, paper goods, do's and don'ts | `node brand/sheet/generate.mjs` |
| [`x/`](x/README.md) | X profile picture, banner, OG card, safe-area previews | `node brand/x/generate.mjs` |
| [`posts/`](posts/README.md) | X post templates, 1600×900 and 1080×1080 | `node brand/posts/generate.mjs` |
| [`stories/`](stories/README.md) | story / vertical templates, 1080×1920 | `node brand/stories/generate.mjs` |
| [`stickers/`](stickers/README.md) | 13 die-cut coin stickers (512, transparent) and 128 px emoji | `node brand/stickers/generate.mjs` |
| [`posters/`](posters/README.md) | one 2000×2800 riso print per arena | `node brand/posters/generate.mjs` |
| [`community/`](community/README.md) | Discord server icon and banner, Telegram header and group photo | `node brand/community/generate.mjs` |
| `lib/` | shared drawing code: `riso.mjs` (paper, grain, halftone, worn passes, hero coin, extra faces, limbs, wordmark, tickets, tape, stamps, icons, die-cut, indexed PNG), `scenes.mjs` (the four arena illustrations), `cards.mjs` (post and story layouts) | |

## Notes

- Copy on the art follows the site (`apps/web/src/site`): "Eat. Grow. Last the round.", the four steps "Buy a ticket /
  Eat / The bell / Paid", the fee receipt example (entry 1,000, till 2,000, fee 50, paid 1,950) and the arena entries
  from `packages/shared/src/arenas.ts`.
- X images are kept under 2 MB: a design whose truecolor PNG would be over about 1.9 MB is written as a 256-colour
  indexed PNG (median cut plus k-means, `indexedPng` in `lib/riso.mjs`). Riso art is a handful of inks and their
  overprints, so the difference is not visible at feed size. Posters and the sheet use a 4 MB threshold.
- No emoji or icon fonts: every icon (bell, stopwatch, flame, mug, hearts, ticks and crosses) is drawn.
