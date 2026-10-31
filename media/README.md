# Elymum films

Video pipelines for Elymum. Every film is code: scenes are drawn per frame (canvas or DOM) or
captured from the real web app with Playwright, then mixed and encoded with ffmpeg. Nothing here is
rendered in the repository; the outputs go to `out/videos/` (gitignored).

| Folder | Film |
|---|---|
| `promo/` | The 45 s launch film and its 32 s vertical cut (scenes in `promo/scenes`, the shared canvas kit in `promo/scenes/lib.js`) |
| `gameplay/` | Video A: a real paid round, captured from the app (`gameplay/capture`), cut by `gameplay/edit.mjs` |
| `how-to-play/` | Video B: the narrated guide, built on the gameplay kit |
| `gameplay-film/` | The narrated gameplay film (about 120 s, home page into a live round): script, voice-actor page, cue timeline, Kokoro or human voice with a humanising post chain, synthesised storybook score and sfx, mixer |
| `mint-film/` | The mint announcement: $1 in HYPE, WL → Mint → Play (it also holds the NFT kit `scenes/nft.js` and the short-film mixer) |
| `roadmap-chomp/` | 14 s music-only loop: the coin eats WL OPEN, $1 MINT, GAME LIVE |

## Re-rendering after the move to Elysium

The films were made for the app before the move to Elysium. Their text, voice lines, handles and arena names now
say Elymum, Elysium, HYPE, `$ELYMUM`, @elymumio and the four Elysian arenas, and the hand-drawn scenes
use the Ring Storybook palette (`#04181C` ink, cream, sun, cyan, teal, trench night) and type
(Fraunces, DM Sans, Geist Mono, from `apps/web`'s `@fontsource-variable` packages). The captured
films (gameplay, how-to-play, the promo's footage) record the real UI, so they pick up the new
interface on their own, but only once it has landed:

1. Wait until the new web UI (spec section 6) is in `apps/web`, then re-take the captures
   (`media/gameplay/capture/take-all.sh` against `pnpm demo`). The capture kit's selectors and the
   `window.__elymum*` dev globals must match the new UI; fix them in `gameplay/capture/lib.mjs` first.
2. Re-synthesise every voice line (the scripts changed; the old takes in `cache/` are stale) and check
   the VO cue times in each `timeline.json` / edit script against the new takes.
3. Rebuild the art bundles (`node media/promo/render/build-art.mjs`, `node media/gameplay/motion/build-art.mjs`).
4. Render with `SITE_HOST` set to the host of the site's `PUBLIC_URL` (no domain is written into the
   films; the default is `elymum.io`), for example `SITE_HOST=elymum.io node media/promo/render/render.mjs`.
5. Look at the stills (`--preview`) before the full renders: the Storybook palette replaced the old
   Paper Ticket colours by name, so a few layouts (the wider "elymum" wordmark, longer lines) may need
   nudges.

The arena posters the promo pins up come from the brand kit (`brand/out/posters`, `node brand/generate.mjs`).
