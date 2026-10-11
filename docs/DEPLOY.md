# Solagel — deployment and recovery

This guide covers the **SOL beta**. Token and NFT launch are future releases, not deployment prerequisites. Never configure a guessed pump.fun mint or OpenSea collection.

## Deployment status and budget — 2026-10-11

Read-only `getAccountInfo` checks on the public mainnet-beta and devnet RPCs returned no account for the repository program ID `5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472`. The existing signed end-to-end test used a local validator; it was not a public-network deployment.

The built `target/deploy/solagel.so` is **436,328 bytes**, SHA-256 `b64b313b1868ede28d18b8cf2262b6088abeef5588035b09fdf754e0de80cef1`. Current mainnet `getMinimumBalanceForRentExemption` responses give:

| Account | Allocated bytes | Rent-exempt SOL |
| --- | ---: | ---: |
| Program | 36 | 0.000833120 |
| ProgramData | 436,373 | 2.217425080 |
| Config | 162 | 0.001473200 |
| First season | 1,281 | 0.007157720 |
| Three arena accounts | 40 each | 0.002560320 |
| **Total rent capital** | | **2.229449440** |

Transaction fees, priority fees, server-authority operating balance, hosting/RPC services, and any optional prize funding are additional. This is a measured rent floor, not a maximum price quote. Most of this amount is capital held in accounts while they remain open, rather than burned transaction fees; closing a program to recover funds ends its operation and requires the appropriate authority.

**The owner's 0.5 SOL real-funds ceiling is below the current mainnet deployment floor. Do not attempt this deployment against that budget.** Devnet rehearsal uses faucet test SOL and does not consume the owner's real SOL. No public deployment or transfer was performed for this estimate.

Agave 4.3 defaults `--max-len` to the original binary length. Explicitly choosing that same length does not reduce this estimate. On initial upgradeable-loader deployment, the intermediate buffer balance is returned to the payer before ProgramData is funded in the same instruction, so initial rent is not counted twice. Future upgrades can have different temporary funding requirements. Requery rent and measure the final binary before any later deployment; network parameters and binary size can change.

## 1. Toolchain and checks

Use Node 22+, pnpm 10.28.0, Rust from `rust-toolchain.toml`, Agave CLI 4.3.x and Anchor CLI 1.2.1.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
anchor build --ignore-keys
corepack pnpm -F @solagel/sdk sync-idl
cargo test -p solagel
```

The TypeScript tests use mock gateways where appropriate. They do not prove that a deployed program accepts real transactions. After building the program, use `scripts/localnet.sh` and `corepack pnpm -F @solagel/server e2e ws://127.0.0.1:8787/ws` for the wallet → ticket → activation → gameplay → settlement flow.

### Upgrade boundary

This beta adds `Session.activated` and `activate_session`; account size and instruction IDL change. **Do not hot-upgrade a program with old open sessions.** Disable new entry, settle all existing sessions, verify every arena has zero open sessions, then upgrade and use a freshly generated matching IDL. For development, a fresh local validator/deployment is simplest. Do not delete a funded production ledger to reset it.

## 2. Configure a devnet deployment

Create your own program keypair, run `anchor keys sync`, build, regenerate the SDK IDL, and deploy to devnet. Protect program/admin/server keypairs; they are not browser configuration. The initialized admin must be the program's upgrade authority.

```bash
anchor deploy --provider.cluster devnet
corepack pnpm admin init --url https://api.devnet.solana.com \
  --server <SERVER_PUBLIC_KEY> --treasury <TREASURY_PUBLIC_KEY> \
  --fee-bps 500 --season-share-bps 5000
corepack pnpm admin create-arena --url https://api.devnet.solana.com --defaults
corepack pnpm admin status --url https://api.devnet.solana.com
```

Fund the server authority with test SOL for activation, settlement and recording fees. A separate server authority does not replace the user's wallet signature when purchasing a ticket.

Set process environment from `apps/server/.env.example`:

```text
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
PUBLIC_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=<YOUR_DEPLOYED_PROGRAM_ID>
SERVER_KEYPAIR=/absolute/path/to/server-keypair.json
AUTH_SECRET=<RANDOM_PERSISTENT_SECRET>
ADMIN_WALLETS=<OPTIONAL_COMMA_SEPARATED_PUBLIC_KEYS>
DATA_DIR=/absolute/path/to/persistent/data
STAKE_ENABLED=true
```

The server requires an authoritative durable journal. `STAKE_ENABLED=false` disables new paid entry but must not discard existing claims. A program paused via `update-config --paused true` likewise stops new admission while allowing settlement. Bot target settings apply to public practice and SOL arenas; paid bots have zero monetary value and cannot eat human players. Public bots decrease to zero when enough humans are present.

## 3. Hosting

Run **one authoritative server per journal/arena set**. The JSON journal is not a multi-process distributed database. Multiple game replicas controlling the same arena can double-admit tickets and corrupt liabilities; horizontal scale needs explicit arena ownership and a transactional ledger first.

Use a long-running host with WebSocket support and persistent disk. Mount the directory selected by `DATA_DIR`. HTTPS/WSS should terminate at a reverse proxy. Set `TRUST_PROXY=1` only when requests can reach the server exclusively through a trusted proxy which replaces forwarding headers.

```bash
corepack pnpm build
# Pass environment through the process manager or container runtime.
node apps/server/dist/index.js
```

Set `WEB_DIST` to the absolute path of `apps/web/dist` to serve client and server together. For separate client hosting, build with `VITE_SERVER_URL=https://game.example.com` and set server `CORS_ORIGIN` to the actual frontend origin. `PUBLIC_RPC_URL` and `VITE_RPC_URL` must never contain server secrets and must target the same cluster/program as the game server.

The supplied Dockerfile can serve both apps; mount `/data` and the server keypair read-only. Keep the server authority funded and monitor failed RPC/settlement logs. Wallet UI must show the correct cluster before any payment.

## 4. Money lifecycle and failure handling

1. The player purchases a ticket. It is unused and holds an original-buy-in refund right after 24 hours.
2. Admission reserves capacity and writes a durable original-value claim **before** chain activation.
3. `activate_session` confirms on-chain before the player spawns. An activated ticket cannot use the unused-ticket refund path.
4. Eating another human transfers already-funded value in the server ledger. Bots and pellets affect mass only.
5. Death or successful cash-out queues an idempotent settlement for the exact `(arena, player, session_id)`.
6. The server persists successful transaction signatures and verifies uncertain outcomes. It does not delete a monetary claim just because the RPC or authority is temporarily unavailable.
7. The browser distinguishes a requested cash-out from the confirmed receipt and ignores receipts for other lives.

Active sessions are bounded by the server's session-age limit, but their final payout still depends on a working server/RPC. The timeout is **not** a promise that an activated ticket can refund the original deposit. Disconnects leave a vulnerable cell during the grace period before automatic cash-out.

### Recovery

- Back up `journal.json` consistently and protect the persistent volume. It represents money owed, including original-value reservations made before activation.
- On ordinary restart, recorded active balances become queued settlements. Preserve pending claims until their exact on-chain session/transaction is reconciled.
- On corruption, stop paid admission, retain the damaged file and recover a known-good journal using chain receipts. Never silently replace it with an empty ledger.
- If the journal is lost, an activated on-chain session is not evidence of its current earned balance. The server must not refund its original buy-in or invent a payout. Reconcile trusted backups/game records before resuming.
- Unused abandoned tickets can be settled for their buy-in after 15 minutes by the server, or self-refunded by the player after 24 hours.
- A failed wallet confirmation may still have landed. Refresh/read the session before proposing another purchase; the UI does this before each entry attempt.

## 5. Operations

The English control room at `/admin` provides these operations through wallet signatures, plus live bot/admission controls, queue monitoring, and staged token/NFT configuration. See [ADMIN.md](ADMIN.md) for authorization and release workflows. Back up `admin.json` alongside the financial journal. Saved admin settings take precedence over bot environment defaults after the first save; each update checks a revision to prevent overwriting concurrent changes.


`corepack pnpm admin help` lists commands. Pass the intended `--url`, `--program` and admin `--keypair`; do not rely on a different cluster's defaults.

| Task | Command |
| --- | --- |
| Inspect config, arenas and season | `corepack pnpm admin status` |
| Pause new paid entry | `corepack pnpm admin update-config --paused true` |
| Disable an arena | `corepack pnpm admin update-arena --id 2 --enabled false` |
| Fund season pool | `corepack pnpm admin fund-season --sol 1` |
| End current season | `corepack pnpm admin end-season` |
| Roll over unclaimed prizes after claim window | `corepack pnpm admin rollover --season N` |
| Sweep arena with no open tickets | `corepack pnpm admin sweep --id 2` |

Only captured SOL profit at paid settlement contributes to season points: `floor(max(payout − buyIn, 0) / 1000)` with amounts in lamports before fees (1 point per 0.000001 SOL profit). Zero-profit bot/food farming cannot enter the prize leaderboard. Practice keeps XP/stats without monetary rewards. Legacy `buy_skin` is disabled: no SOL purchase should be advertised as an NFT mint.

## 6. Asset rollout: token, then NFT skins

After creating the intended token through pump.fun, inspect its real mint in `/admin` on the configured Solana cluster. The server verifies owner program, initialization, decimals, supply and authorities. Save it as Configured for private preparation, or Launched to publish its metadata and exact official launch link in the lobby. Mint inspection does not prove pump.fun provenance. SOL remains the only gameplay currency.

Token entry and payouts require separate SPL-token escrow, accounting, settlement and fee rules, followed by program deployment and signed devnet verification. Existing SOL sessions must settle under their original currency. Never relabel the lamport ledger as token units.

After the token launch, configure the intended NFT chain, standard, collection identifier, OpenSea collection URL and asset-to-skin mappings. The admin registry supports preparing Solana/Metaplex or Ethereum/Base/Polygon ERC-721/ERC-1155 identifiers; it does not imply OpenSea currently supports minting every listed chain or format. Confirm the intended OpenSea mint route before deployment. Mappings target the eight cosmetic premium character skins.

NFT ownership verification remains an explicit integration step after the real contract is available: validate collection membership, read finalized ownership or balances, invalidate transferred assets, and link the owning wallet with a signed proof if the NFT lives on another chain. A collection URL or token ID cannot grant a skin. Free mint has zero mint price; network fees may apply.

Production still requires independent contract/security review and a successful real-wallet devnet rehearsal. No deployment or asset creation is performed by saving admin settings.
