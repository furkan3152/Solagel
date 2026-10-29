# Elymum on Elysium: chain migration, mint, and the Elysian design language

Status: accepted (2026-10-29). This spec is the single source of truth for the move from Solana to Elysium and for
the new interface.

## 0. What changes in one paragraph

The project was "Slana", a coin-eats-coin arena game with money rules in a Solana program. It becomes Elymum on
Elysium, Kinetiq's Arbitrum Orbit L2 that settles to HyperEVM and uses HYPE as its gas token (EVM, 18 decimals).
Gameplay, rounds, fees, the off-chain ledger and the journal stay the same. The Solana programs become two Solidity
contracts, the Solana wallet layer becomes an EVM wallet layer (EIP-6963 + viem), sign-in becomes SIWE (EIP-4361), and an
Elymum NFT with a $1-in-HYPE mint is added. The product flow is WL → Mint → the game activates for holders.
For now the public site only collects WL applications, but the whole mint system is ready and run from `/admin`, and
the owner deploys every contract from their own wallet in `/admin`. The whole interface is redesigned in an Elysium
language (section 6). Nothing about Solana or Slana remains in code, copy, docs, brand or media.

## 1. Names and constants

| Thing | Value |
|---|---|
| Product | **Elymum** (one word, capital E). Never "ELYMUM" in running text except the wordmark. |
| Chain | **Elysium** (mainnet) / **Elysium Testnet**; gas token **HYPE** |
| Game token | ERC-20 set once by the admin after deploy. Display symbol from `TOKEN_SYMBOL`, default **`$ELYMUM`** |
| NFT | **Elymum NFT** (ERC-721 name `Elymum`, symbol `ELYMUM`) |
| Packages | `@elymum/shared`, `@elymum/art`, `@elymum/sdk`, `@elymum/contracts`, `@elymum/server`, `@elymum/web` |
| Domain | Never hard-coded in UI copy. The site is served at whatever `PUBLIC_URL` says (today `https://slana.io`, later `https://elymum.io`). Web copy uses relative links or `location.host`. `index.html` uses `%VITE_PUBLIC_URL%` for absolute OG URLs. |
| X handle | admin setting `xHandle`, default `elymum`. A stored value of `slanaio` is migrated to the default on load. |
| Arenas | Same four tiers, renamed to Elysian places: **Asphodel Meadow** (1,000), **Lethe Shore** (10,000), **Golden Bough** (50,000), **Isles of the Blessed** (250,000). Ids 1–4 stay. |

## 2. Chains

`packages/shared/src/chains.ts` is the only table of chains:

| Key | Chain id | Name | RPC | Explorer |
|---|---|---|---|---|
| `elysium-testnet` | 99801 | Elysium Testnet | `https://testnet-rpc.elysium.kinetiq.xyz` | `https://explorer-elysium-testnet.t.conduit.xyz` |
| `elysium` | from the RPC (`eth_chainId`) | Elysium | `EVM_RPC_URL` (no public default yet: mainnet details are published at launch, Nov 9) | `EXPLORER_URL` |
| `localnet` | 31337 | Localnet | `http://127.0.0.1:8545` | none |

- Native currency is always `{ name: 'HYPE', symbol: 'HYPE', decimals: 18 }`.
- **The server's RPC is the source of truth.** At start the server reads `eth_chainId` from `EVM_RPC_URL` and publishes
  `{ chainId, name, rpcUrl (public), explorerUrl }` in `/api/config`. Unknown ids are named by `CHAIN_NAME` (default
  "Elysium"). The web never assumes a chain id: it asks the wallet to switch to (or add) exactly what the server says.
- Do not use viem's built-in `elysiumTestnet` export: it is an unrelated chain (Vulcan Forged, id 1338).
- Explorer links are `${explorerUrl}/tx/<hash>` and `${explorerUrl}/address/<addr>` (Blockscout layout).

## 3. Contracts (`packages/contracts`)

Hardhat 3, Solidity `0.8.28`, `evmVersion: "shanghai"`, optimizer on (200 runs), OpenZeppelin 5.6.1, forge-std Solidity
tests (unit + fuzz). **No `immutable` variables** in the two deployable contracts, so the runtime bytecode is identical
for every deployment and `keccak256(runtime code)` can be pinned (the server refuses to register an address whose code
hash differs from the bundled artifact). `scripts/export-artifacts.mjs` writes `src/artifacts.ts` (ABIs `as const`,
creation bytecode, `runtimeCodeHash`) which is committed; `src/index.ts` re-exports it. Nothing else in the repository
compiles Solidity.

### 3.1 `ElymumArena` (port of the old program)

Ownable2Step (owner = the admin wallet, set by the constructor argument), ReentrancyGuard, SafeERC20.

```solidity
constructor(address admin, address serverAuthority, address feeWallet);

// config (owner)
function setToken(address token) external;            // once; reverts TokenAlreadySet. Reads decimals (try, default 18)
function setFeeBps(uint16 bps) external;               // <= 1000 (10 %), default 500
function setFeeWallet(address w) external;
function setServerAuthority(address s) external;
function setPaused(bool p) external;                   // blocks joins only
function createArena(uint16 id, uint128 entryFee, uint16 maxSessions) external;   // needs the token set
function updateArena(uint16 id, uint128 entryFee, uint16 maxSessions, bool enabled) external;
function sweepArena(uint16 id) external;               // disabled + 0 open sessions: vault -> feeWallet
function rescue(address token, address to, uint256 amount) external; // never the game token; token=0 means HYPE

// players
function join(uint16 arenaId) external;                // transferFrom(entryFee) with a balance-delta check (no fee-on-transfer)
function refund(uint16 arenaId) external;              // finalized: collect `owed`; else after 24 h: min(entryFee, vault)

// server
struct Settlement { uint16 arenaId; address player; uint64 sessionId; uint128 payout; }
function settle(Settlement[] calldata items) external; // per item: skip (event SettleSkipped(reason)) instead of revert
function sweepLoot(uint16 arenaId, uint64 sweepId, uint128 amount) external; // burns to 0x…dEaD; sweepId > lastSweepId

// views
function config() external view returns (ConfigView memory); // admin, server, feeWallet, token, decimals, feeBps, paused, totals
function arenaIds() external view returns (uint16[] memory);
function getArena(uint16 id) external view returns (ArenaView memory);   // entryFee, vault, maxSessions, openSessions, enabled, exists, totals, lastSweepId
function getSession(uint16 arenaId, address player) external view returns (SessionView memory); // id (0 = none), entryFee, openedAt, feeBps, finalized, owed
```

Rules carried over: a payout never exceeds the arena vault; one open session per player per arena; the session id is
checked so a settlement cannot replay; the fee is `floor((payout − entryFee)⁺ × feeBps / 10 000)` with `feeBps` fixed at
join; the whole fee goes to `feeWallet` (a failing fee transfer reverts the batch); the player transfer is attempted
with `SafeERC20.trySafeTransfer` and on failure the session is **finalized** with `owed` (two-phase settle, the player
collects with `refund`); floor loot is only ever burned; pause blocks joins only. Session ids start at 1 and come from
a global counter. Events: `TokenSet`, `ArenaCreated`, `ArenaUpdated`, `Joined(arenaId, player, sessionId, entryFee,
feeBps)`, `Settled(arenaId, player, sessionId, payout, fee, collected)`, `SettleSkipped(arenaId, player, sessionId,
reason)`, `Refunded`, `Collected`, `LootBurned(arenaId, sweepId, amount)`, `ArenaSwept`, config events. Custom errors
everywhere (no revert strings).

On-chain player profiles are **dropped**: names and skins live on the server (section 4.4); there is no
`register_player`.

### 3.2 `ElymumNFT`

ERC721 + ERC2981 + Ownable2Step + ReentrancyGuard. Token ids start at 1.

```solidity
enum Phase { Closed, Allowlist, Public }
constructor(address owner, uint32 maxSupply, uint256 mintPrice, uint16 wlLimit, uint16 publicLimit, string memory baseURI, address treasury);

function mintAllowlist(uint256 qty, bytes32[] calldata proof) external payable; // phase Allowlist or Public; leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender)))); wlMinted+qty <= wlLimit
function mintPublic(uint256 qty) external payable;                               // phase Public; publicMinted+qty <= publicLimit
// payment: msg.value >= price*qty, the excess is refunded to the sender in the same call

// owner
function setPhase(Phase p) external;
function setMerkleRoot(bytes32 root) external;
function setPrice(uint256 wei_) external;
function setPriceBounds(uint256 minWei, uint256 maxWei) external;
function setPriceKeeper(address keeper) external;   // may call setPrice only within [minPrice, maxPrice]
function setLimits(uint16 wl, uint16 pub) external;
function setMaxSupply(uint32 max) external;          // can only go down, never below totalSupply
function ownerMint(address to, uint256 qty) external;
function setBaseURI(string calldata uri) external;   // tokenURI = baseURI + id
function setContractURI(string calldata uri) external;
function freezeMetadata() external;                  // forever
function setTreasury(address t) external;
function setRoyalty(address receiver, uint96 bps) external; // <= 1000
function withdraw() external;                        // whole balance -> treasury

function mintState() external view returns (MintStateView memory); // phase, price, minPrice, maxPrice, keeper, root, maxSupply, totalSupply, wlLimit, publicLimit, treasury, frozen
function mintedBy(address) external view returns (uint16 wl, uint16 pub);
```

**$1 in HYPE.** The price is held in wei. The target is `MINT_USD_CENTS` (default 100). The HYPE/USD price comes from
Hyperliquid's public info API (`POST https://api.hyperliquid.xyz/info {"type":"allMids"}`, key `HYPE`). Two ways keep it
at $1, both shipped: (1) `/admin → Mint → Sync to $1` computes the wei price and asks the owner's wallet to call
`setPrice`; (2) when the owner sets the server key as `priceKeeper`, the server re-prices automatically (every 5 min,
only when off by more than 2 %, always inside the owner's `[minPrice, maxPrice]` bounds). The UI always shows the HYPE
price with its USD value.

**Allowlist.** The allowlist is every approved WL wallet plus every wallet in a submitted collab list (EVM addresses
only, checksummed, de-duplicated, sorted). The server builds an OpenZeppelin-compatible Merkle tree (double-hashed
leaves of `abi.encode(address)`, sorted-pair hashing) and keeps a snapshot; the owner publishes its root with
`setMerkleRoot` from `/admin`. A user's proof comes from `GET /api/site/mint/proof?wallet=0x…`. The admin panel warns
when approvals changed since the published root.

### 3.3 `TestToken` (localnet and testnet only)

A plain mintable ERC-20 (`faucet()` gives 1,000,000 to the caller, 1 h cooldown) so the whole arena flow can be tried on
Elysium Testnet before `$ELYMUM` exists. `/admin` offers it only when the chain is not mainnet.

## 4. Server (`apps/server`)

### 4.1 Config

| Env | Meaning |
|---|---|
| `EVM_RPC_URL` | Server RPC (may hold a key). Unset: chain off, practice only. |
| `PUBLIC_RPC_URL` | RPC handed to browsers (no secrets). Default: `EVM_RPC_URL` when it is the public testnet RPC, else null (the wallet's own RPC is used). |
| `CHAIN_NAME`, `EXPLORER_URL` | Display name and explorer for chain ids not in the table |
| `ARENA_ADDRESS`, `NFT_ADDRESS` | Optional overrides. Normally the addresses come from the registry the admin panel writes (`DATA_DIR/contracts.json`) after a deploy. |
| `SERVER_PRIVATE_KEY` | `auto` (default in Docker: generated once into `DATA_DIR/server-key.json`, mode 0600), a 0x hex key, or a path to a file holding one. Its address is published as `serverKey` for the admin panel. |
| `ADMIN_WALLETS` | Comma-separated 0x addresses allowed in `/admin` and `/api/admin/*`. **No default**: unset logs a loud warning and nobody is admin. |
| `MINT_USD_CENTS` | Mint target in US cents, default 100 |
| `HYPE_PRICE_URL` | Default `https://api.hyperliquid.xyz/info` |
| `TOKEN_SYMBOL` | Default `$ELYMUM` |
| `GAME_ACCESS` | Overrides the admin setting: `admins`, `holders` or `public` |

`SOLANA_*`, `PROGRAM_ID`, `SERVER_KEYPAIR`, `PRIORITY_FEE_MICROLAMPORTS` are gone.

### 4.2 Chain gateway

`chain/evm.ts` implements the existing `ChainGateway` with viem: it reads `config()` until the token is set (every 30 s,
then pushes `chain` to clients), lists arenas, reads sessions, and runs the settlement worker. At the bell it settles all
due items of an arena in **one `settle` batch** (chunked at 40), reconciles each item by reading the session afterwards
(a skipped or reverted item is retried with backoff; an item whose session id no longer matches is marked settled by
someone else), burns floor loot with `sweepLoot` using a monotonic `sweepId` stored in the journal, refunds nothing on
its own (players refund after 24 h) but settles stale sessions at their entry fee like before. Gas comes from the
server key (HYPE); a low-balance warning is logged and shown in `/admin`. Journal keys become
`<arenaId>:<player lowercase>:<sessionId>`. `chain/dev-fake.ts` stays (0x addresses, fake hashes).
`ChainStatus` becomes `{ enabled, chainId, chainName, rpcUrl, explorerUrl, arenaAddress, nftAddress, arenasEnabled,
tokenReady, token: { address, symbol, decimals } | null, feeBps, serverKey }`.

### 4.3 Sign-in (SIWE, EIP-4361)

`packages/shared/src/siwe.ts` builds and parses the exact message (domain, address checksummed, statement
"Sign in to Elymum. This is free and sends no transaction.", URI, Version 1, Chain ID (the server's), Nonce, Issued At).
The server verifies with viem `verifyMessage` (EOA) and falls back to `publicClient.verifyMessage` (ERC-1271/6492
smart wallets). Addresses are compared and stored checksummed. Same nonce rules as before (single use, 10 min).

### 4.4 Site, mint and profiles

- WL / collab: wallets are EVM addresses. Entries whose wallet is not `0x…` (from the Solana era) are kept and marked
  `legacy: true`; they are never in the allowlist. A user who applies with an EVM wallet and the X handle of a legacy
  entry replaces it (status goes back to `pending`, note "re-applied with an EVM wallet; was <status>").
- Settings: `gamePublic: boolean` becomes `gameAccess: 'admins' | 'holders' | 'public'` (stored `gamePublic: true`
  migrates to `public`, else `admins`). `holders` = wallets with `balanceOf > 0` on the NFT (cached 60 s) plus admins.
- Contracts registry: `GET /api/site/contracts` (public), `POST /api/admin/contracts` `{ kind: 'arena'|'nft'|'token',
  address, txHash }`: the server checks the code hash, the owner (= the signed-in admin), and for the arena that the
  server authority is the server key, then stores it. `DELETE` clears a kind.
- Mint: `GET /api/site/mint` (contract state, HYPE/USD, price in USD, holders count, game access), `GET
  /api/site/mint/proof?wallet=` (`{ eligible, proof, root, onchainRoot }`), `POST /api/admin/mint/allowlist` (build a
  snapshot, returns root and count), `GET /api/admin/mint/allowlist` (snapshot, diff vs current approvals),
  `GET /api/admin/mint/price` (HYPE/USD and the $1 wei price).
- Metadata: `GET /api/nft/<id>` (JSON, only for minted ids) and `GET /api/nft/<id>.svg` (a deterministic emblem drawn
  from the id: an orbital "seal" in the brand palette), `GET /api/nft/contract` (contractURI). The deploy form defaults
  the NFT base URI to `${PUBLIC_URL}/api/nft/`.
- Profiles: `GET /api/profile` and `PUT /api/profile {name, skin}` (signed-in), stored in `DATA_DIR/profiles.json`;
  stats (games, kills, best) come from the server's own records. The websocket sign-in reads the same store.

## 5. Web (`apps/web`)

- `src/wallet/` replaces `src/solana/`: EIP-6963 discovery (fallback `window.ethereum`), connect, account/chain events,
  `wallet_switchEthereumChain` → `wallet_addEthereumChain` with the server's chain, `personal_sign` for SIWE, viem
  `createWalletClient(custom(provider))` for transactions, receipts via a public client on the server's RPC.
- Ticket flow: `approve` (only when the allowance is short; exact amount) → `join`. Refund / collect with `refund`.
- `/mint`: Closed (teaser, WL status), Allowlist (eligibility + proof, quantity, price in HYPE ≈ $1.00), Public, Sold out;
  success shows the minted emblem(s) and a **Play** CTA when the game is active for holders.
- `/admin`: tabs **Launch** (checklist), **Deploy** (wizard: connect owner wallet → check chain → deploy Arena → deploy
  NFT → register both → set token → create the four arenas; testnet: deploy TestToken), **Mint** (phase, publish
  allowlist root, sync $1 price, keeper and bounds, limits, supply, base URI/freeze, royalty, withdraw, owner mint),
  **Arena** (token, arenas, fee, pause, server key, sweeps), **Play**, **WL**, **Tasks**, **Collabs**, **Integrity**,
  **Settings**. Safety rails stay: the chain must match the server, the connected wallet must be the contract owner,
  every transaction is previewed (function, args, value) before the wallet prompt, addresses are typed twice for
  `setToken`, double clicks cannot send twice, mainnet shows a red MAINNET banner. "Open mint" offers (checked) "activate
  the game for holders".

## 6. The Elysian design language

### 6.1 Sources

Elysium is Kinetiq's chain. Its launch art is an orbital ring habitat seen from inside: the ground curves up into the
sky, terraces of green fields, a band of night with the planet below, and the word **Elysium** in a clean grotesk whose
letters fall away into vertical light streaks. Kinetiq's brand guide gives the palette (teal, cyan, deep teal-black and
warm neutrals) and the type (DM Sans, Geist Mono); its pages use thin concentric wave arcs (seigaiha) and soft clouds.
The blog opens with Homer: *"To the Elysian plain… where life is easiest for men. No snow is there, nor heavy storm,
nor ever rain."* Elymum adds one idea of its own: in Elysium everything is a feast, and the coins eat.

### 6.2 Concept: "The Ring" — day on the plain, night in orbit

- **Day (light theme, site default above the fold):** warm paper `--plain` and teal ink, like Kinetiq. Calm, generous,
  editorial.
- **Night (dark theme, the game and the mint):** deep space teal-black with luminous cyan lines, the ring's lights.
- The landing scrolls from day to night: the background interpolates as you descend from the plain into orbit.
- One recurring geometry: **arcs**. The ring horizon (a huge arc), seigaiha wave scales (stacked half-circles), orbit
  ellipses (dotted), and round coins. Straight lines are hairlines only.

### 6.3 Tokens (`apps/web/src/design/tokens.css`, mirrored in `packages/shared/src/palette.ts`)

| Token | Hex | Use |
|---|---|---|
| `--abyss` | `#04181C` | night background |
| `--deep` | `#071317` | night surfaces below |
| `--trench` | `#0F2A30` | night cards |
| `--reef` | `#163B44` | night borders, raised |
| `--current` | `#1E4D5A` | night lines |
| `--teal` | `#2D7388` | primary ink on day, buttons |
| `--cyan` | `#34B7DD` | light, focus, live |
| `--spray` | `#6FCDE8` | night accents |
| `--foam` | `#93D9EE` | night text accents |
| `--mist` | `#DBF2F9` | day tints |
| `--plain` | `#F8F7F4` | day background |
| `--linen` | `#F1EFE8` | day surfaces |
| `--sand` | `#EBE6DD` / `#DDD6C7` | day borders |
| `--stone` | `#91887A` / `#6B655A` | secondary text on day |
| `--ink` | `#1C1A14` | day text |
| `--up` | `#3C9A87` | gains, success |
| `--down` | `#FF5252` | losses, danger |
| `--sun` | `#F2C14E` | money glints only (payouts, HYPE price) |
| `--verdant` | `#5FA36A` | the habitat's fields, used in illustration only |

Every text/background pair is at least 4.5:1 (tested, like the old palette test). The four arena inks: Asphodel
`#6FCDE8`, Lethe `#93D9EE`→`#2D7388`, Golden Bough `#F2C14E`, Isles `#3C9A87`.

### 6.4 Type

- **DM Sans** (variable, optical sizes) for everything readable. Headlines in DM Sans 500–600 with tight tracking
  (−0.03em at display sizes), never bold-black.
- **Geist Mono** for numbers, labels, addresses, timers, kicker lines (uppercase, +0.08em).
- **Cormorant** (italic, 500) only for mythic voice: the Homer line, one italic word inside a headline, pull quotes.
  Never for UI.
- The **ELYMUM wordmark** is a hand-built SVG (geometric, wide, its own drawing, not a font) with the Elysium "light
  fall": vertical streaks below each letter that fade out, animated as a slow shimmer.

### 6.5 Motifs (each is one reusable component in `src/design/motifs/`)

1. `RingHorizon`: the inner curve of the habitat. Layered SVG arcs (terraces) with tiny lit windows, slow drift
   (one turn per ~4 minutes), parallax on scroll. Day and night variants.
2. `Seigaiha`: a field of stacked half-circle waves drawn in hairlines; used as section seams and card backs.
3. `OrbitPath`: a dotted ellipse with coins travelling it; used for "how a round works" and loaders.
4. `LightFall`: the vertical streak fade under a word or number (wordmark, big payouts).
5. `GrainSky`: a subtle noise + vignette layer for night surfaces (CSS only, no images).
6. `Coin`: the existing coin characters from `packages/art`, recoloured to the palette (faces stay: they are Elymum's
   personality).

### 6.6 Motion

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (out) for entrances, springs only for coins and buttons.
- Durations: 160 ms (state), 320 ms (enter), 640 ms (scene). Stagger 40 ms.
- Signature moves: the **ring turn** (a page change rotates the horizon a few degrees), **light fall** on numbers that
  change (digits drop in from a streak), **orbit capture** (a coin travels an orbit and settles into a slot when a step
  completes), the **bell** (a single expanding ring wave across the screen at round end).
- `prefers-reduced-motion`: every motion has a still fallback; nothing essential is motion-only.

### 6.7 Anti-patterns (things that make a page look generated)

No purple/indigo gradients, no glassmorphism cards floating on blurred blobs, no emoji as icons, no "✨", no generic
3-column feature grids with icons in circles, no centered-everything hero with a gradient headline, no stock "Web3"
hexagons, no lorem-like copy ("Unlock the future of…"). Copy is short, specific and a little wry. Layouts use an
asymmetric 12-column grid with deliberate whitespace; numbers are set in Geist Mono and aligned.

### 6.8 Screens

- **Landing `/`:** hero = wordmark with light fall over the RingHorizon at dawn, the Homer line in Cormorant italic, the
  live coin pond along the arc (coins eat each other), CTAs **Join the WL** and **Collab**. Then: "What Elymum is" (the
  feast, on Elysium, 5-minute rounds), "A round, in orbit" (OrbitPath with four stations: ticket → eat → bell → paid),
  the coins gallery, the NFT section (sealed emblems turning; "$1 in HYPE", WL → Mint → Play), the four arenas as
  places on the ring, FAQ, footer. The background descends from day to night as you scroll.
- **WL `/wl`:** a vertical "ascent": each task is a terrace on the ring; completing one sends a coin up the orbit to the
  next. The shareable card becomes an **Elysian boarding pass** (night, wordmark, handle, coin, seigaiha back).
- **Collab `/collab`:** same family; the review states as a mission log.
- **Mint `/mint`:** night. A large emblem on a turning ring, supply as an arc gauge, price "0.0xx HYPE ≈ $1.00" with the
  live HYPE/USD tick, quantity stepper, one primary action. Minted: the emblem drops through a light fall and lands as
  your card; "Play" appears.
- **Game:** the world is the habitat floor at night (`--abyss` with a faint arc grid that curves at the map edges like
  the ring); food and loot glow; the HUD is hairline Geist Mono instrumentation; the round chip is an arc timer; the
  Round over sheet is a "landing report" with LightFall payout.
- **Admin:** quiet and dense: day theme, Geist Mono tables, a left rail of tabs, clear MAINNET/TESTNET status pill,
  transaction preview drawers.
