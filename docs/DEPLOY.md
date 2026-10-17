# Slana: setup and deployment guide (devnet → mainnet)

This guide covers building and deploying the Solana program, initializing it, setting the $SLANA token once it exists,
opening the arenas and putting the game server live. For day-to-day work (the fee wallet, loot burn, pausing, key
rotation, backups): [OPERATIONS.md](OPERATIONS.md). Architecture and trust model: [ARCHITECTURE.md](ARCHITECTURE.md).
Commands are quoted from `pnpm admin help` and `apps/server/.env.example`. **Try it on devnet first.**

The admin steps (init, set-token, arenas, and every later change) can be done two ways, with the same checks and the
same instructions:

- **The admin panel at `/admin`** of the web app, signed by the browser wallet (Phantom, Solflare, or a Ledger through
  either). **Recommended**: the admin key never leaves the wallet or the Ledger. The page is not linked
  from the lobby; open `https://<your domain>/admin`. See "The admin panel" below.
- **The admin CLI** `pnpm admin <command>`, signed by a keypair file.

> **Legal and security warning.** Slana is a game played with a token of real value and may need a licence where you
> operate. The smart contract **has not been audited**: get an audit before opening it with real money on mainnet, and
> start with small fees. To close the arenas without touching the chain, set `STAKE_ENABLED=false` on the server.

## The order

The steps run in this order, and the token comes late on purpose: the program does not need the mint to be deployed or
initialized.

| # | Step | Command | When |
|---|---|---|---|
| 1 | Deploy the program | `scripts/deploy-lean.sh <cluster> target/deploy/slana-keypair.json --keypair keys/deployer.json` | any time; the script also moves the upgrade authority to the admin |
| 2 | Initialize it | `/admin` → Initialize, or `pnpm admin init --server <server pubkey>` | right after the deploy; no mint is needed |
| 3 | Start the game server | see section 7 | any time after `init`; it plays practice only until the token is set |
| 4 | Set the token | `/admin` → Set token, or `pnpm admin set-token --mint <CA>` | later, when the token contract address exists |
| 5 | Open the arenas | `/admin` → Create the 4 default arenas, or `pnpm admin create-arena --defaults` | after `set-token` (the program refuses before it) |

With `SERVER_KEYPAIR=auto` (section 7, recommended) the server creates its own key, so start it (step 3) before step 2:
`/admin` then prefills the server authority with "this server's key".

Steps 3 and 4 can happen in either order. The server re-reads the program config every 30 s until the token is set, so
setting it needs no server restart and no web rebuild: the arenas open by themselves. Arenas created with
`create-arena` can take up to about 60 s to show up in the lobby (the server's 30 s arena refresh plus its 30 s cache).

> **`set-token` is once-only and final.** The program accepts the mint one time and has no instruction to change it. If
> the contract address was wrong, the only way out is to close the program and redeploy it with a new program id
> ([OPERATIONS.md](OPERATIONS.md#emergency-stop--close)). Check the address twice, on devnet first.

### The admin panel (`/admin`)

Open `/admin` on the deployed web app (or `http://localhost:5173/admin` with `pnpm dev`) and connect the admin wallet.

- **Gate.** Before `init` only the program's upgrade authority gets the Initialize form; afterwards only the Config
  `admin`. Any other wallet sees the status read-only and "Connect the admin wallet" with the expected address. The
  program checks every signer itself; the gate is only for convenience.
- **Status.** Cluster and RPC, the program (deployed or not) and its upgrade authority, the Config (admin, server
  authority, fee wallet, fee, settle fee, paused), the token (or "not set"; else mint, program, decimals, symbol,
  supply), the fee wallet's token account and balance, and the arenas (entry fee, enabled, open sessions, vault).
- **Actions.** Initialize; Set token; Create the 4 default arenas or a custom one; Update arena; Update config (fee,
  settle fee, server authority, fee wallet, admin transfer); Pause / Unpause; Sweep arena; Recreate the fee wallet's
  token account. Each one first shows a review sheet with every instruction it will sign (program, decoded values,
  every account with its signer / writable flags) and asks for confirmation before the wallet prompt. Afterwards it
  shows the signature with an explorer link and re-reads the status.
- **Network safety.**
  - **The program id is pinned.** It is the SDK's `PROGRAM_ID`, compiled into the build from the IDL (`anchor keys
    sync`, then `pnpm -F @slana/sdk sync-idl`, section 1). The status card shows it as "Pinned program id". If the game
    server's `/api/config` reports another program id, a red "SIGNING BLOCKED" banner appears and every Sign button is
    disabled.
  - **The cluster comes from the RPC's genesis hash** (mainnet-beta, devnet or testnet). The MAINNET banner and every
    cluster label use it.
  - **Signing is blocked when the genesis hash is unknown, or does not match the cluster that is claimed.** The claim is
    `VITE_SOLANA_CLUSTER`, or else the server's `SOLANA_CLUSTER`. **Set `SOLANA_CLUSTER=mainnet-beta` on a mainnet
    server**: its default, `localnet`, blocks the panel.
  - A validator on the same machine (`127.0.0.1`) counts as localnet when localnet is claimed.
- **RPC and fees.** The RPC is `VITE_RPC_URL`, else the server's public RPC. `VITE_PRIORITY_MICROLAMPORTS` sets the
  compute-unit price of admin transactions: the default is 20,000 micro-lamports and the maximum 200,000. The review
  sheet shows the highest possible fee in SOL.
- **Retries.** After an unknown outcome (a timeout, or an RPC error after the send), "Check and retry" looks up the
  previous signature first. It signs again only once that transaction failed or expired.

The panel and the CLI share their validation and instruction building (`packages/sdk/src/ops.ts`).

### The admin CLI

Every admin command runs as `pnpm admin <command>`; the full list is `pnpm admin help`. Common options:

| Option | Default |
|---|---|
| `--url <rpc>` | `$SOLANA_RPC_URL` or `http://127.0.0.1:8899` |
| `--keypair <path>` | `~/.config/solana/id.json` (signs and pays the fee) |
| `--program <id>` | `$PROGRAM_ID` or the IDL address in the SDK |
| `--cluster <name>` | derived from `--url` (for explorer links) |
| `--verbose` | prints the transaction logs on errors |

Token amounts (`--entry`) are written in whole tokens (`.` as the decimal point) and scaled by the mint's decimals.
The examples below leave `--url` out for brevity: `export SOLANA_RPC_URL=...` or add it to every command.

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

The program tests need no third-party program: there is no Metaplex Core or any other external `.so` to download.

## 1. Program keypair and build

Two crates build from this repository. Only one of them is deployed:

| Crate | Output | Role |
|---|---|---|
| `programs/slana-lean` (Pinocchio, `no_std`) | `target/deploy/slana_lean.so`, 39,032 bytes, at most 71,000 (size gate) | the deployed program |
| `programs/slana-ref` (Anchor 1.2.1) | `target/deploy/slana.so` (454,704 bytes) and the IDL | never deployed: it is the source of the IDL and TS types, and the conformance oracle in the tests |

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
scripts/test-program.sh                                 # LiteSVM suite against both builds
```

`scripts/build-lean.sh` runs `cargo build-sbf --manifest-path programs/slana-lean/Cargo.toml`, deletes the random
`target/deploy/slana_lean-keypair.json` that cargo-build-sbf writes, and prints the size and the ProgramData rent. It only
warns when `target/deploy/slana-keypair.json` is not the program id (on a fresh checkout `anchor build --ignore-keys`
writes a random one); the hard check is in `scripts/deploy-lean.sh` (and `scripts/localnet.sh`), where the keypair is
used.

> **Never use `anchor deploy`.** It deploys the Anchor reference `slana.so` (about ◎3.2 of rent) instead of the lean
> program. Always deploy with `scripts/deploy-lean.sh <cluster-url> <keypair>`: it checks that the keypair is the lean
> program id, then runs `solana program deploy target/deploy/slana_lean.so --program-id <keypair>`.

## 2. Keys

The `keys/` folder is not tracked by git (`.gitignore`: `keys/`, `*.keypair.json`, `.env`).

| Key | What it does | Recommendation |
|---|---|---|
| Admin wallet (`SLANA_ADMIN` in `scripts/admin.env`: `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`) | the project's main wallet; the program's upgrade authority; `init` can only be signed by it; it becomes the Config `admin`; every admin command is run by this wallet (`--keypair <its keypair file>`); it is also the default fee wallet | a wallet you control yourself; a multisig (Squads) is optional later |
| Temporary deployer (`keys/deployer.json`) | pays for the deploy and is the upgrade authority only until `deploy-lean.sh` hands it to the admin | throwaway; keep a little SOL, delete it afterwards |
| Server (`SERVER_KEYPAIR=auto`, or `keys/server.json`) | signs `settle_session` and `sweep_loot` (`Config.server_authority`) | a separate hot key on the server that only settles sessions and burns arena floor loot (up to the vault balance); it can never withdraw to a wallet, upgrade or administer; a little SOL |
| Fee wallet | receives the whole fee of every settlement and the vault of a swept arena | the admin wallet by default (`init --fee-wallet <pubkey>` or `update-config --fee-wallet` choose another) |

```bash
mkdir -p keys
solana-keygen new -o keys/server.json --no-bip39-passphrase
solana-keygen new -o keys/deployer.json --no-bip39-passphrase   # temporary deployer, see section 3
```

The admin wallet's address lives in one place, `scripts/admin.env` (`SLANA_ADMIN=...`); it is a public key and is
committed. Its secret key never touches the repository or the server.

## 3. Deploy the program (devnet)

Deploy with a temporary deployer key, hand the upgrade authority to the admin, then the admin initializes the program:

1. **Deploy** with the temporary deployer key (it pays the rent and is the first upgrade authority).
2. **Move the upgrade authority to the admin**. `scripts/deploy-lean.sh` does this by itself right after a successful
   deploy or upgrade (`solana program set-upgrade-authority <ID> --new-upgrade-authority <ADMIN>
   --skip-new-upgrade-authority-signer-check`), prints the authority before and after, and skips it when the admin
   already is the authority. `--keep-authority` leaves it as the deployer (localnet and tests only).
3. **The admin initializes the program** (section 4) in `/admin` or with `pnpm admin init`: the program only accepts
   the upgrade authority as signer, so the Config `admin` becomes the admin wallet.
4. **Later, the admin sets the token and opens the arenas** (sections 5 and 6), in `/admin` or with the CLI.

```bash
solana airdrop 5 $(solana-keygen pubkey keys/deployer.json) -u devnet   # if needed, https://faucet.solana.com
scripts/deploy-lean.sh devnet target/deploy/slana-keypair.json --keypair keys/deployer.json
# prints: upgrade authority before/after (after = D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm)
solana transfer $(solana-keygen pubkey keys/server.json) 0.5 --allow-unfunded-recipient --keypair keys/deployer.json -u devnet
```

Never `anchor deploy` (it deploys the reference) and never `--final`: the program stays upgradeable so that it can be
closed at any time (OPERATIONS.md, "Emergency stop / close"). Later upgrades are signed by the admin:
`scripts/deploy-lean.sh <url> target/deploy/slana-keypair.json --keypair <admin keypair> --upgrade-authority <admin keypair>`.

## 4. Initialize the program: `init`

**In the admin panel (recommended).** Open `/admin`, connect the admin wallet (the upgrade authority), fill in the
Initialize form and sign. The server authority is prefilled with this server's key when the game server publishes it
(`SERVER_KEYPAIR=auto` or any key: `/api/config` → `chain.serverKey`); the fee wallet defaults to the connected wallet,
the fee to 500 bps and the settle fee to 20,000 lamports.

**With the CLI.** Run this as the admin wallet (`--keypair` is the admin's keypair file; every later admin command takes it too, or
copy it to `~/.config/solana/id.json`, the default):

```bash
ADMIN_KP=~/keys/slana-admin.json    # the keypair file of D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm
pnpm admin init --keypair $ADMIN_KP --server $(solana-keygen pubkey keys/server.json)
pnpm admin status --keypair $ADMIN_KP     # "token: not set (run `pnpm admin set-token --mint <CA>`; arenas open after it)"
```

> **Hardware wallet.** The admin panel signs every admin operation with the browser wallet, so a
> Ledger connected through Phantom or Solflare can be the admin; no keypair file is needed. (`pnpm admin` itself still
> loads `--keypair` only as a JSON keypair file, not `usb://ledger`; the Solana CLI steps `deploy-lean.sh`,
> `set-upgrade-authority` and `close-program.sh` take `usb://ledger` directly.)

`init` creates only the Config: no mint, no vaults. It refuses `--mint` (the token is set later) and a signer that is
not the upgrade authority. Defaults (`pnpm admin help`):

| Option | Default | Meaning |
|---|---|---|
| `--server` | required | the server authority: the hot key that signs settlements and loot burns |
| `--fee-wallet` | the admin signer | where the whole fee is paid (the program refuses the default key) |
| `--fee-bps` | 500 | 5 % fee on profit (upper bound 1000 = 10 %) |
| `--settle-fee-lamports` | 20000 | payout deposit per ticket (≤ 1 000 000) |

The fee has no split: 100 % goes to the fee wallet. There is no treasury vault, season pool or on-chain burn. Tokens
are burned off-chain by hand from the fee wallet (the plan is 75 % burned, 25 % kept).

## 5. Token: `set-token`

Run this when the token contract address (CA) exists. It is once-only: the program writes the mint into the Config
one time (`TokenAlreadySet` afterwards) and nothing can change it.

**In the admin panel (recommended).** Set token → paste the mint → Check mint. The panel reads the mint and shows its
owner program, decimals, supply, mint and freeze authorities and its Token-2022 extensions, and blocks a mint the
program would refuse, with the reason. The review sheet carries a one-time, irreversible warning and enables signing
only after the mint address is typed again exactly.

**With the CLI.**

```bash
pnpm admin set-token --keypair $ADMIN_KP --mint <CA>
pnpm admin status --keypair $ADMIN_KP     # mint, program, decimals, symbol, supply, the fee wallet's token account and balance
```

One transaction does two things: the admin pays for the fee wallet's associated token account of the new mint (an
idempotent create), then `set_token_mint` stores the mint, the token program (read from the mint's owner) and the
decimals. The CLI prints the program, the decimals, the symbol (Token-2022 metadata, else Metaplex Token Metadata, best
effort) and the fee wallet's token account.

Requirements (the panel and the CLI check all of them before anything is signed, with the program's own rules; the
program checks them again):

- an SPL Token or Token-2022 mint;
- no freeze authority (a mint with a `freeze authority` is refused);
- for Token-2022, these extensions are refused: TransferFeeConfig, TransferHook, PermanentDelegate, NonTransferable,
  DefaultAccountState, ConfidentialTransferMint, ConfidentialTransferFeeConfig, Pausable, MintCloseAuthority,
  ConfidentialMintBurn (the metadata extensions are allowed);
- a supply of at most 2^53 − 1 base units (the admin CLI refuses a larger one; the server closes the arenas).

The CLI refuses a second `set-token` (exit code 2, before signing), a signer that is not the admin, and a mint that does
not exist. `create-arena`, `update-arena --entry`, `sweep` and every ticket refuse to run while the token is unset
(`TokenNotSet`, "run set-token first").

> **Do not close the fee wallet's token account, and do not add Token-2022 extensions to it** (for example a required
> memo). If it is missing or unusable, the server holds every settlement and logs a loud `!!!` line until it is
> recreated ([OPERATIONS.md](OPERATIONS.md#the-fee-wallet)).

On mainnet, use the $SLANA mint address. For a devnet trial, create a test mint without a freeze authority (e.g.
`spl-token create-token --decimals 6`) and mint yourself some.

## 6. Arenas: `create-arena --defaults`

In the admin panel: "Create the 4 default arenas" (one transaction for the missing ones; existing ids are skipped), or
a custom arena (id, entry fee in whole tokens, max sessions). "Update arena" enables or disables an arena and changes its
entry fee or session cap. With the CLI:

```bash
pnpm admin create-arena --defaults         # the four default arenas (skips existing ones); needs set-token first
pnpm admin create-arena --id 5 --entry 5000 --max 300
pnpm admin update-arena --id 2 --enabled false
```

Default arenas (`packages/shared/src/arenas.ts`, `DEFAULT_ARENAS`). All four are open to everyone and differ only by
their entry fee:

| id | Name | Entry fee | Open tickets at once |
|---|---|---|---|
| 1 | Penny Pond | 1,000 $SLANA | 300 |
| 2 | Silver Creek | 10,000 $SLANA | 300 |
| 3 | Gold Lake | 50,000 $SLANA | 300 |
| 4 | Whale Bay | 250,000 $SLANA | 300 |

`--max` is between 2 and 2000. An arena's entry fee cannot change while it has open tickets (the program refuses). The
server reads the arena list from the chain every 30 s and caches it for another 30 s, so a new arena can take **up to
about 60 s** to appear in the lobby; it appears by itself.

## 7. Game server

Example file: `apps/server/.env.example`. The server does not read the `.env` file itself; pass the variables through
the environment (Docker: `--env-file`, systemd: `EnvironmentFile=`, by hand: `set -a; . apps/server/.env; set +a`).

Required for the chain: `PROGRAM_ID`, `SOLANA_RPC_URL`, `SERVER_KEYPAIR`.

**Server key: `SERVER_KEYPAIR=auto` (recommended).** On its first start the server creates its hot key in
`DATA_DIR/server-keypair.json` (mode 0600) and keeps using it; it logs the public key and publishes it as
`chain.serverKey` in `/api/config`. The host never has to be handed a secret, and `/admin` prefills that key as the
server authority (Initialize) and warns in Update config while the Config's server authority differs. This **needs a
persistent `DATA_DIR`** (the same disk as the journal): a lost disk means a new key, which must then be set with Update
config. Fund the published address with a little SOL. A keypair file path or a JSON array still works. If one is missing, the server runs without a
chain (practice only). The game token is not an environment variable: the server reads the mint from the program
config at start and every 30 s until it is set. While it is unset the server plays practice only, reports
`tokenReady: false` (`/api/config`, `welcome`), refuses arena joins with `token_not_set` and holds settlements. The web
shows the arenas as "Opening soon". When the mint appears, the server logs `game token set — mint …`, opens the
arenas and pushes a `chain` message to every connected client; nobody has to reload.

| Variable | Default (code) | Note |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `data` | journal (owed payouts!) and the leaderboard tables. Use a persistent disk |
| `AUTH_SECRET` | random | `openssl rand -hex 32`; without it players sign in again after every restart |
| `CORS_ORIGIN` | `*` | |
| `TRUST_PROXY` | `0` | `1` behind a reverse proxy (X-Forwarded-For / -Proto / -Host) |
| `PUBLIC_URL` | empty | the server's public address (`https://slana.io`); the domain in the wallet login (SIWS). If the web page is served from another domain, the login message shows the game server's name. **Set it in production** |
| `WEB_DIST` | empty | serves the web build from this folder (single origin) |
| `PRACTICE_CAPACITY` | `40` | humans per practice room |
| `PRIVATE_ROOM_CAPACITY` | `20` | |
| `ARENA_INSTANCE_CAP` | `50` | humans per arena instance; when full, `arena-<id>-<n>` opens |
| `BOT_TARGET` / `BOT_MIN` / `BOT_MAX` | `20` / `4` / `20` | practice bots |
| `ARENA_BOT_TARGET` / `ARENA_BOT_MIN` / `ARENA_BOT_MAX` | `24` / `2` / `16` | arena bots (worth 0) |
| `PRIVATE_BOT_TARGET` | `8` | |
| `ROUND_SECONDS` | `300` | length of an arena round; rounds are aligned to Unix time, so every arena and instance ends at the same moment. Production keeps the default; shorten it only for demos and tests (`90` for a demo, `30` in the localnet e2e). At least 2 |
| `ROUND_JOIN_CLOSE_SECONDS` | `60` | new joins are refused this long before the bell (`round_closed`; a bought ticket is held until the next round). Capped at half a round (localnet e2e: `5`) |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | `600` / `8` | |
| `SOLANA_CLUSTER` | `localnet` | `localnet`, `devnet` or `mainnet-beta` |
| `SOLANA_RPC_URL` | empty | the server's RPC (may contain an API key; a paid RPC is recommended on mainnet) |
| `SOLANA_WS_URL` | empty | optional websocket RPC (only in `config.ts`) |
| `PUBLIC_RPC_URL` | empty | the RPC announced to browsers; **must not contain secrets** |
| `PROGRAM_ID` | empty | the program you deployed |
| `SERVER_KEYPAIR` | empty | `auto` (recommended: created in `DATA_DIR` on the first start, public key logged and published as `chain.serverKey`), or a keypair file path or JSON array; must equal `Config.server_authority` |
| `STAKE_ENABLED` | `true` | `false`: the arenas close without touching the chain (payouts go on) |
| `STAKE_ARENA_IDS` | empty | only these arena ids (comma-separated); empty = every enabled arena on-chain |
| `TOKEN_SYMBOL` | `$SLANA` | display only (the mint itself is read on-chain). Some env loaders expand `$NAME`; it is commented out in the example file |
| `PRIORITY_FEE_MICROLAMPORTS` | `5000` | priority fee of the payout transactions |
| `STALE_SESSION_AFTER_S` | `900` | wait (s) before refunding a ticket that was never played; shorter values are for tests only (localnet e2e: `5`) |
| `STALE_SWEEP_ACK` | empty | `1`: a quarantined journal (`journal.json.corrupt-*`) has been inspected and the stale-ticket sweeper may run again (see OPERATIONS) |
| `DEV_FAKE_CHAIN` | empty | **development only**: needs `NODE_ENV=development`, refuses to start while `PROGRAM_ID`/`SERVER_KEYPAIR` is set |
| `DEV_FAKE_TOKEN` | empty | with `DEV_FAKE_CHAIN` only: `1` starts with the game token already set; unset, the fake chain waits for `POST /api/dev/token` |

The server key pays the fee of the payout transactions and of the round-end `sweep_loot` transactions (one per arena
round that left floor loot); every ticket pays back the payouts with the `settle_fee_lamports` deposit. The server
never pays the rent of players' token accounts: the game of a player without an account (or whose account refuses the
payout) is still settled at once, the payout stays in the vault as `owed`, and the lobby shows a "Collect payout" call
(R24; the player opens the account themselves, with no waiting time). The server logs a warning when the server key
drops below 0.05 SOL.

Locally: `pnpm dev` (server :8787 + web :5173; Vite forwards `/ws` and `/api` to the server).

## 8. Docker

```bash
docker build -t slana .
docker run -p 8787:8787 -v slana-data:/data --env-file apps/server/.env slana
```

One container = game server + web client (same origin). The image sets `NODE_ENV=production`, `DATA_DIR=/data`,
`WEB_DIST=/app/web`, `TRUST_PROXY=1`; `/data` is a volume (the journal lives there, so it must be persistent). The health
check is `GET /api/health`. The server returns `index.html` for client paths such as `/docs`, so the player guide opens
at `https://<domain>/docs`.

To host the web client separately, the build arguments are `VITE_SERVER_URL` (the game server's address) and
`VITE_RPC_URL` (the browser's RPC). The admin panel also reads `VITE_SOLANA_CLUSTER` (the claimed cluster) and
`VITE_PRIORITY_MICROLAMPORTS`; its program id is always the SDK's compiled `PROGRAM_ID`. The static host must also fall
back to `index.html` for `/admin` and `/docs` (SPA fallback).

## 9. Mainnet

1. Do the program keypair and the build (section 1) for mainnet; complete the whole flow (ticket → game → round bell →
   payout → fee) on devnet first, including `set-token` with a test mint.
2. `solana config set --url mainnet-beta` (or a paid RPC), and put as much SOL as the costs below into the deployer and
   admin wallets.
3. `bash scripts/build-lean.sh && scripts/deploy-lean.sh mainnet-beta target/deploy/slana-keypair.json --keypair keys/deployer.json`
   (never `anchor deploy`: it ships the Anchor reference). The script moves the upgrade authority to the admin wallet.
4. Initialize (section 4): in `/admin` with the admin wallet (the mainnet banner shows), or `pnpm admin init` with the
   mainnet RPC.
5. Start the server with `SOLANA_CLUSTER=mainnet-beta`, a paid `SOLANA_RPC_URL` and a secret-free `PUBLIC_RPC_URL`.
   Until the token is set it serves practice only.
6. When the token exists: Set token, then Create the 4 default arenas in `/admin` (or `pnpm admin set-token --mint
   <CA>`, final, then `pnpm admin create-arena --defaults`). Watch
   the lobby flip to open arenas (up to about 60 s).
7. The admin wallet already holds the upgrade authority and the Config `admin`. Optionally, later, hand both to a
   multisig (`solana program set-upgrade-authority`, `pnpm admin update-config --admin <multisig>`). **Do not make the
   program immutable** (`--final`): it has to stay closable at any time, see
   [OPERATIONS.md](OPERATIONS.md#emergency-stop--close). `scripts/close-program.sh` needs the upgrade authority.
8. Start with small fees; watch `pnpm admin status` and the server logs.

## 10. Mainnet costs

Rent = `(bytes + 128) × 6960` lamports (default rent: 3480 lamports per byte-year × the 2-year exemption). `solana rent
<bytes>` needs an RPC; the values below were computed with this formula.

**Program deployment.** The deployed program is `target/deploy/slana_lean.so` = 39,032 bytes
(`bash scripts/build-lean.sh`; the size gate `tests/size.rs` and CI fail above 71,000 bytes or ◎0.5 of rent). Rent is
`(len + 45 + 128) × 6960` lamports for the ProgramData.
The figures below are the CI toolchain's (Agave 4.3.0). The exact size depends on the platform-tools version; the size gate in CI prints the current figure, and `build-lean.sh` prints the size and rent of your own build.

| Account | Bytes | Rent |
|---|---|---|
| ProgramData (`.so` + 45) | 39,077 | (39,032 + 45 + 128) × 6960 = 272,866,800 lamports ≈ ◎0.2729 (locked while the program exists; recovered with `solana program close`) |
| Program account | 36 | 1,141,440 lamports ≈ ◎0.0011 (locked) |
| Deploy buffer (`.so` + 37, temporary) | 39,069 | (39,032 + 37 + 128) × 6960 = 272,811,120 lamports ≈ ◎0.2728 (returned to the payer when the deploy finishes) |

The deploy peak is ProgramData + buffer + program account = 272,866,800 + 272,811,120 + 1,141,440 = 546,819,360
lamports ≈ ◎0.5468, so the wallet needs about ◎0.55 + transaction fees during the deploy, and ◎0.2740 (ProgramData plus the
program account) stays locked in the program afterwards; the buffer comes back. For comparison, the Anchor reference
(454,704 bytes) would lock about ◎3.17 and need about ◎6.3 during a deploy: this is why it is never deployed.

`solana program deploy` sizes the ProgramData to the program by default (`--max-len`), so a larger later version needs
`solana program extend` first (same rent per extra byte). To reserve room up to the size gate at once, deploy with
`--max-len 71000`: the ProgramData then holds 71,045 bytes, 495,364,080 lamports ≈ ◎0.4954, still under ◎0.5, and the
deploy peak is 495,364,080 + 272,811,120 + 1,141,440 = 769,316,640 lamports ≈ ◎0.77 + transaction fees.

**Account rents (exact, `(bytes + 128) × 6960` lamports).** The sizes are the programs' `INIT_SPACE` values; they are the
same for the lean program and the reference (the layout tests compare them), and the SDK's `ACCOUNT_BYTES` and an SDK
test recompute them from the IDL.

| Account | Bytes | Rent | Paid by |
|---|---|---|---|
| Config | 221 | 2,429,040 ≈ ◎0.0024 | admin (`init`) |
| Arena | 73 | 1,398,960 ≈ ◎0.0014 | admin (`create-arena`) |
| Vault / token account (SPL Token) | 165 | 2,039,280 ≈ ◎0.0020 | admin (arena vaults, the fee wallet's token account); player (own token account, stays with the player) |
| Token account (Token-2022, with extensions, e.g.) | 170 | 2,074,080 ≈ ◎0.0021 | admin / player |
| PlayerProfile | 123 | 1,746,960 ≈ ◎0.0017 | player (stays with the player) |
| Session | 118 | 1,712,160 ≈ ◎0.0017 | player (returned when the ticket closes) |

**Setup (paid by the admin, one-off).** `init` = Config ≈ ◎0.0024. `set-token` = the fee wallet's token account ≈
◎0.0020 (nothing if it already exists). Each `create-arena` = Arena + vault = 1,398,960 + 2,039,280 lamports ≈ ◎0.0034;
the 4 default arenas = 13,752,960 lamports ≈ ◎0.0138. In total about 18.2 million lamports, ≈ ◎0.018, on top of the
deploy.

**Ongoing.** Hosting the game server and a paid RPC. The server key pays the fee of the payout transactions; every ticket
covers it with a 20,000-lamport deposit (base fee 5,000 lamports per signature + `PRIORITY_FEE_MICROLAMPORTS` × compute
units). Keep some SOL on the key as a buffer (the server warns below ◎0.05).

**What the player pays (for reference).** Session rent ≈ ◎0.0017 (returned when the ticket closes); profile ≈ ◎0.0017
and token account ≈ ◎0.0020 (stay with the player); deposit ◎0.00002.
