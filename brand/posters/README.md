# Arena posters

One collectible riso print per arena, 2000×2800 (5:7), with trim and registration marks, a worn ink border in the
arena's ink, the arena illustration, an edition seal, the entry ticket and a colour bar of the inks used. Re-run from
the repo root:

```
node brand/posters/generate.mjs             # all four
node brand/posters/generate.mjs --only 2    # one arena by id
```

| File | Arena |
| --- | --- |
| `poster-1-penny-pond.png` | Penny Pond (red): a penny lounging on a lily pad, entry 1,000 $SLANA |
| `poster-2-silver-creek.png` | Silver Creek (teal): a silver coin leaping the creek, entry 10,000 $SLANA |
| `poster-3-gold-lake.png` | Gold Lake (gold): the gold coin rising like the sun over the lake, entry 50,000 $SLANA |
| `poster-4-whale-bay.png` | Whale Bay (blue): a whale-sized coin breaching with a spout, entry 250,000 $SLANA |

For print, scale to 50×70 cm (about 100 dpi) or re-render larger by changing `W`/`H` in the script.
