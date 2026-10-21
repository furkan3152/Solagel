# Story templates

1080×1920 verticals for X, Instagram and Telegram stories. Key content sits between y 250 and y 1670, clear of the
story UI. Re-run from the repo root:

```
node brand/stories/generate.mjs                # every story
node brand/stories/generate.mjs --only arena   # by name prefix (wl, arena, arena-3 ...)
```

| File | Story |
| --- | --- |
| `story-wl-open-1080x1920.png` | "WL is open", CTA ticket to slana.io/wl |
| `story-arena-1-penny-pond-1080x1920.png` | arena reveal: Penny Pond, 1,000 $SLANA |
| `story-arena-2-silver-creek-1080x1920.png` | arena reveal: Silver Creek, 10,000 $SLANA |
| `story-arena-3-gold-lake-1080x1920.png` | arena reveal: Gold Lake, 50,000 $SLANA |
| `story-arena-4-whale-bay-1080x1920.png` | arena reveal: Whale Bay, 250,000 $SLANA |

The designs are shared with the X posts (`brand/lib/cards.mjs`, tall layout).
