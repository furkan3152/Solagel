# X post templates

1600×900 (16:9, X's in-feed shape) and 1080×1080 versions of each post. Re-run from the repo root:

```
node brand/posts/generate.mjs                  # every post
node brand/posts/generate.mjs --only fee       # one design (file-name prefix)
node brand/posts/generate.mjs --only countdown --days 3 --date "SAT · NOV 14 · 18:00 UTC" --title "The first bell"
```

The countdown card's number (`--days`, default `7`), date line (`--date`, default `SAT · NOV 14 · 18:00 UTC`) and
headline (`--title`, default `The first bell`) are arguments; the defaults are placeholders, not an announced date.

| Files | Post |
| --- | --- |
| `wl-open-1600x900.png`, `wl-open-1080x1080.png` | "WL is open", CTA ticket to slana.io/wl |
| `collab-open-1600x900.png`, `collab-open-1080x1080.png` | "Collab applications are open", CTA ticket to slana.io/collab |
| `arena-1-penny-pond-1600x900.png`, `arena-1-penny-pond-1080x1080.png` | arena reveal: Penny Pond, red ink, entry 1,000 $SLANA |
| `arena-2-silver-creek-1600x900.png`, `arena-2-silver-creek-1080x1080.png` | arena reveal: Silver Creek, teal ink, entry 10,000 $SLANA |
| `arena-3-gold-lake-1600x900.png`, `arena-3-gold-lake-1080x1080.png` | arena reveal: Gold Lake, gold ink, entry 50,000 $SLANA |
| `arena-4-whale-bay-1600x900.png`, `arena-4-whale-bay-1080x1080.png` | arena reveal: Whale Bay, blue ink, entry 250,000 $SLANA |
| `how-a-round-works-1600x900.png`, `how-a-round-works-1080x1080.png` | the four-ticket strip: Buy a ticket, Eat, The bell, Paid |
| `fee-1600x900.png`, `fee-1080x1080.png` | "5%: flat fee, on profit only. Paid at the bell." with the receipt; notes that floor loot is burned |
| `nft-coming-soon-1600x900.png`, `nft-coming-soon-1080x1080.png` | "Slana NFT, coming soon" with three sealed riso cards, CTA to slana.io/wl |
| `countdown-1600x900.png`, `countdown-1080x1080.png` | countdown: flip tiles with the day count and a save-the-date ticket (placeholder date) |

Layouts live in `brand/lib/cards.mjs`; the arena pictures in `brand/lib/scenes.mjs`.
