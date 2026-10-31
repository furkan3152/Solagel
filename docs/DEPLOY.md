# Elymum: setup and deployment (Elysium Testnet → Elysium mainnet)

This is the whole path from an empty host to a running game with an open mint. The server goes up first;
then the owner deploys both contracts **from their own wallet in `/admin`** and the server registers them.
Nothing here needs a terminal on the chain side: the CLI (`pnpm admin`, at the end) is an alternative.

Day-to-day running: [OPERATIONS.md](OPERATIONS.md). How the money moves: [ARCHITECTURE.md](ARCHITECTURE.md).
Source of truth: [the spec](specs/2026-10-29-elymum-on-elysium.md).

## The order

1. **Server** on a host with a persistent disk (Render below), `SERVER_PRIVATE_KEY=auto`, `ADMIN_WALLETS` = your
   owner wallet, `EVM_RPC_URL` = Elysium Testnet (later mainnet).
2. **Fund the server key** with a little HYPE (it pays gas for settlements and loot burns).
3. In `/admin` on the site, with the owner wallet on Elysium: **Deploy Arena → Deploy NFT → register both**.
4. **Set the `$ELYMUM` token** on the arena when the token exists (once and for good), then **create the four
   arenas**. On testnet you can deploy the `TestToken` first and use it.
5. **WL**: review applications in `/admin` → WL and Collabs → **publish the allowlist root**.
6. **Open the mint**: phase Allowlist (with "activate the game for holders" checked), later Public.
7. Keep the mint at **$1 in HYPE**: the Sync button, or let the server's price keeper do it within your bounds.

`/admin` → **Launch** shows this checklist live, each line with a link to the tab that finishes it.

## 0. Elysium

| | Elysium Testnet | Elysium mainnet |
|---|---|---|
| Chain id | `99801` | read from the RPC (`eth_chainId`) |
| RPC | `https://testnet-rpc.elysium.kinetiq.xyz` | published by Kinetiq at launch (**Nov 9**): put it in `EVM_RPC_URL` |
| Explorer | `https://explorer-elysium-testnet.t.conduit.xyz` (built in) | published at launch: put it in `EXPLORER_URL` |
| Gas token | HYPE (18 decimals) | HYPE |
| Faucet | https://elysium.kinetiq.xyz/testnet-faucet | none |

Elysium is Kinetiq's Arbitrum Orbit L2 that settles to HyperEVM. Do not use viem's `elysiumTestnet` export: it
is an unrelated chain. The server's RPC is the source of truth: the web asks the wallet to switch to (or add)
exactly the chain the server reports, so moving from testnet to mainnet is a server setting, not a rebuild.

**Wallets.** Any EVM browser wallet that announces itself with EIP-6963 (MetaMask, Rabby, Coinbase Wallet, OKX,
...). The owner wallet is the one you will keep: it owns both contracts. A hardware wallet behind MetaMask or
Rabby works. Get testnet HYPE for it (and later for the server key) from the faucet.

## 1. The server on Render

One Docker container serves the game server and the web client on the same origin
(`Dockerfile` at the repository root; image name `elymum`).

1. **New → Web Service** from the repository, runtime **Docker** (the root `Dockerfile`), a region near your
   players, a paid plan (the free plan has no disk).
2. **Disk**: mount a persistent disk at **`/data`** (1 to 2 GB is plenty). It holds the money journal, the server
   key, the contracts registry, profiles, standings and the site data. The entrypoint makes it writable for the
   `node` user.
3. **Environment** (Render passes these to the Docker build as well, which `VITE_PUBLIC_URL` needs):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/data` |
| `PUBLIC_URL` | **required**: the site's address, e.g. `https://<your current domain>` (the SIWE domain and the base of the NFT metadata URLs). The server refuses to start without it unless `NODE_ENV=development`; it never derives the sign-in domain from `Host` / `X-Forwarded-Host` |
| `VITE_PUBLIC_URL` | the same value (build time: absolute canonical and Open Graph URLs in `index.html`) |
| `EVM_RPC_URL` | `https://testnet-rpc.elysium.kinetiq.xyz` (testnet), later the mainnet RPC (may hold an API key; never sent to browsers) |
| `PUBLIC_RPC_URL` | optional: an RPC for browsers, no secrets (default: `EVM_RPC_URL` when it is the public testnet RPC, else the wallet's own RPC) |
| `EXPLORER_URL`, `CHAIN_NAME` | mainnet only, when Kinetiq publishes them (`CHAIN_NAME` defaults to "Elysium") |
| `SERVER_PRIVATE_KEY` | `auto`: generated once into `/data/server-key.json` (mode 0600) and reused; its address is logged and published as `serverKey` |
| `ADMIN_WALLETS` | your owner wallet's 0x address (comma-separated for more). **No default**: unset, nobody is admin |
| `AUTH_SECRET` | `openssl rand -hex 32` (otherwise players sign in again after each restart) |
| `TRUST_PROXY` | `1` (set by the image already): the client IP is the right-most `X-Forwarded-For` hop; with more than one proxy in front, set `TRUST_PROXY_HOPS` to their number (default 1) |
| `MINT_USD_CENTS` | `100` (the $1 target; default) |
| `TOKEN_SYMBOL` | `$ELYMUM` (default; display only) |
| `GAME_ACCESS` | leave empty: the `/admin` setting decides (`admins` until you open the mint) |

Leave `ARENA_ADDRESS` and `NFT_ADDRESS` empty: the addresses come from the registry `/admin` writes. Never set
`DEV_FAKE_CHAIN` on a deployed server. The full list with comments: `apps/server/.env.example`.

4. Deploy. The health check is `GET /api/health`. The log shows `chain: ...` with the chain id and the server key
   address; `GET /api/config` shows the same (`chain.serverKey`). A disk-backed service restarts briefly on every
   deploy; the journal keeps every value, but players reconnect, so deploy at quiet hours.

**Domain.** The site is served at whatever `PUBLIC_URL` says, today your current domain. In Render → Settings →
Custom Domains add the domain (and `www`), then point the DNS at Render (`A @` to Render's address, `CNAME www` to
the service's `onrender.com` host); Render issues the certificates. To move to **elymum.io** later: add it in
Render, point its DNS, change `PUBLIC_URL` and `VITE_PUBLIC_URL` to `https://elymum.io` and redeploy. Nothing in
the code or the art names a domain. Players sign in again on the new domain (SIWE binds the domain). NFT metadata
URLs follow the NFT's base URI: update it with `setBaseURI` (Mint tab) unless you froze it.

**Without Docker.** `pnpm install && pnpm -F @elymum/web build && pnpm -F @elymum/server build`, then run
`node apps/server/dist/index.js` with the variables above and `WEB_DIST=apps/web/dist`. The server does not read a
`.env` file itself: pass the variables through the environment.

## 2. Fund the server key

Send a little HYPE to the `serverKey` address (on testnet from the faucet). It pays gas for the settlement
batches at each bell and for the loot burns; on an L2 that is cheap, but keep a buffer. Below 0.01 HYPE the server
logs a warning and `/admin` shows it in red.

## 3. Deploy the contracts from `/admin`

Open `https://<your site>/admin`. Connect the **owner wallet** (the one in `ADMIN_WALLETS`), press **Sign in**
(a free SIWE signature, no transaction). The header shows a TESTNET or a red **MAINNET** pill. Every transaction
opens a preview (function, arguments, value, network, signer) before the wallet prompt, and a double click cannot
send twice. Open **Deploy**; the wizard walks the steps and remembers where you are:

1. **Connect the owner wallet.** This wallet becomes the owner of both contracts.
2. **Check the chain.** The wallet must be on the chain the server reports; the panel asks the wallet to switch
   (or to add the chain) and blocks signing otherwise.
3. **Deploy ElymumArena.** Constructor: admin = you, server authority = the server key (prefilled from
   `/api/config`), fee wallet = you (change it if you like; it receives every fee).
4. **Deploy ElymumNFT.** Defaults: max supply 5,000, price = $1 in HYPE at today's HYPE/USD, 1 allowlist and 2
   public mints per wallet, base URI `${PUBLIC_URL}/api/nft/`, treasury = you. Everything except the base URI
   once frozen can be changed later.
5. **Register both with the server.** `POST /api/admin/contracts` for each: the server checks that the code hash is
   the bundled one, that the owner is you and that the arena's server authority is its key, then stores the
   addresses in `/data/contracts.json`. The server picks the arena up without a restart.
6. **Set the game token** (later, when `$ELYMUM` exists). Type the token address twice. It can be set **once**: a
   wrong address means deploying a new arena. Until it is set the arenas show "Opening soon" and only practice
   runs.
7. **Create the four arenas** (needs the token): Asphodel Meadow 1,000, Lethe Shore 10,000, Golden Bough 50,000,
   Isles of the Blessed 250,000 tokens, 300 open tickets each. The lobby opens them within about a minute.

**Testnet before `$ELYMUM` exists.** On a non-mainnet chain the Deploy tab offers **Deploy TestToken** (a faucet
ERC-20: `faucet()` gives 1,000,000 per hour). Set it as the arena's token on a **test** arena deployment to try
the whole flow (ticket → round → bell → payout → fee) before mainnet. Remember the token is final for that arena.

## 4. The allowlist and the mint

1. **WL**: approve or reject applications in `/admin` → **WL**; approve communities and collect their wallet lists in
   **Collabs**. Only EVM addresses count; entries from before the move (non-EVM wallets) are kept and marked `legacy` (never in the allowlist).
2. **Publish the allowlist root** (Mint tab): the server builds a snapshot of every approved WL wallet plus every
   wallet in a submitted collab list (checksummed, de-duplicated, sorted) and its Merkle root; you sign
   `setMerkleRoot`. The panel warns when approvals changed since the published root: publish again.
3. **Set the price to $1** (Mint → Sync to $1): it reads HYPE/USD and asks your wallet to call `setPrice`.
4. **Open the mint**: Mint → phase **Allowlist**. "Activate the game for holders" is offered checked: it sets who
   may play to `holders` (NFT holders plus admins). Later switch the phase to **Public**.
5. **Keep it at $1** (see OPERATIONS): press Sync now and then, or set the price bounds and make the server key the
   price keeper; the server then re-prices every 5 minutes when the price drifts more than 2 %, always inside your
   bounds.

## 5. Mainnet (Nov 9)

1. Do the whole flow on Elysium Testnet first, including a test arena with the `TestToken`.
2. When Kinetiq publishes mainnet: set `EVM_RPC_URL` (a reliable RPC; it may contain a key) and `EXPLORER_URL` on
   Render, optionally `PUBLIC_RPC_URL` (secret-free) and `CHAIN_NAME`. Redeploy.
3. **A new chain needs new contracts.** Testnet addresses are not mainnet addresses. If the journal still owes money
   on the testnet arena, the server refuses to switch (409 `wrong_state`): let the last round settle (or settle the
   journal) before moving, or start mainnet on a fresh `/data` (keep a backup of the old one).
4. Fund the server key with real HYPE.
5. Redo section 3 on mainnet: the red MAINNET banner shows; deploy Arena and NFT, register, publish the root, sync the
   price, and set the real `$ELYMUM` token when it exists.
6. Start with the default 5 % fee and small arenas; watch `/admin` → Launch and the server log (`!!!` lines).

## The admin CLI (alternative)

Everything the panel does on chain is also in the CLI (Node, a key file or env key):

```bash
export EVM_RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz
export ADMIN_PRIVATE_KEY=/path/to/owner.key     # 0x hex, or a file holding it
pnpm admin status
pnpm admin deploy-arena --server <serverKey>
pnpm admin deploy-nft --max-supply 5000 --usd-cents 100 --base-uri https://<site>/api/nft/
pnpm admin set-token --token <addr> --confirm <addr>
pnpm admin create-arena --defaults
pnpm admin nft:root --file allowlist.txt && pnpm admin nft:phase allowlist
pnpm admin help
```

The CLI previews and simulates every transaction, `--dry-run` stops after the preview, and Elysium mainnet needs
`--mainnet` plus typing "mainnet". Contracts deployed with the CLI still have to be registered with the server: use
`/admin` (Deploy → Register) or set `ARENA_ADDRESS` / `NFT_ADDRESS`.

## Local development

- `pnpm demo`: a fake chain, nothing to deploy.
- `pnpm demo:localnet`: `hardhat node` + the contracts deployed with the SDK + the production server
  (`scripts/localnet.mjs`, `scripts/localnet-fund.mjs`; addresses in `.localnet/contracts.json`).
- `pnpm -F @elymum/server e2e`: the deploy order above, end to end against a fresh hardhat node.
