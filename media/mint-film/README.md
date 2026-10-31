# Elymum mint film (19.5 s, 1920x1080 and 1080x1920, 60 fps)

A short announcement film for the Elymum NFT: the mint costs **$1, paid in HYPE** on Elysium, the
order is **WL → Mint → Play** (the emblem opens the game), and the WL is open at `<SITE_HOST>/wl`
(@elymumio on X). 120 BPM; every cut and slam sits on the beat grid (downbeats at 0.5 + 2k s). The
canvas kit draws in the Ring Storybook palette and type (Fraunces, Geist Mono; see `media/README.md`).

| Film | Beat | On screen | VO (Kokoro `af_heart`, the promo's chain) |
| --- | --- | --- | --- |
| 0:00.0 | $1 mint | A sealed card spins up and cracks; "$1" and "MINT" slam in on the cyan stock; the mascot (the X profile coin) rises and falls in love. | "A one dollar mint." "The Elymum NFT is coming." |
| 0:04.5 | Sealed | A paper wipe; five sealed cards dealt, the seals crack and the cards turn on the eighths; a $1 IN HYPE stamp. | "Sealed cards. One dollar, in HYPE." |
| 0:08.5 | The order | An ink flood to night; three tickets; the mascot hops 01 WL OPEN, 02 $1 MINT, 03 GAME LIVE, each prints in its ink on the landing; it leaps at the camera. | "The roadmap: The whitelist. The mint. Then the game." |
| 0:12.5 | WL open | The coin pulls back: "WL open.", the `<SITE_HOST>/wl` ticket, the wordmark, @ELYMUMIO and the foot line "WL OPEN · <SITE_HOST>/WL · @ELYMUMIO". | "The WL is open. @elymumio, on X." |

Facts: $1 in HYPE (never a HYPE number: the price is held at a dollar and its HYPE value moves), the
WL first, the order WL → Mint → Play. No supply, no dates, no perks. The VO lines changed length
with the rebrand: check the cue times in `timeline.json` against the new takes before the final render.

`SITE_HOST` is the host of the site's `PUBLIC_URL` (no domain is written into the scenes). The
renderer passes it to the page as `?site=`; default `elymum.io`.

## Layout

| Path | What it is |
| --- | --- |
| `timeline.json` | Frame rate, size, duration, the stage page, VO cue times and SFX cues (the promo's SFX types). |
| `scenes/index.html` | The stage: one canvas at the size in the URL (`?w=&h=&site=`). It loads the promo's drawing kit and boot code (`media/promo/scenes/lib.js`, `main.js`) and art bundle (`media/promo/cache/art.js`). |
| `scenes/nft.js` | The NFT kit, shared with the promo, the vertical promo and how-to-play: the hero coin (with an optional Pac-Man bite), the sealed cards (back, wax seal, turn, face with a coin character), the WL ticket, the stock and the NFT beat (landscape or portrait). It also defines `window.SITE_HOST`. |
| `scenes/scenes.js` | The four scenes and their transitions, landscape and portrait from the same code. |
| `audio/vo-lines.json`, `audio/tts.py` | The voiceover script and its synthesis (the shared voice kit, `media/gameplay/render/voice.py`). |
| `audio/music.py` | The score (the promo's instruments at 120 BPM). |
| `audio/mix.py` | The short-film mixer (also used by Roadmap Chomp): SFX cues, the promo's VO chain, the gameplay kit's duck. |
| `render.sh` | Picture per size, score, mix, `finalize.py` (-14 LUFS, true peak at or below -1.5 dBTP after AAC), master and web copies. |

## Re-render

```bash
node media/promo/render/build-art.mjs        # once: the art bundle
media/gameplay/cache/venv/bin/python media/mint-film/audio/tts.py \
  --models media/gameplay/cache/models --out media/mint-film/cache/vo-raw
SITE_HOST=<your host> node media/promo/render/render.mjs --project media/mint-film --preview 1.0,6.5,10.5,16.5   # stills
SITE_HOST=<your host> node media/promo/render/render.mjs --project media/mint-film --w 1080 --h 1920 --preview 10.5
SITE_HOST=<your host> media/mint-film/render.sh media/mint-film elymum-mint-film 1920x1080: 1080x1920:-vertical
# -> out/videos/elymum-mint-film(.mp4|-master.mp4), elymum-mint-film-vertical(.mp4|-master.mp4)
```
