# Elymum brand kit

The social and web art of Elymum, drawn in the **Ring Storybook** language: confident ink outlines
(`#04181C`), flat cel fills with one shade tone, hard offset shadows (never blurred), cream die-cut
stickers, Fraunces for display, DM Sans for reading and Geist Mono for every number and kicker. The
source of truth is the spec (`docs/specs/2026-10-29-elymum-on-elysium.md`, section 6) and the
reference page `docs/design/storybook-reference.html`; the drawings here are copied from it.

Everything is generated from code. Change a template, run the generator, look at the PNGs.

```bash
node brand/generate.mjs            # everything (a few seconds)
node brand/generate.mjs og post-mint   # only some jobs
node brand/generate.mjs --list     # the jobs and their files
```

It needs only what the repository already installs: Playwright and the `@fontsource-variable`
fonts of `apps/web` (fonts are inlined as data URIs; when they are missing the templates fall back
to Google Fonts). Chromium comes from `CHROME_PATH` or Playwright's own browser
(`pnpm -F @elymum/web exec playwright install chromium` if you have none).

## Outputs (`brand/out/`)

| File | Size | Use |
|---|---|---|
| `x/x-avatar-400.png`, `x/x-avatar-1000.png` | 400, 1000 square | X profile picture (circle-safe): the sun coin on the ring at dusk |
| `x/x-banner-1500x500.png`, `x/x-banner-3000x1000.png` | 1500x500, @2x | X header: the ring scene, the hunter chasing a snack, the wordmark sticker on the right (the avatar covers the lower left) |
| `web/og-elymum.png` | 1200x630 | Open Graph / Twitter card. **Also written to `apps/web/public/og-elymum.png`** (index.html points at it) |
| `web/favicon-32.png` | 32 | The CoinMark (cyan coin, fat cream E). **Also `apps/web/public/favicon-32.png`** |
| `web/apple-touch-icon.png` | 180 | CoinMark on the night trench with seigaiha. **Also `apps/web/public/apple-touch-icon.png`** |
| `web/coin-mark-512.png` | 512 | The mark alone, transparent, for anything else |
| `posts/post-wl-open.png` | 1600x900 | "The WL is open." with the three chores as terrace stickers |
| `posts/post-mint.png` | 1600x900 | Night plate: "One emblem. One dollar. Many snacks." and the mint card ($1.00, paid in HYPE) |
| `posts/post-game-live.png` | 1600x900 | The floor of the ring at feeding time: HUD stickers, leaderboard, coins with name tags |
| `stickers/sticker-sheet.png` | 1800x1200 | The cast of coins, the mark and the die-cut wordmark |
| `stickers/sticker-<name>.png` | 500 square, transparent | One die-cut sticker per character: hunter, snack, smug, happy, smile, open, sleepy |

The PNGs are committed (about 3 MB in all) so people can grab them without running anything.

## Rules the templates follow

- Copy is short and a little wry; the product is "Elymum", the chain "Elysium", the gas token HYPE, the
  mint "$1 in HYPE", the handle `@elymum`. No domain is written into the art: the site lives at whatever
  `PUBLIC_URL` says, and moving it (for example to elymum.io) needs no new images.
- The mint art never shows a HYPE amount: the price is held at $1 and its HYPE value moves.
- No gradients except the sky, no soft shadows, no purple, no emoji; one sun (primary) button per image.
- Shadows always go down and right.

## Files

- `generate.mjs`: the job list and the Playwright renderer (copies the web files into `apps/web/public`).
- `lib/art.mjs`: palette, fonts, base CSS, the coin character (`coin(paint, { mood, look, size, diecut })`),
  `wordmark()`, `coinMark()`, `seigaiha()`, `cloud()`, `terraces()`, stars, food bits, scene props.
- `lib/scene.mjs`: the ring habitat at dawn, copied from the reference's hero plate.
- `lib/templates.mjs`: one function per image.
