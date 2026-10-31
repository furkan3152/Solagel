# Testnet launch, bots, NFT utilities and the full admin

Status: requested by the owner (2026-10-31). Builds on `2026-10-29-elymum-on-elysium.md`.

## 1. The plan

- **Now: Elysium Testnet is live.** On testnet the NFT mint is **public** and the **game is open**. Players get the game token
  (`tELYMUM`, the TestToken) from an in-site **faucet** and play arenas with it.
- **At the same time we collect the WL for mainnet.** WL entries are not tied to a chain. When mainnet launches
  (Kinetiq: Nov 9), the owner deploys the mainnet contracts from `/admin`, builds the mainnet allowlist and opens the mainnet
  mint, then the mainnet game.
- **One server, one chain at a time.** The server follows `EVM_RPC_URL`. Everything chain-specific (registered contracts,
  journal, bot wallets, allowlist snapshots) is **keyed by chain id**, so moving the RPC from testnet to mainnet starts a clean
  mainnet state and keeps the testnet records for reference. Off-chain records (WL, collabs, tasks, settings, profiles) carry over.

## 2. Bots

Rooms are rarely full, so bots fill them. Rules for every network:

- **Visible.** Every bot carries a small `BOT` tag in the HUD lists, the name label and standings. Nobody is fooled.
- **Natural names.** Bot names look like names real people pick (e.g. `marco_88`, `ella.v`, `kenjiplays`, `sophie_m`,
  `deniz_k`, `frank0x`), a large varied pool, never crypto puns. No duplicates in one room.
- **Cap per room** (admin-set, default 12) and **make room for people**: when a human joins a room at the cap, a bot leaves
  (it "goes home" with a short animation) so the human gets the seat. Bots never block a join.
- Admin controls: bots on/off per room kind, cap, minimum, difficulty mix, and a live count.

**Mainnet (and any non-testnet chain): bots are worth 0.** A bot that eats you takes your mass, and your value spills as floor
loot like today; eating a bot gives mass, never tokens. Bots never buy tickets.

**Testnet: bots play for real.** Each staked bot has its own wallet (derived from the server key, kept in `DATA_DIR`), is funded
with plenty of `tELYMUM` (the server key is a TestToken minter) and a little HYPE for gas, and buys a real arena ticket with
`join`. Their value moves exactly like a player's: eat a bot and its tokens become yours; a bot that eats you takes yours; at the
bell bots are settled on-chain like everyone. The admin sets how many staked bots per arena (default 6) and their bankroll.
Practice rooms keep zero-value bots.

## 3. NFT utilities (the Elymum emblem)

1. **Game access**: the holders gate (`gameAccess = holders`); on testnet the game is public, on mainnet the owner decides.
2. **Lower fee**: holders pay `holderFeeBps` (default 300 = 3 %) on profit instead of the normal 5 %, fixed at join on-chain
   (`ElymumArena.setHolderPerks(nft, holderFeeBps)`).
3. **The Isles of the Blessed are for holders**: an arena can be marked `holdersOnly` on-chain (default: arena 4).
4. **Testnet emblem → mainnet WL**: holders of a testnet emblem can be added to the mainnet allowlist in one admin action
   ("import testnet holders"), recorded per wallet with the source.
5. **Cosmetics**: the emblem's coin face/colour is unlocked as an in-game skin for its holder, and holders wear a small laurel
   on their name tag.
6. **Faucet bonus (testnet)**: holders claim twice the faucet amount (`TestToken.faucet` reads the NFT).

## 4. Faucet

`/faucet` (site page, testnet only): connect, switch to Elysium Testnet, claim `tELYMUM` (1,000,000, holders 2,000,000, 1 h
cooldown, shown as a countdown), plus a link to Kinetiq's HYPE faucet for gas and the "add token to wallet" button
(`wallet_watchAsset`). The page explains the tokens are worthless test tokens.

## 5. Admin: everything from one panel

The panel must let the owner run the whole project without a terminal:

- **Network**: current chain (TESTNET / MAINNET pill), RPC health, server key + balance (with a "fund" hint), contracts per chain
  with code-hash checks, and a **mainnet launch checklist** (set `EVM_RPC_URL` in Render → deploy Arena + NFT from the owner
  wallet → register → set token → arenas → allowlist → mint → game).
- **Deploy**: Arena, NFT, TestToken (testnet), each verified and registered; holder perks and holders-only arenas configurable.
- **Mint**: start / stop (phase Closed / Allowlist / Public), price ($1 sync, keeper, bounds), supply, limits, allowlist build +
  publish, import testnet holders, metadata, royalty, withdraw.
- **Game**: start / stop (gameAccess admins / holders / public), arena pause, per-arena enable/disable, fee, holder fee, rounds,
  bots (all section 2 controls), live rooms and players, kick.
- **Faucet** (testnet): amount, holder bonus, cooldown, minter = server key.
- **WL / Tasks / Collabs / Integrity / Settings**: as today (add, edit, reorder, disable tasks; approve/reject; CSV).
- Every on-chain action keeps the transaction preview, owner check and chain check.
