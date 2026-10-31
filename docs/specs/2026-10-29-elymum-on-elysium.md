# Elymum on Elysium: contracts, mint, and the Elysian design language

Status: accepted (2026-10-29). This spec is the single source of truth for Elymum on Elysium: the contracts, the
server and web chain layer, the site and mint, and the interface.

## 0. Elymum in one paragraph

Elymum is a coin-eats-coin arena game on Elysium, Kinetiq's Arbitrum Orbit L2 that settles to HyperEVM and uses HYPE
as its gas token (EVM, 18 decimals). Gameplay, rounds, fees, the off-chain ledger and the journal run on the game
server; the money rules live in two Solidity contracts, the web app talks to EVM wallets (EIP-6963 + viem), sign-in is
SIWE (EIP-4361), and the Elymum NFT mints at $1 in HYPE. The product flow is WL → Mint → the game activates for holders.
For now the public site only collects WL applications, but the whole mint system is ready and run from `/admin`, and
the owner deploys every contract from their own wallet in `/admin`. The interface is drawn in an Elysium language
(section 6).

## 1. Names and constants

| Thing | Value |
|---|---|
| Product | **Elymum** (one word, capital E). Never "ELYMUM" in running text except the wordmark. |
| Chain | **Elysium** (mainnet) / **Elysium Testnet**; gas token **HYPE** |
| Game token | ERC-20 set once by the admin after deploy. Display symbol from `TOKEN_SYMBOL`, default **`$ELYMUM`** |
| NFT | **Elymum NFT** (ERC-721 name `Elymum`, symbol `ELYMUM`) |
| Packages | `@elymum/shared`, `@elymum/art`, `@elymum/sdk`, `@elymum/contracts`, `@elymum/server`, `@elymum/web` |
| Domain | Never hard-coded in UI copy. The site is served at whatever `PUBLIC_URL` says (for example `https://elymum.io`). Web copy uses relative links or `location.host`. `index.html` uses `%VITE_PUBLIC_URL%` for absolute OG URLs. |
| X handle | admin setting `xHandle`, default `elymumio` (https://x.com/elymumio). A stored value equal to an earlier default (`elymum`) is switched to the default on load, and the seeded WL tasks' text and links are pointed at the current handle; admin-written tasks and WL answers are never rewritten. |
| Arenas | Four tiers, named after Elysian places: **Asphodel Meadow** (1,000), **Lethe Shore** (10,000), **Golden Bough** (50,000), **Isles of the Blessed** (250,000). Ids 1–4. |

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

### 3.1 `ElymumArena`

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

### 4.2 Chain gateway

`chain/evm.ts` implements the existing `ChainGateway` with viem: it reads `config()` until the token is set (every 30 s,
then pushes `chain` to clients), lists arenas, reads sessions, and runs the settlement worker. At the bell it settles all
due items of an arena in **one `settle` batch** (chunked at 40), reconciles each item by reading the session afterwards
(a skipped or reverted item is retried with backoff; an item whose session id no longer matches is marked settled by
someone else), burns floor loot with `sweepLoot` using a monotonic `sweepId` stored in the journal, refunds nothing on
its own (players refund after 24 h) but settles stale sessions at their entry fee. Gas comes from the
server key (HYPE); a low-balance warning is logged and shown in `/admin`. Journal keys become
`<arenaId>:<player lowercase>:<sessionId>`. `chain/dev-fake.ts` is the offline fake (0x addresses, fake hashes).
`ChainStatus` is `{ enabled, chainId, chainName, rpcUrl, explorerUrl, arenaAddress, nftAddress, arenasEnabled,
tokenReady, token: { address, symbol, decimals } | null, feeBps, serverKey }`.

### 4.3 Sign-in (SIWE, EIP-4361)

`packages/shared/src/siwe.ts` builds and parses the exact message (domain, address checksummed, statement
"Sign in to Elymum. This is free and sends no transaction.", URI, Version 1, Chain ID (the server's), Nonce, Issued At).
The server verifies with viem `verifyMessage` (EOA) and falls back to `publicClient.verifyMessage` (ERC-1271/6492
smart wallets). Addresses are compared and stored checksummed. Nonces are single use and expire after 10 min.

### 4.4 Site, mint and profiles

- WL / collab: wallets are EVM addresses (`0x` + 40 hex, stored checksummed); anything else is refused. One WL entry
  per wallet and per X handle.
- Settings: `gameAccess: 'admins' | 'holders' | 'public'`. `holders` = wallets with `balanceOf > 0` on the NFT (cached 15 s, re-read uncached at every arena seat) plus admins.
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

- `src/wallet/`: EIP-6963 discovery (fallback `window.ethereum`), connect, account/chain events,
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

## 6. The Elysian design language: "Ring Storybook"

The design direction is **Ring Storybook**. The reference is `docs/design/storybook-reference.html` and its render
`docs/design/storybook-reference.png`; the live proof of every token, component and motif is `?gallery`
(`apps/web/src/design/Gallery.tsx`, `?gallery&theme=night` for night). This section is the guide every screen follows.
The UI matters most: it must look hand-drawn.

### 6.1 Sources

Elysium is Kinetiq's chain. Its launch art is an orbital ring habitat seen from inside: the ground curves up into the
sky, terraces of green fields, a band of night with the planet below. Kinetiq's brand gives the palette (teal, cyan,
deep teal-black, warm neutrals), DM Sans and Geist Mono, and the seigaiha wave scales. The blog opens with Homer: *"To
the Elysian plain… No snow is there, nor heavy storm, nor ever rain."* Elymum adds its own idea: in Elysium everything
is a feast, and the coins eat. Ring Storybook draws all of that as a **picture book**: confident ink outlines, flat cel
colour, die-cut sticker UI, plates labelled like a book.

### 6.2 Concept

- **A picture book of the ring.** The habitat is an illustration (terraces curving up, the far ring arching overhead
  with spokes and lights, the planet, a moon, chubby clouds, tiny houses, lollipop trees, a canal). The UI is stickers
  pressed onto those pages.
- **Day = the plain at dawn** (`--paper` #F8F7F4, ink text) above the fold; **night = in orbit** (`--paper` #0F2A30,
  cream text) for the mint, the game and the lower half of the landing. Sections are **plates**:
  `PLATE II  The mint, after dark  - - - - /mint`.
- **Coins are characters**: big eyes, blush cheeks, moods (smile, happy, smug, scared, chomp, sleepy, open). They bob,
  blink, chase and get eaten.
- Copy is short, specific and a little wry ("Sealed. For now.", "Nobody's rushing you. Well, a little.").

### 6.3 Tokens (`apps/web/src/design/tokens.css`, mirrored in `packages/shared/src/palette.ts`)

`palette.ts` is the single source: `ELYSIUM` (paints), `SHADE` (the one hard shadow tone of each paint), `TEXT_INKS`
(text-safe accents), `COIN_PAINTS`, `INK`, `PAPER`, `CARD_PAPER`, `INK_2`, `NIGHT`. The old `RISO` names still compile
and are aliased to the nearest paint (deprecated; new code uses `ELYSIUM`). CSS repeats the values;
`apps/web/test/palette.test.ts` keeps both in step and checks every text/background pair >= 4.5:1 in both themes.

| Paint (`--x` / `--x-s` shade) | Hex | Use |
|---|---|---|
| `--abyss` = `--outline` | `#04181C` | every outline and offset shadow, deepest night, text on light fills |
| `--deep` / `--trench` / `--reef` / `--current` | `#071317` / `#0F2A30` / `#163B44` / `#1E4D5A` | night: surfaces / page / cards / lines |
| `--teal` / `--teal-s` | `#2D7388` / `#1F5566` | water, the planet, teal buttons (cream text) |
| `--cyan` / `--cyan-s` | `#34B7DD` / `#2490B0` | the wordmark, light, focus on night, "you" |
| `--spray`, `--foam`, `--mist` | `#6FCDE8`, `#93D9EE`, `#DBF2F9` | night accents, night text accents, day tints and tape |
| `--plain`, `--linen`, `--sand`, `--sand-2` | `#F8F7F4`, `#F1EFE8`, `#EBE6DD`, `#DDD6C7` | day page, surfaces, the shore, dashed rules |
| `--cream` / `--cream-s` | `#F6EEDA` / `#DCCDA8` | sticker stock (`--sticker`), both themes |
| `--stone` | `#6B655A` | captions on day (`--ink-3`) |
| `--sun` / `--sun-s` | `#F2C14E` / `#D49A2B` | the primary button, money tags (≈ $1.00), "you" highlights, badges |
| `--up` / `--up-s` | `#3C9A87` / `#2B7465` | gains, done, the gauge fill |
| `--down` / `--down-s` | `#FF5252` / `#C93A3A` | losses, danger, MAINNET |
| `--meadow`, `--clover`, `--verdant`, `--forest`, `--pine` | `#B9D98F` … `#2F6E4F` | terraces and trees (illustration only) |
| `--blush`, `--coral` | `#F39B86`, `#D9714F` | cheeks and tongues, roofs |

Semantic tokens (switch with the theme): `--paper`, `--surface`, `--card`, `--ink`, `--ink-2`, `--ink-3`, `--on-ink`,
`--line`, `--line-soft`, `--rule`, `--focus`, `--scrim`, `--sky-0..3`. Text-safe accents: `--teal-ink`, `--up-ink`,
`--down-ink`, `--sun-ink`, `--cyan-ink` (day `#2D7388 #2B7465 #C42F2F #8A5F0E #1E6F8C`, night `#93D9EE #6FD3B8 #FF8A80
#F2C14E #6FCDE8`). Fixed: `--ink-fixed`, `--sticker`, `--on-sticker`, `--on-sticker-2`, `--white`, `--danger`. Legacy
names (`--pink` → sun, `--pink-text` → teal-ink, `--mustard`, `--blue`, `--green`, `--red`, `*-ink`) are aliases so
Paper Ticket screens keep rendering; restyled screens use the new names.

Themes: `<Kb theme="paper">` (day) or `<Kb theme="night">`; the page root follows `:root[data-theme='dark'|'night']`,
else `prefers-color-scheme`. **Islands**: cream stickers (`.kb-sticker`, tickets, report cards, sheets, toasts,
TxPreview, steps, or any `.kb-island`) keep day text tokens on the night page, exactly like the mint card in the
reference. `.kb-sticker--night` is the dark card.

Arena inks: Asphodel `#6FCDE8` (spray), Lethe `#93D9EE` → `#2D7388`, Golden Bough `#F2C14E` (sun), Isles `#3C9A87` (up).

**Outlines and shadows (the two rules that make it look drawn):**

- Outlines are ink `#04181C`, never grey, never tinted: `--stroke` 3px (stickers, buttons, cards, art at 1x),
  `--stroke-sm` 2.5px (tags, chips, keys, pills), `--stroke-xs` 2px (dense tables, tiny art). Illustration strokes stay
  ~3px at any size (scale the stroke inversely, as `CoinCharacter` does).
- Shadows are **hard offsets with no blur**, always down-right, always ink: `--sh-1` 2px, `--sh-2` 3px, `--sh-3` 4px
  (default sticker), `--sh-4` 6px, `--sh-5` 8px (hero cards, panels), `--sh-hover` 5px, `--sh-press` 1px. On night the
  shadow ink is `#000507` so it still reads on the trench page.
- Flat fills with **one** shade tone (`--x-s`), placed lower-right. No gradients except the sky.
- Radii are soft die-cut corners: `--r-key` 7, `--r-tag` 8, `--r-btn` 14, `--r-card` 18, `--r-panel` 24, `--r-pill`.
- Stickers sit a little off true: tilt within ±2° (badges up to 4°), never on dense content.

Spacing: `--s-1..9` = 4 8 12 16 24 32 48 64 96; `--gutter` clamp(16px, 4.4vw, 64px) (16px on phones); `--measure` 62ch.

### 6.4 Type

- **Fraunces** (variable, `@fontsource-variable/fraunces/full.css`) for display: weight 800 (900 for stamps), axis
  `SOFT 100` always (`--fv-display`), `WONK 1` only on one word per page or a pull quote (`.wonk`, `.quote`). Tracking
  −0.02em, line-height 0.95–1.05. Headlines are Fraunces, never bold DM Sans. Scale: `--t-hero` clamp(48–96),
  `--t-h1` clamp(40–64), `--t-h2` clamp(30–46), `--t-h3` 25, `--t-h4` 20.
- **DM Sans** (variable with optical size) for everything you read: 16/1.5 body, `--t-lede` 18, `--t-small` 14,
  buttons 700. Sub-heads under the wordmark: DM Sans 600.
- **Geist Mono** for **every number** (prices, supply, timers, addresses, totals, ranks; `.num`, tabular figures) and
  for kickers/labels (`.kicker`, `.mono`: uppercase, +0.08em, 11–12px, never smaller than 11px).
- Italic Fraunces (`.quote`) only for the mythic voice: the Homer line, pull quotes.
- The **ELYMUM wordmark** is the hand-built SVG `Wordmark` (no font): chunky cyan letters drawn with a fat round brush,
  ink edge, hard offset shadow, a mist shine, each letter a hair off the baseline. `diecut` adds a cream sticker border
  for use straight on the night page. The compact mark is `CoinMark` (a cyan coin with a fat cream E), also the favicon.
  In running text the product is "Elymum".

### 6.5 Components (`apps/web/src/design`, import from `../design`)

New: `Button` (primary sun / secondary cream / teal / up / danger / ghost; sm/md/lg; `sub`, `icon`, `lead`, `loading`),
`Sticker` (tones cream/white/sun/mist/mint/linen/night, `tilt`, `lift`, `pad`, `tape`), `PlateLabel`, `StatusPill`
(live/ok/warn/danger/idle/mainnet/testnet), `AddressChip` (+ `shortAddress`), `HypeAmount` (+ `formatWei`,
`formatHype`, `formatUsd`), `ArcGauge`, `Countdown` (flip digits), `Stepper` (terrace steps with DONE stamps),
`QuantityStepper`, `TxPreview` (admin: function, args table, value, network, signer; locks against double sends),
`Modal`, `WalletPicker`. Redrawn with the same names and props: `InkButton` (pink → primary, ink → teal, paper →
secondary), `Stamp` (rubber stamp), `Ticket`/`TicketGroup` (boarding-pass sticker), `Receipt` (sticker report card, new
`stamp` prop), `Tape`, `Chip` (pill tag), `Dateline`, `Rule`, `Field`, `Sheet`, `Tabs` (sun sticker slides between
tabs), `Toast`, `Counter`, `StampSpinner`/`Skeleton`, `ScreenTransition`. Utility classes in `storybook.css`:
`.display .wonk .num .kicker .lede .quote .mono .kb-sticker .kb-tag .kb-key .kb-island .kb-wobble .kb-sr`.

### 6.6 Motifs (`apps/web/src/design/motifs`, SVG + CSS, theme-aware, reduced-motion still, paused off screen)

1. `RingScene` (`time` dawn/night, `variant` full 1440×880 / compact / horizon, `clouds`, `animate`, children laid
   over): the hero plate. Lights crawl along the far ring, clouds drift, stars twinkle, the canal ripples.
   `SceneProp` gives a single house, tree or pine.
2. `Clouds` / `Cloud`: chubby outlined clouds (ink silhouette, white puff, mist belly, one highlight); dusky teal at night.
3. `Seigaiha`: stacked half-circle wave scales, drawn back to front; `night` band at the foot of night sections,
   `day`, and `ink` for card backs.
4. `OrbitDots`: a dotted orbit with coins riding it and labelled stations ("ticket → eat → bell → paid").
5. `Wordmark` and `CoinMark` (6.4).
6. `CoinCharacter`: the site's coin with a face (paints from `COIN_PAINTS`, moods, `look`, `feet`, `ground`, `sweat`,
   `bob`, `blink`, `chewing`). The game canvas draws its own coins in the same style.
7. `FoodBit` / `FoodScatter`: pear, grapes, seed (with the night glow).
8. Hand-inked wobble: `#kb-wobble` / `#kb-wobble-soft` SVG filters defined once per document (`<Kb>` injects them);
   use on illustration, never on text.

### 6.7 Motion (`motion.ts`, motion/react; CSS for loops)

- Easing `--ease-out` cubic-bezier(0.22, 1, 0.36, 1) for entrances; springs for coins, buttons and stickers
  (`springs.pop`, `springs.drop`, `springs.press`).
- Durations: 160 ms state, 320 ms enter, 640 ms scene; lists stagger 40 ms (`STAGGER`).
- Presets (`moves`, or `useMoves()` for the reduced-motion twins): `popIn`, `stickerDrop` (custom = tilt), `press`,
  `bob`, `chomp`, `stagger`.
- Signature moves: buttons **sink into their shadow** on press (translate 3px, shadow 4 → 1px); stickers **drop** onto the
  page and settle on their tilt; coins **bob** (2.6 s) and **blink** (5 s); the hunter **chomps**; the DONE **stamp**
  lands with a squash and an ink bloom; countdown digits **flip**; the gauge needle swings on a spring.
- `prefers-reduced-motion`: loops stand still (clouds keep a fixed spot), entrances become 120 ms fades, nothing is
  motion-only. Every looping motif pauses when off screen (`useOffscreenPause`).

### 6.8 Anti-patterns (things that make a page look generic)

No gradients on UI (the sky is the only gradient), no blurred or soft shadows, no glassmorphism, no purple/indigo, no
grey outlines or 1px hairline cards, no emoji as icons, no "✨", no three equal feature cards with icons in circles, no
centered-everything hero, no gradient headline text, no stock Web3 hexagons or glowing orbs, no lorem-like copy
("Unlock the future of…"). Do not set headlines in DM Sans bold, numbers in a proportional font, or labels in Fraunces.
Do not mix shadow directions or tilt dense content. Layouts are asymmetric (5/7, 4/8 columns) with deliberate
whitespace; one primary (sun) button per view.

### 6.9 Screens

- **Landing `/`:** Plate I "The plain at dawn": `RingScene` full with the hero sticker (kicker, `Wordmark`, "You are
  small change with a big appetite.", lede, the Homer `.quote`, **Join the WL** primary + **Collab** secondary), a sun
  badge "05:00 per round. Then lunch.", and the coin pond on the shore (a hunter chomping a scared snack, "+$0.12" pop).
  Then plates down the page from day into night: what Elymum is, "A round, in orbit" (`OrbitDots` with four
  stations), the cast of coins, the NFT plate (night, sealed emblem, "$1 in HYPE", WL → Mint → Play pills), the four
  arenas as places on the ring (tickets), FAQ, footer on a `RingScene` horizon.
- **WL `/wl`:** "Three small chores": the `Stepper` ascent (each chore a terrace sticker, DONE stamps, progress bar).
  The shareable card is an **Elysian boarding pass** (night, wordmark, handle, coin, seigaiha back) drawn as a
  `Ticket`-style sticker.
- **Collab `/collab`:** same family; review states as stamped stickers (RECEIVED, IN REVIEW, ACCEPTED).
- **Mint `/mint`:** night plate "The mint, after dark": headline with one sun word, the mint card sticker (emblem panel
  with `CoinCharacter` smug, `NO. ####` tag and "Sealed. For now." ribbon; `ArcGauge` supply; `HypeAmount` "0.0213 HYPE
  ≈ $1.00" with the HYPE/USD tick; `QuantityStepper`; one primary **Mint N emblems**; WL status with `AddressChip`),
  seigaiha band at the foot. Minted: the emblem pops in and a **Play** button appears.
- **Game:** the floor of the ring at feeding time (night arena with curving contour arcs); HUD pieces are small cream
  stickers with ink edges (round timer, "You're worth" sun badge, the leaderboard card, round minimap, `.kb-key` help);
  the Round over sheet is a `Receipt` report card with a PAID stamp.
- **Admin:** day theme, quiet and dense: Geist Mono tables with dashed rules, a rail of `Tabs`, a `StatusPill`
  MAINNET/TESTNET in the header (a red MAINNET banner on mainnet), and a `TxPreview` before every wallet prompt.
