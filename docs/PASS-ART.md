# Slana Pass art

*Türkçe özet: Pass koleksiyonunun görselleri ve metadata'sı oyunun çizim koduyla üretilir. Varsayılan olarak oyun
sunucusu servis eder (`/pass/...`); çevrimdışı üretim, Arweave seçeneği ve açılış (reveal) adımları aşağıda.*

Every Slana Pass is a risograph coin character drawn by the same code in the game, on the Pass page, in the server's
metadata images and in the offline generator (`packages/art`). Its traits are a pure function of the final seed, the
Pass number and the collection supply: `passTraits(finalSeed, n, supply)`, where

    finalSeed = sha256(seed ‖ entropy)          (Config.pass_final_seed, stored by capture_pass_entropy)

The order is fixed by the program (ruling R23):

1. the mint ends (`close_pass_mint` or the last Pass of the supply);
2. `reveal_pass` publishes `seed` (checked against `sha256(seed)`, committed before the first mint) and only then sets
   the entropy target slot (that slot + 150);
3. once the target has passed, anyone sends `capture_pass_entropy`: the program stores as `entropy`
   (`Config.pass_entropy`) the SlotHashes hash of the first slot at or after the target, computes the final seed and
   marks the Pass revealed.

Nobody, the team included, can know a number's traits while it can still be minted, and once the seed is public
everybody learns the outcome at the same moment. Letting the SlotHashes window pass without a capture would re-target,
but anyone (the game server, the web Pass page, any holder) can capture first. Since the leader schedule is public, the
timing of the reveal (or of a re-target) selects which leader produces the target slot, and a colluding leader could
grind or skip that slot: the same class of risk as any Solana leader's influence on its slot's bank hash.

## Traits and rarity

- Layers: ink (body), overprint, symbol, eyes, mouth, accessory, paper; weights live in `packages/art/src/traits.ts`.
- `passCollection(seed, supply)` builds the whole collection at once: ten 1/1 slots (`ONE_OF_ONE_COUNT`) are placed by
  the seeded RNG, every other Pass is unique by its trait combination, then Passes are ranked by score: the top 2 % of the
  supply (1/1s included, `LEGENDARY_SHARE`) is **legendary** with a gold-leaf or hologram special, the next 18 %
  (`RARE_SHARE`) is **rare**, the rest **common**.
- Because 1/1 placement, de-duplication and ranking run over the whole collection, the traits depend on `supply`. The
  server uses the on-chain `pass_supply`; the generator's `--supply` must equal it. The program freezes `pass_supply`
  once the mint opens ([OPERATIONS.md](OPERATIONS.md#pass-açılışı-reveal)).
- Before the reveal every Pass is drawn as the sealed passport (a red wax-seal coin).

## Seed

Create the reveal seed once, before the mint (never commit it; `keys/` and `pass-seed*.json` are git-ignored):

    pnpm admin pass-seed --new                 # writes keys/pass-seed.json (32 bytes) and prints its sha256
    pnpm admin set-seed-hash                   # commits sha256(seed) on-chain, before the first mint

Keep the file secret and backed up: without it the collection cannot be revealed. The seed alone does not determine the
traits: they also need the entropy captured after the seed is published.

## Generator

Generate the collection (default supply 3333) into `out/pass` (git-ignored). It needs the mint to have ended (the
entropy exists only once it is captured); take `entropy` from `pnpm admin status`:

    pnpm pass:generate --seed-file keys/pass-seed.json --entropy <pass_entropy hex> --supply 3333 --out out/pass \
      [--site-url https://host] [--base-url https://ipfs-or-arweave/dir/] [--from 1 --to 3333]

    pnpm pass:generate --final-seed <pass_final_seed hex> --supply 3333 --out out/pass      # after the reveal, anyone

| Flag | Default |
|---|---|
| `--seed-file` | `keys/pass-seed.json` (a JSON array of 32 bytes, as written by `pnpm admin pass-seed --new`) |
| `--entropy` | required with `--seed-file`: `Config.pass_entropy` (64 hex chars); the final seed is `sha256(seed ‖ entropy)` |
| `--final-seed` | instead of the two above: `Config.pass_final_seed` (64 hex chars), public after the reveal |
| `--supply` | `3333` (must equal the on-chain `pass_supply`) |
| `--out` | `out/pass` |
| `--from` / `--to` | `1` / the supply (render a range) |
| `--site-url` / `--base-url` | none (see URL modes) |

`pnpm pass:generate --help` prints the usage. Relative paths resolve from the directory you ran the command in.

It writes `<n>.png` (1024x1024), `<n>.json`, `collection.json`, `collection.png`, `banner.png` (1500x500) and
`rarity-report.md` (counts per tier and trait value over the whole supply).

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
`/pass/collection.json` for `PUBLIC_URL=https://h` once the same final seed is revealed (both call `passJson` /
`collectionJson` from `@slana/art`; covered by tests in `apps/server/test/pass.test.ts` and `packages/art/test/cli.test.ts`).

### Preview

Preview a throwaway seed as an HTML grid (64 hex chars; do not use the real seed):

    pnpm pass:preview --seed <hex> --count 60 --out out/preview.html

Defaults: `--supply 3333`, `--count 60`, `--out out/preview.html`. Each card shows its number and tier.

## Hosting

A Pass's metadata URI is written once, at mint, as `pass_base_uri + "<n>.json"` (the base URI must end with `/`, is at
most 96 bytes and is frozen after the first mint). The collection's update authority is the program's `pass_authority`
PDA and the program has no instruction that rewrites an asset's URI, so **the base URI you open the mint with is
permanent**. Choose it before `pnpm admin open-mint --base-uri <url>/`.

### Option A: the game server (default)

    pnpm admin create-collection --name "Slana Pass" --uri https://<PUBLIC_URL host>/pass/collection.json \
      --royalty-bps 500 --royalty-to <owner>
    pnpm admin open-mint --base-uri https://<PUBLIC_URL host>/pass/

The server answers `GET /pass/<n>.json`, `/pass/<n>.png`, `/pass/collection.json` and `/pass/collection.png`:

- sealed metadata and the sealed image before the on-chain reveal, traits after it (read from the chain config);
- images are rendered on first request with `@napi-rs/canvas` and cached under `DATA_DIR/pass/<first 16 hex of the
  final seed>/` (sealed ones under `DATA_DIR/pass/sealed/`);
- numbers outside `1..supply` are 404; the routes are rate limited per IP (`PASS_RATE_PER_MIN`, 60 per minute);
- set `PUBLIC_URL` (and `TRUST_PROXY=1` behind a proxy): marketplaces cache these links, and without `PUBLIC_URL` the
  JSON is sent with `no-store`.

The trade-off: if the server goes away, marketplace metadata and images go with it. Keep the domain.

### Option B: Arweave or IPFS

Arweave and IPFS content is immutable, so it cannot switch from sealed to revealed by itself, and the on-chain URI cannot
be changed later. Two workable set-ups:

1. **Your domain in front of permanent storage.** Open the mint with a base URI on a domain you control (for example
   the game server's `/pass/`). After the reveal, generate the collection with the final seed, upload the folder, and
   serve the same paths from the upload (reverse proxy or gateway rewrite). Marketplaces keep using your domain.
2. **Reveal-first.** Only if you accept no sealed phase: the URIs must exist before minting, so the traits would be public
   before the mint, which defeats commit–reveal. Not recommended.

For set-up 1, after `pnpm admin reveal`:

    pnpm pass:generate --seed-file keys/pass-seed.json --entropy <pass_entropy hex> --supply <on-chain pass_supply> \
      --out out/pass --base-url https://<gateway>/<folder id>/ --site-url https://<your site>

Upload `out/pass/` as one folder with your Arweave or IPFS tool of choice, check a few `<n>.json` and `<n>.png` against
`https://<your domain>/pass/<n>.json`, then point the domain's `/pass/` path at the folder.

## Reveal

The full procedure, with the commands, is in [OPERATIONS.md](OPERATIONS.md#pass-açılışı-reveal):
`close-mint` (unless sold out), compare `pnpm admin pass-seed` with the on-chain hash in `pnpm admin status`, then
`pnpm admin reveal` (it publishes the seed and sets the entropy target slot); after the target slot the server, the web
Pass page or `pnpm admin capture-entropy` completes the reveal. The server switches to the revealed art within its 30 s config cache; ask
marketplaces to refresh.

Anyone can check the art after the reveal. Read `Config.pass_seed`, `Config.pass_entropy`, `Config.pass_entropy_slot` and
`Config.pass_final_seed` with `pnpm admin status` (`seed public · <hex>`, `entropy <hex> (hash of slot N; target T)`,
`final seed <hex>`) or the SDK (`fetchConfig()` → `passSeed`, `passEntropy`, `passEntropySlot`, `passFinalSeed`). The
capture transaction also logs a readable line, `Pass entropy: slot N hash <hex>`. Check that the seed matches the hash
committed before the mint and that the final seed really is `sha256(seed ‖ entropy)`, then generate:

    node -e "const c=require('crypto'),[s,e]=process.argv.slice(1).map(h=>Buffer.from(h,'hex'));\
      console.log('hash ', c.createHash('sha256').update(s).digest('hex'));\
      console.log('final', c.createHash('sha256').update(s).update(e).digest('hex'))" <seed hex> <entropy hex>
    pnpm pass:generate --final-seed <final seed hex> --supply <on-chain pass_supply> --site-url https://<server> --out out/check

`hash` must equal the `seed hash` line and `final` the `final seed` line. The entropy is the slot's bank hash as the
SlotHashes sysvar lists it (not the block's `blockhash`). The guarantee is that the program reads the sysvar itself,
at its fixed address (any other account is refused with `BadSlotHashes`), in the capture transaction: no caller can
supply the value. With the server's `PUBLIC_URL` as `--site-url`, `out/check/<n>.json` is byte-identical to
`/pass/<n>.json`.
