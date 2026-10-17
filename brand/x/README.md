# Slana on X (@slanaio)

Profile picture, banner, safe-area previews and the slana.io social card, drawn procedurally in the
"Paper Ticket" riso style with the coins from `packages/art` and the inks from `packages/shared/src/palette.ts`.

Re-run from the repo root (after `pnpm install`; output is deterministic): `node brand/x/generate.mjs`

| File | Size | Use |
| --- | --- | --- |
| `pfp.png`, `pfp-1000.png` | 400×400, 1000×1000 | X profile picture (X crops it to a circle) |
| `banner.png`, `banner@2x.png` | 1500×500, 3000×1000 | X header; upload the @2x for the sharpest result |
| `preview-desktop.png`, `preview-mobile.png` | mock-ups | how the banner and avatar sit in X's layout (approximate) |
| `safe-areas.png` | 1500×760 | the banner with the avatar zone and crop guides drawn on |
| `og.png` | 1200×630 | Open Graph / social card for slana.io |
