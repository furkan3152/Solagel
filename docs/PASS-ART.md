# Slana Pass art

Kisa ozet (TR): Pass koleksiyonunu (gorsel + metadata) cevrimdisi uretmek ve onizlemek icin komutlar asagida.

## Usage

Create the reveal seed once (never commit it; `keys/` and `pass-seed*.json` are git-ignored):

    pnpm admin pass-seed --new

Generate the collection (default supply 3333) into `out/pass` (git-ignored):

    pnpm pass:generate --seed-file keys/pass-seed.json --supply 3333 --out out/pass \
      [--site-url https://host] [--base-url https://ipfs-or-arweave/dir/] [--from 1 --to 3333]

It writes `<n>.png` (1024x1024), `<n>.json`, `collection.json`, `collection.png`,
`banner.png` (1500x500) and `rarity-report.md` (counts per tier and trait value over the whole supply).

### URL modes

- `--site-url https://host` (no trailing slash; one is stripped): `image` is `https://host/pass/<n>.png` and
  `external_url` is `https://host`. This is the server's own convention.
- `--base-url <dir/>` (must end with `/`): for third-party hosting such as IPFS or Arweave. `image` is
  `<base-url><n>.png`; `external_url` is the `--site-url` if given, otherwise the field is omitted.
- Neither: `image` is the relative `<n>.png` and `external_url` is omitted.

`external_url` is never emitted empty. The same rules apply to `collection.json`.

### Parity with the server

`<n>.json` and `collection.json` are compact JSON (`serializePassJson`, no trailing newline). With
`--site-url https://h` they are byte-identical to what the server serves at `/pass/<n>.json` and
`/pass/collection.json` for `PUBLIC_URL=https://h` once the same seed is revealed (both call `passJson` /
`collectionJson` from `@slana/art`; covered by tests in `apps/server/test/pass.test.ts` and `packages/art/test/cli.test.ts`).

### Preview

Preview a throwaway seed as an HTML grid (64 hex chars; do not use the real seed):

    pnpm pass:preview --seed <hex> --count 60 --out out/preview.html
