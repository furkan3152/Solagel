# Slana Pass art

Kisa ozet (TR): Pass koleksiyonunu (gorsel + metadata) cevrimdisi uretmek ve onizlemek icin komutlar asagida.

## Usage

Create the reveal seed once (never commit it; `keys/` and `pass-seed*.json` are git-ignored):

    pnpm admin pass-seed --new

Generate the whole collection (default supply 3333) into `out/pass` (git-ignored):

    pnpm pass:generate --seed-file keys/pass-seed.json --supply 3333 --out out/pass \
      [--base-url https://example.com/pass/] [--from 1 --to 3333]

It writes `<n>.png` (1024x1024), `<n>.json`, `collection.json`, `collection.png`,
`banner.png` (1500x500) and `rarity-report.md`. Without `--base-url` the `image`
field is the relative `<n>.png`; with it the field is `<base-url><n>.png` and the
base URL must end with `/`. The JSON is byte-identical to what the server serves
at `/pass/<n>.json` for the same seed (both use `revealedPassMetadata` from `@slana/art`).

Preview a throwaway seed as an HTML grid (64 hex chars; do not use the real seed):

    pnpm pass:preview --seed <hex> --count 60 --out out/preview.html
