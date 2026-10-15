# Slana: setup and deployment guide (devnet → mainnet)

This guide covers building and deploying the Solana program, wiring up the $SLANA token, setting up the Slana Pass
collection and mint, opening the arenas and putting the game server live. For day-to-day work (seasons, the reveal, the
treasury, pausing, key rotation, backups): [OPERATIONS.md](OPERATIONS.md). Architecture and trust model:
[ARCHITECTURE.md](ARCHITECTURE.md). Commands are quoted from `pnpm admin help` and `apps/server/.env.example`.
**Try it on devnet first.**

> **Legal and security warning.** Slana is a game played with a token of real value and may need a licence where you
> operate. The Pass's in-game power can count as a "purchased advantage". The smart contract **has not been audited**:
> get an audit before opening it with real money on mainnet, and start with small fees. To close the arenas without
> touching the chain, set `STAKE_ENABLED=false` on the server.

Every admin command runs as `pnpm admin <command>`; the full list is `pnpm admin help`. Common options:

| Option | Default |
|---|---|
| `--url <rpc>` | `$SOLANA_RPC_URL` or `http://127.0.0.1:8899` |
| `--keypair <path>` | `~/.config/solana/id.json` (signs and pays the fee) |
| `--program <id>` | `$PROGRAM_ID` or the IDL address in the SDK |
| `--cluster <name>` | derived from `--url` (for explorer links) |
| `--verbose` | prints the transaction logs on errors |

Token amounts (`--entry`, `--amount`, `--min-tokens`) are written in **whole tokens** (`.` as the decimal point) and
scaled by the mint's decimals. The examples below leave `--url` out for brevity: `export SOLANA_RPC_URL=...` or add it to
every command.

---

## 0. Requirements

| Tool | Version | Note |
|---|---|---|
| Node.js | 22+ | `corepack enable` (pnpm 10.28.0, `packageManager` in `package.json`) |
| Rust | 1.97.1 | selected by `rust-toolchain.toml` |
| Solana (Agave) CLI | 4.3.x | `solana`, `solana-keygen`, `cargo-build-sbf` |
| Anchor CLI | 1.2.1 | `npm i -g @anchor-lang/cli@1.2.1` |

```bash
pnpm install
```

## 1. Third-party programs

The program tests (LiteSVM) load the Metaplex Core program. Download it once:

```bash
scripts/fetch-programs.sh                    # Core from mainnet → target/programs/mpl_core.so
MAINNET_RPC=<url> scripts/fetch-programs.sh  # with another RPC
```

The script downloads the `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` program with `solana program dump`; it skips the
download if the file exists. `target/` is not tracked by git: third-party `.so` files are **never committed**. Core is
already deployed on devnet and mainnet.

## 2. Program keypair and build

Two crates build from this repository. Only one of them is deployed:

| Crate | Output | Role |
|---|---|---|
| `programs/slana-lean` (Pinocchio, `no_std`) | `target/deploy/slana_lean.so`, 59,344 bytes, at most 71,000 (size gate) | **the deployed program** |
| `programs/slana-ref` (Anchor 1.2.1) | `target/deploy/slana.so` (~679 KB) and the IDL | never deployed: it is the source of the IDL and TS types, and the conformance oracle in the tests |

Both use the same program id. The `declare_id!` in the repo is a development address. **Generate your own program
keypair**:

```bash
solana-keygen new -o target/deploy/slana-keypair.json   # back this file up safely; never commit it
anchor keys sync                                        # updates declare_id! (slana-ref) and Anchor.toml
# also put the new id into `ID` in programs/slana-lean/src/lib.rs (32 bytes;
# `cargo test -p slana-lean` fails while it differs from the reference's declare_id!)
anchor build --ignore-keys                              # Anchor reference: IDL + target/deploy/slana.so (never deployed)
pnpm -F @slana/sdk sync-idl                             # copies the IDL into the SDK (client, server and admin use it)
bash scripts/build-lean.sh                              # deployed program: target/deploy/slana_lean.so (prints size and rent)
scripts/test-program.sh                                 # LiteSVM suite against both builds (needs the Core .so from step 1)
```

`scripts/build-lean.sh` runs `cargo build-sbf --manifest-path programs/slana-lean/Cargo.toml`, deletes the random
`target/deploy/slana_lean-keypair.json` that cargo-build-sbf writes, and prints the size and the ProgramData rent. It only
warns when `target/deploy/slana-keypair.json` is not the program id (on a fresh checkout `anchor build --ignore-keys`
writes a random one); the hard check is in `scripts/deploy-lean.sh` (and `scripts/localnet.sh`), where the keypair is
used.

> **Never use `anchor deploy`.** It deploys the Anchor reference `slana.so` (~◎4.73 of rent) instead of the lean
> program. Always deploy with `scripts/deploy-lean.sh <cluster-url> <keypair>`: it checks that the keypair is the lean
> program id, then runs `solana program deploy target/deploy/slana_lean.so --program-id <keypair>`.

## 3. Keys

The `keys/` folder is not tracked by git (`.gitignore`: `keys/`, `*.keypair.json`, `pass-seed*.json`, `.env`).

| Key | What it does | Recommendation |
|---|---|---|
| Admin wallet (`SLANA_ADMIN` in `scripts/admin.env`: `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`) | the project owner's wallet; the program's **upgrade authority**; `init` can only be signed by it; it becomes the Config `admin`; **every admin command is run by this wallet** (`--keypair <its keypair file>`) | the owner's own wallet; a multisig (Squads) is optional later |
| Temporary deployer (`keys/deployer.json`) | pays for the deploy and is the upgrade authority only until `deploy-lean.sh` hands it to the admin | throwaway; keep a little SOL, delete it afterwards |
| Server (`keys/server.json`) | signs `settle_session` (`Config.server_authority`) | a separate **hot key** on the server that only settles sessions; it can never withdraw, upgrade or administer; a little SOL |
| Treasury owner | `withdraw-treasury --to` and the recipient of the collection royalty | multisig |
| Pass seed (`keys/pass-seed.json`) | the secret seed of the commit–reveal | **secret and backed up**; if it is lost the reveal cannot happen |

```bash
mkdir -p keys
solana-keygen new -o keys/server.json --no-bip39-passphrase
solana-keygen new -o keys/deployer.json --no-bip39-passphrase   # temporary deployer, see section 4
```

The admin wallet's address lives in one place, `scripts/admin.env` (`SLANA_ADMIN=...`); it is a public key and is
committed. Its secret key never touches the repository or the server.

## 4. Deploy the program (devnet)

The order matters. Deploy with a temporary deployer key, hand the upgrade authority to the admin, then the admin
initializes and sets everything up:

1. **Deploy** with the temporary deployer key (it pays the rent and is the first upgrade authority).
2. **Move the upgrade authority to the admin**. `scripts/deploy-lean.sh` does this by itself right after a successful
   deploy or upgrade (`solana program set-upgrade-authority <ID> --new-upgrade-authority <ADMIN>
   --skip-new-upgrade-authority-signer-check`), prints the authority before and after, and skips it when the admin
   already is the authority. `--keep-authority` leaves it as the deployer (localnet and tests only).
3. **The admin runs `init`** (section 6): the program only accepts the upgrade authority as signer, so the Config
   `admin` becomes the admin wallet.
4. **The admin runs** the collection, seed, mint and arenas steps (sections 7, 8, 11). Every `pnpm admin` command is
   signed by the admin wallet.

```bash
solana airdrop 5 $(solana-keygen pubkey keys/deployer.json) -u devnet   # if needed, https://faucet.solana.com
scripts/deploy-lean.sh devnet target/deploy/slana-keypair.json --keypair keys/deployer.json
# prints: upgrade authority before/after (after = D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm)
solana transfer $(solana-keygen pubkey keys/server.json) 0.5 --allow-unfunded-recipient --keypair keys/deployer.json -u devnet
```

Never `anchor deploy` (it deploys the reference) and never `--final`: the program stays upgradeable so that it can be
closed at any time (OPERATIONS.md, "Emergency stop / close"). Later upgrades are signed by the admin:
`scripts/deploy-lean.sh <url> target/deploy/slana-keypair.json --keypair <admin keypair> --upgrade-authority <admin keypair>`.

## 5. Token

The program writes the mint address into the Config **once**, during `init`; it cannot be changed later. Requirements
(checked by the program and by `pnpm admin init`):

- an SPL Token or Token-2022 mint;
- **no freeze authority** (a mint with a `freeze authority` is refused);
- for Token-2022, these extensions are refused: TransferFeeConfig, TransferHook, PermanentDelegate, NonTransferable,
  DefaultAccountState, ConfidentialTransferMint, ConfidentialTransferFeeConfig, Pausable, MintCloseAuthority,
  ConfidentialMintBurn (the metadata extensions are allowed);
- a supply of at most 2^53 − 1 base units (the admin CLI refuses a larger one; the server closes the arenas).

On mainnet, use the $SLANA mint address. For a devnet trial, create a test mint without a freeze authority (e.g.
`spl-token create-token --decimals 6`) and mint yourself some.

## 6. Initialize the program: `init --mint`

Run this as the admin wallet (`--keypair` is the admin's keypair file; every later admin command takes it too, or
copy it to `~/.config/solana/id.json`, the default):

```bash
ADMIN_KP=~/keys/slana-admin.json    # the keypair file of D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm
pnpm admin init --keypair $ADMIN_KP --mint <MINT> --server $(solana-keygen pubkey keys/server.json)
pnpm admin status --keypair $ADMIN_KP
```

> **Hardware wallet.** `pnpm admin` (packages/sdk/src/admin.ts) loads `--keypair` only as a JSON keypair file; it does
> **not** support `usb://ledger`. The Solana CLI steps (`deploy-lean.sh`, `set-upgrade-authority`, `close-program.sh`)
> do. To keep the admin on a Ledger today, either import the keypair file into a secure machine for the admin session,
> or do the upgrade-authority step with the Solana CLI and run the `pnpm admin` commands from an offline-stored
> keypair file. SDK support for hardware signing is an open item.

`init` creates the Config, the treasury and season vaults and season 1. Defaults (`pnpm admin help`):

| Option | Default | Meaning |
|---|---|---|
| `--fee-bps` | 500 | 5 % fee on profit (upper bound 1000 = 10 %) |
| `--pass-fee-bps` | 200 | 2 % on a Pass ticket (≤ `--fee-bps`) |
| `--split` | 5000/3000/2000 | treasury / season / burn share of the fee (total 10000) |
| `--settle-fee-lamports` | 20000 | payout deposit per ticket (≤ 1 000 000) |

The signer must be the program's upgrade authority; otherwise `init` is refused. Pass defaults: supply 3,333, 1 per
wallet, no minimum token requirement.

## 7. Slana Pass: seed and collection

The order matters: the seed hash must be on-chain **before the first mint**, and the collection is set once.

```bash
pnpm admin pass-seed --new                 # keys/pass-seed.json: 32 random bytes, prints its sha256
pnpm admin set-seed-hash                   # sha256(seed) on-chain (before the first mint)
pnpm admin create-collection --name "Slana Pass" --uri https://<domain>/pass/collection.json \
  --royalty-bps 500 --royalty-to <treasury owner>
pnpm admin set-pass-collection --collection <C>   # the address printed by create-collection; once
```

- `create-collection` creates the Core collection; its update authority is the program's `["pass_authority"]` PDA, so
  only the program can mint Passes. The Royalties plugin writes a `--royalty-bps` royalty to the `--royalty-to` address.
- `pass-seed --new` does not overwrite an existing file (it needs `--force`; the old seed is lost). **Back up** the seed
  and **do not commit it**.
- The seed alone does not decide the traits: after the mint is over, `reveal` publishes the seed and only then records a
  target slot ~150 slots ahead; that slot's hash becomes the entropy (through `capture_pass_entropy`, which anyone can
  send and the game server sends automatically) and the traits are computed with
  `passTraits(sha256(seed ‖ entropy), n, supply)`. So not even the admin can know which number will be rare while the
  mint is running.
- Set the supply (`update-config --supply N`, default 3333) **before opening the mint**: once the mint has opened, the
  program locks the supply (`SupplyLocked`).
- By default the collection images and metadata are served by the game server (`/pass/...`); `<domain>` is the server's
  `PUBLIC_URL`. Arweave and image generation: [PASS-ART.md](PASS-ART.md).

## 8. Arenas

```bash
pnpm admin create-arena --defaults         # the four default arenas (skips existing ones)
pnpm admin create-arena --id 5 --entry 5000 --max 300 [--pass]
pnpm admin update-arena --id 2 --enabled false
```

Default arenas (`packages/shared/src/arenas.ts`, `DEFAULT_ARENAS`):

| id | Name | Fee | Pass | Open tickets at once |
|---|---|---|---|---|
| 1 | Penny Pond | 1,000 $SLANA | not needed | 300 |
| 2 | Silver Creek | 10,000 $SLANA | not needed | 300 |
| 3 | Gold Lake | 50,000 $SLANA | required | 300 |
| 4 | Whale Bay | 250,000 $SLANA | required | 300 |

`--max` is between 2 and 2000. An arena's fee and Pass requirement cannot change while it has open tickets (the program
refuses). The server reads the arena list from the chain every 30 s; new arenas appear in the lobby by themselves.

## 9. Game server

Example file: `apps/server/.env.example`. The server does **not read** the `.env` file itself; pass the variables through
the environment (Docker: `--env-file`, systemd: `EnvironmentFile=`, by hand: `set -a; . apps/server/.env; set +a`).

Required for the chain: `PROGRAM_ID`, `SOLANA_RPC_URL`, `SERVER_KEYPAIR`. If one is missing, the server runs without a
chain (practice only).

| Variable | Default (code) | Note |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `data` | journal (owed payouts!), tables and the Pass image cache. Use a persistent disk |
| `AUTH_SECRET` | random | `openssl rand -hex 32`; without it players sign in again after every restart |
| `CORS_ORIGIN` | `*` | |
| `TRUST_PROXY` | `0` | `1` behind a reverse proxy (X-Forwarded-For / -Proto / -Host) |
| `PUBLIC_URL` | empty | the server's public address (`https://slana.example`); Pass metadata links and the domain in the wallet login (SIWS). If the web page is served from another domain, the login message shows the game server's name. **Set it in production** |
| `MARKET_URLS` | empty | JSON (`magicEden`, `tensor`, `opensea`); only https links are used |
| `MARKET_URL_MAGICEDEN` / `_TENSOR` / `_OPENSEA` | empty | take precedence over `MARKET_URLS` |
| `WEB_DIST` | empty | serves the web build from this folder (single origin) |
| `PRACTICE_CAPACITY` | `40` | humans per practice room |
| `PRIVATE_ROOM_CAPACITY` | `20` | |
| `ARENA_INSTANCE_CAP` | `50` | humans per arena instance; when full, `arena-<id>-<n>` opens |
| `BOT_TARGET` / `BOT_MIN` / `BOT_MAX` | `20` / `4` / `20` | practice bots |
| `ARENA_BOT_TARGET` / `ARENA_BOT_MIN` / `ARENA_BOT_MAX` | `24` / `2` / `16` | arena bots (worth 0) |
| `PRIVATE_BOT_TARGET` | `8` | |
| `PASS_START_MASS_MUL` | `1.15` | Pass power: start mass multiplier (at least 1; `1` = off) |
| `PASS_CASHOUT_MS` | `2000` | cash-out time on a Pass ticket (normal time 3000; `3000` = no advantage) |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | `600` / `8` | |
| `SOLANA_CLUSTER` | `localnet` | `localnet`, `devnet` or `mainnet-beta` |
| `SOLANA_RPC_URL` | empty | the server's RPC (may contain an API key; a paid RPC is recommended on mainnet) |
| `SOLANA_WS_URL` | empty | optional websocket RPC (only in `config.ts`) |
| `PUBLIC_RPC_URL` | empty | the RPC announced to browsers; **must not contain secrets** |
| `PROGRAM_ID` | empty | the program you deployed |
| `SERVER_KEYPAIR` | empty | keypair file path or JSON array; must equal `Config.server_authority` |
| `STAKE_ENABLED` | `true` | `false`: the arenas close without touching the chain (payouts go on) |
| `STAKE_ARENA_IDS` | empty | only these arena ids (comma-separated); empty = every enabled arena on-chain |
| `TOKEN_SYMBOL` | `$SLANA` | display only. Some env loaders expand `$NAME`; it is commented out in the example file |
| `PRIORITY_FEE_MICROLAMPORTS` | `5000` | priority fee of the payout transactions |
| `STALE_SESSION_AFTER_S` | `900` | wait (s) before refunding a ticket that was never played; shorter values are for tests only (localnet e2e: `5`) |
| `STALE_SWEEP_ACK` | empty | `1`: a quarantined journal (`journal.json.corrupt-*`) has been inspected and the stale-ticket sweeper may run again (see OPERATIONS) |
| `DEV_FAKE_CHAIN` | empty | **development only**: needs `NODE_ENV=development`, refuses to start while `PROGRAM_ID`/`SERVER_KEYPAIR` is set |
| `DEV_FAKE_PASS` | `mint` | with `DEV_FAKE_CHAIN` only: `mint` (open, unrevealed mint; `POST /api/dev/pass/reveal` reveals) or `revealed` (every wallet has a revealed Pass) |

The server key pays the fee of the payout transactions; every ticket pays it back with the `settle_fee_lamports`
deposit. The server **never** pays the rent of players' token accounts: the game of a player without an account (or
whose account refuses the payout) is still settled at once, the payout stays in the vault as `owed`, and the lobby shows
a "Collect payout" call (R24; the player opens the account themselves, with no waiting time). The server logs a warning
when the server key drops below 0.05 SOL.

Locally: `pnpm dev` (server :8787 + web :5173; Vite forwards `/ws` and `/api` to the server).

## 10. Docker

```bash
docker build -t slana .
docker run -p 8787:8787 -v slana-data:/data --env-file apps/server/.env slana
```

One container = game server + web client (same origin). The image sets `NODE_ENV=production`, `DATA_DIR=/data`,
`WEB_DIST=/app/web`, `TRUST_PROXY=1`; `/data` is a volume (the journal lives there: **it must be persistent**). The health
check is `GET /api/health`. The server returns `index.html` for client paths such as `/docs`, so the player guide opens
at `https://<domain>/docs`.

To host the web client separately, the build arguments are `VITE_SERVER_URL` (the game server's address) and
`VITE_RPC_URL` (the browser's RPC). The static host must also fall back to `index.html` for `/docs` (SPA fallback). Pass
metadata always comes from the game server (`PUBLIC_URL`).

## 11. Open the Pass mint

The server must be live with `PUBLIC_URL` first: marketplaces fetch `/pass/<n>.json` and the images from it.

```bash
pnpm admin open-mint --base-uri https://<domain>/pass/ [--start <unix>] [--supply N] [--per-wallet N] [--min-tokens X]
pnpm admin status                          # "mint OPEN", minted / supply
```

- `--base-uri` must end with `/` and be at most 96 bytes. The program writes `<base-uri><n>.json` into every Pass, and
  **the base URI cannot change after the first mint**.
- `open-mint` does not run before the collection and the seed hash are set; once the mint is over (`close-mint` or the
  supply sold out) it cannot reopen.
- The mint is free: the minter pays only the rent of the Core asset and of the wallet counter, plus the network fee.
- Pass traits are computed with `passTraits(final seed, n, supply)`; final seed = `sha256(seed ‖ entropy)`. The supply
  is locked when the mint first opens: `open-mint --supply` only works on the first opening; after that both the program
  and the CLI refuse it.

To end the mint (`close-mint`), publish the seed (`reveal`, records the target slot) and complete the reveal
(`capture-entropy`; the server and the web do it too): [OPERATIONS.md](OPERATIONS.md#pass-reveal).

## 12. Mainnet

1. Do the program keypair and the build (step 2) for mainnet; complete the whole flow (ticket → game → cash-out → payout →
   season) on devnet first.
2. `solana config set --url mainnet-beta` (or a paid RPC), and put as much SOL as the costs below into the admin wallet.
3. `bash scripts/build-lean.sh && scripts/deploy-lean.sh mainnet-beta target/deploy/slana-keypair.json --keypair keys/deployer.json`
   (never `anchor deploy`: it ships the Anchor reference). The script moves the upgrade authority to the admin wallet.
4. Repeat steps 6–11 with the mainnet RPC. `SOLANA_CLUSTER=mainnet-beta`, a paid `SOLANA_RPC_URL`, a secret-free
   `PUBLIC_RPC_URL`.
5. The admin wallet already holds the upgrade authority and the Config `admin`. Optionally, later, hand both to a
   multisig (`solana program set-upgrade-authority`, `pnpm admin update-config --admin <multisig>`). **Do not make the
   program immutable** (`--final`): the owner wants to be able to close it at any time, see
   [OPERATIONS.md](OPERATIONS.md#emergency-stop--close). `scripts/close-program.sh` needs the upgrade authority.
6. Start with small fees; watch `pnpm admin status` and the server logs.

## 13. Mainnet costs

Rent = `(bytes + 128) × 6960` lamports (default rent: 3480 lamports per byte-year × the 2-year exemption). `solana rent
<bytes>` needs an RPC; the values below were computed with this formula.

**Program deployment.** The deployed program is `target/deploy/slana_lean.so` = **59,344 bytes**
(`bash scripts/build-lean.sh`; the size gate `tests/size.rs` and CI fail above 71,000 bytes or ◎0.5 of rent). Rent is
`(len + 45 + 128) × 6960` lamports for the ProgramData.

| Account | Bytes | Rent |
|---|---|---|
| ProgramData (`.so` + 45) | 59,389 | (59,344 + 45 + 128) × 6960 = **414,238,320 lamports ≈ ◎0.4142** (locked while the program exists; recovered with `solana program close`) |
| Program account | 36 | 1,141,440 lamports ≈ ◎0.0011 (locked) |
| Deploy buffer (`.so` + 37, temporary) | 59,381 | 414,182,640 lamports ≈ ◎0.4142 (returned to the payer when the deploy finishes) |

So the wallet needs about **◎0.83 + transaction fees** during the deploy (◎0.8296 of rent), and **◎0.4154** stays
locked in the program afterwards. The localnet e2e reads the same ProgramData balance (◎0.41423832) from the validator.
For comparison, the Anchor reference (679,256 bytes) would lock ◎4.73 and need ◎9.46 during a deploy: this is why it
is never deployed.

`solana program deploy` sizes the ProgramData to the program by default (`--max-len`), so a larger later version needs
`solana program extend` first (same rent per extra byte). To reserve room up to the size gate at once, deploy with
`--max-len 71000`: the ProgramData then holds 71,045 bytes, 495,364,080 lamports ≈ ◎0.4954, still under ◎0.5. The deploy
peak is then 495,364,080 (ProgramData) + 414,182,640 (buffer) + 1,141,440 (program account) = **910,688,160 lamports
≈ ◎0.91** + transaction fees.

**Account rents (exact, `(bytes + 128) × 6960` lamports).** The sizes are the programs' `INIT_SPACE` values; they are the
same for the lean program and the reference (the layout tests compare them), and the SDK's `ACCOUNT_BYTES` and an SDK
test recompute them from the IDL.

| Account | Bytes | Rent | Paid by |
|---|---|---|---|
| Config | 507 | 4,419,600 ≈ ◎0.0044 | admin (`init`) |
| Season | 1289 | 9,862,320 ≈ ◎0.0099 | admin (`init`, then each `end-season`) |
| Arena | 74 | 1,405,920 ≈ ◎0.0014 | admin (`create-arena`) |
| Vault / token account (SPL Token) | 165 | 2,039,280 ≈ ◎0.0020 | admin (treasury, season and arena vaults); player (own token account, stays with the player) |
| Token account (Token-2022, with extensions, e.g.) | 170 | 2,074,080 ≈ ◎0.0021 | admin / player |
| Core collection + Royalties plugin (one recipient) | ≈ 170 (**estimate**) | ≈ 2,074,080 ≈ ◎0.0021 | admin (`create-collection`) |
| PlayerProfile | 135 | 1,830,480 ≈ ◎0.0018 | player (stays with the player) |
| Session | 151 | 1,941,840 ≈ ◎0.0019 | player (returned when the ticket closes) |
| PassLock | 73 | 1,398,960 ≈ ◎0.0014 | player (returned when the ticket closes) |
| MintCounter | 10 | 960,480 ≈ ◎0.0010 | player (first Pass mint) |
| Core asset (Slana Pass, e.g. with `https://slana.example/pass/`) | ≈ 127 | ≈ 1,774,800 ≈ ◎0.0018 | player (each Pass mint) |

The Core collection size is an estimate: ≈ 49 + name + URI + ~69 plugin bytes, i.e. ≈ 170 bytes with `Slana Pass` and a
42-byte URI (6960 lamports per byte; the exact amount depends on Core's account layout, so check it with
`solana rent <bytes>` or with the account's balance after the transaction).

**Setup (paid by the admin, one-off).** `init` = Config + Season 1 + the treasury and season vaults (SPL token accounts)
≈ ◎0.0143 + 2 × ◎0.0020 ≈ ◎0.018. Each `create-arena` = Arena + vault = 1,405,920 + 2,039,280 lamports ≈ ◎0.0034; the 4
default arenas ≈ ◎0.0138. Each `end-season` = a new Season ≈ ◎0.0099. `create-collection` ≈ ◎0.0021 (estimate above).

**Ongoing.** Hosting the game server and a paid RPC. The server key pays the fee of the payout transactions; every ticket
covers it with a 20,000-lamport deposit (base fee 5,000 lamports per signature + `PRIORITY_FEE_MICROLAMPORTS` × compute
units). Keep some SOL on the key as a buffer (the server warns below ◎0.05).

**What the player pays (for reference).** Session rent ≈ ◎0.00194 and the Pass lock ≈ ◎0.0014 (returned when the ticket
closes); profile ≈ ◎0.0018 and token account ≈ ◎0.0020 (stay with the player); deposit ◎0.00002; Pass mint: the Core
asset ≈ ◎0.0018 + the counter on the first mint ≈ ◎0.00096 (sizes and rents in the table above).
