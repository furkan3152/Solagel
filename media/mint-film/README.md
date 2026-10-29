# Slana "Free Mint" (19.5 s, 1920x1080 and 1080x1920, 60 fps)

A short announcement film in the Paper Ticket riso style: the Slana NFT is a **free mint**, the
roadmap is Game Beta, Token Launch, NFT Launch, and the WL is open at slana.io/wl (@slanaio).
120 BPM; every cut and slam sits on the beat grid (downbeats at 0.5 + 2k s).

| Film | Beat | On screen | VO (Kokoro `af_heart`, the promo's chain) |
| --- | --- | --- | --- |
| 0:00.0 | Free mint | A sealed card spins up and cracks; FREE and MINT slam in on the pink stock; the mascot (the X profile coin) rises and falls in love. | "Free mint." "The Slana NFT is coming." |
| 0:04.5 | Sealed | A paper wipe; five sealed cards dealt, the seals crack and the cards turn on the eighths; a FREE MINT stamp. | "Sealed cards. Free to mint." |
| 0:08.5 | Roadmap | An ink flood to night; three tickets; the mascot hops 01 GAME BETA, 02 TOKEN LAUNCH, 03 NFT LAUNCH, each prints in its ink on the landing; it leaps at the camera. | "The roadmap: Game beta. Token launch. NFT launch." |
| 0:12.5 | WL open | The coin pulls back to the pink: "WL open.", the slana.io/wl ticket, the wordmark, @slanaio and the foot line "WL OPEN · SLANA.IO/WL · @SLANAIO". | "The WL is open. slana dot io slash W L." |

Facts: a free mint, the WL at slana.io/wl, the roadmap order. No price but free, no supply, no
dates, no perks.

## Layout

| Path | What it is |
| --- | --- |
| `timeline.json` | Frame rate, size, duration, the stage page, VO cue times and SFX cues (the promo's SFX types). |
| `scenes/index.html` | The stage: one canvas at the size in the URL (`?w=&h=`). It loads the promo's drawing kit and boot code (`media/promo/scenes/lib.js`, `main.js`) and art bundle (`media/promo/cache/art.js`). |
| `scenes/nft.js` | The NFT kit, shared with the promo, the vertical promo and how-to-play: the hero coin (a port of `brand/x/generate.mjs`'s `heroCoin`, with an optional Pac-Man bite), the sealed cards (back, wax seal, turn, face with a coin character), the WL ticket, the pink stock and the NFT beat (landscape or portrait). |
| `scenes/scenes.js` | The four scenes and their transitions, landscape and portrait from the same code. |
| `audio/vo-lines.json`, `audio/tts.py` | The voiceover script and its synthesis (the shared voice kit, `media/gameplay/render/voice.py`). |
| `audio/music.py` | The score (the promo's instruments at 120 BPM). |
| `audio/mix.py` | The short-film mixer (also used by Roadmap Chomp): SFX cues, the promo's VO chain, the gameplay kit's duck. |
| `render.sh` | Picture per size, score, mix, `finalize.py` (-14 LUFS, true peak at or below -1.5 dBTP after AAC), master and web copies. |

## Re-render

```bash
node media/promo/render/build-art.mjs        # once: the art bundle
media/gameplay/cache/venv/bin/python media/free-mint/audio/tts.py \
  --models media/gameplay/cache/models --out media/free-mint/cache/vo-raw
node media/promo/render/render.mjs --project media/free-mint --preview 1.0,6.5,10.5,16.5   # stills
node media/promo/render/render.mjs --project media/free-mint --w 1080 --h 1920 --preview 10.5
media/free-mint/render.sh media/free-mint slana-free-mint 1920x1080: 1080x1920:-vertical
# -> out/videos/slana-free-mint(.mp4|-master.mp4), slana-free-mint-vertical(.mp4|-master.mp4)
```
