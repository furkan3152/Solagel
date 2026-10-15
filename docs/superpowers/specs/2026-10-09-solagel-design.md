# Solagel — an on-chain Agar.io on Solana (Design Document)

> **Note (2026-10-14):** This document is superseded by [`2026-10-14-slana-design.md`](2026-10-14-slana-design.md) (game name Slana; token rooms, the Slana Pass NFT, a new interface).

Date: 2026-10-09 · Status: Implemented (the user left the design decisions to us: "you do the designs … set up the whole system")

## 1. Request and understanding

**What the user said**
- An on-chain version of Agar.io running on Solana mainnet.
- We do the designs; it should be very cute and coin-themed.
- Extra features, especially a leaderboard.
- A well-tuned interface.
- Smart bots play when there are no real players.
- "Set up the whole system": a system that works end to end.

**Our assumptions (can be changed)**
- "On-chain" = **hybrid architecture**: real-time physics (30 Hz) cannot run on Solana L1 (≈400 ms slots, a fee per transaction, compute limits). So the game loop runs on an authoritative game server; **money, identity, stats, the season leaderboard and prizes are on-chain** (an Anchor program).
- Two modes: **Free Play** (no wallet/guest; with bots) and **High Stakes (Stake) Arenas** (entry in SOL, take an opponent's value as you eat them, "cash out" whenever you like). **No bots** in stake arenas (bots do not play with real money).
- The program is prepared for mainnet; the first deployment is tried on devnet. Since the SOL and the keys are the user's, **we do not deploy to mainnet**; we provide a script + a guide.
- Real-money games may need a licence in some countries; the stake mode is switched on and off with a configuration flag and the README carries a warning.

**Success criteria**
- Locally with `pnpm dev`: the server + client start, you enter a game without a wallet, the bots play smartly, the leaderboards fill.
- With the program deployed on a local validator: creating a profile with a wallet, entering a stake arena, the on-chain payout after death/cash-out, and the season leaderboard update.
- The program tests (LiteSVM), the server and shared package tests are green.

## 2. Architecture

```
┌──────────────┐  WebSocket (binary snapshot + JSON control) ┌────────────────────┐
│  Web client  │ ◀─────────────────────────────────────────▶ │  Game server       │
│  Vite+React  │                                             │  Node 22 + ws      │
│  Canvas 2D   │──── REST (leaderboard, season, rooms) ─────▶│  30 Hz simulation  │
└──────┬───────┘                                             │  Bots, rooms       │
       │ wallet-signed tx (profile, skin, arena entry)        │  Settlement queue  │
       ▼                                                     └─────────┬──────────┘
┌──────────────────────────────────────────────┐   server-signed tx   │
│ Solana program `solagel` (Anchor 1.2, sBPFv3)│◀─────────────────────┘
│ Config · PlayerProfile · Arena(vault) · Session│  (settle_session, record_game)
│ Season(leaderboard + prize pool)             │
└──────────────────────────────────────────────┘
```

Monorepo (pnpm workspaces):

| Package | Contents |
|---|---|
| `programs/solagel` | Anchor program + LiteSVM tests |
| `packages/shared` | Game constants, formulas, binary protocol codec, skin catalogue, emote/arena metadata |
| `packages/sdk` | Program client: IDL, PDA helpers, instruction builders, account readers, admin CLI |
| `apps/server` | Game server: simulation, rooms, bots, auth, chain service, REST |
| `apps/web` | Client: canvas renderer, React interface, wallet integration, sound, i18n (TR/EN) |

## 3. Game design

### 3.1 Theme: "Jelly coins"
- Players are **cute coins that wobble like jelly** (name: Solagel = Sol + agar jelly). Every cell: a metallic coin rim, an embossed inner ring, a symbol in the middle, huge shiny eyes (the pupils look in the direction of movement), pink cheeks, a small smile.
- **Facial expressions**: scared (>_<) when a bigger threat is near, hungry (mouth "O") when there is prey it can eat, happy otherwise; random blinking.
- **Food = "lamports"**: tiny pastel coins and gems; a rare **gold coin** gives more mass.
- **Virus = "Rug Cactus" 🌵**: a spiky green cactus. Hit it while big and you get "rugged" (split into pieces). While small you can hide behind it. After 7-8 mass ejections it shoots out a new cactus.
- **Ejected mass = "tip"**: a tiny coin in the player's colour.
- Background: a cream/pastel floor, a lavender grid, a candy-striped world border. A dark mode ("Night Market") option.
- UI style: thick purple outline, round cards with hard shadows (sticker look), the Fredoka font, palette: cream `#FFF6E9`, ink `#3D2C5E`, gold `#FFC93C`, Solana purple `#9945FF`, mint `#14F195`, pink `#FF8FB8`, sky `#7CC8FF`.

### 3.2 Mechanics (constants in `packages/shared/src/constants.ts`, tunable)
- Radius `r = 10·√m`. Start mass 20. Speed `v = K·r^-0.44` (small is fast, big is slow).
- **Eating**: mass ratio ≥ 1.25 and centre distance `< r_big − 0.4·r_small`.
- **Split (Space)**: every cell with mass ≥ 35 splits in two, the new half is launched towards the mouse; at most 16 cells. Merge time `12 s + 0.015·m`.
- **Mass ejection (W)**: −18 mass, a 14-mass "tip".
- **Cactus**: mass 100; a cell with more than 1.33 times the cactus's mass that touches it pops → half of its mass scatters into up to 15 pieces.
- **Mass decay**: 0.15 % per second above 150 mass. At most 12 000 mass per cell (it splits automatically when exceeded).
- **Extra features**:
  - **Airdrops** 🪂: crates falling by parachute; inside, 🧲 Magnet (pulls food, 10 s), 🚀 Pump (+40 % speed, 6 s), 🛡️ HODL shield (you cannot eat or be eaten, 8 s), 💰 Bag (+mass).
  - **Coin Rain** 🌧️: every ~4 minutes, 25 seconds of plentiful gold coins, announced with a banner.
  - **Emotes** (keys 1-8): GM, WAGMI, 🚀, 💎🙌, 😭, 😋, 🫡, ❤️ — a speech bubble above the cell.
  - **Chat** (Enter), **kill feed**, **spectate mode** (follow the leader), **private rooms** (5-digit code).
  - **Minimap**: your own position + crown marks for the top 3 players.
  - **Mobile**: a virtual joystick + split/eject/cash-out buttons.
  - **Sounds**: cute effects synthesized with WebAudio (no assets needed).
  - **TR/EN language** support, settings (show names/mass, dark mode, jelly quality, sound, FPS).

### 3.3 Skins (24, fully original art — no real token logos are used)
- 0–7 **free**: Solly, Goldie, Penny, Minty, Bubbles, Skye, Zesty, Grape.
- 8–15 **level-locked** (from on-chain XP): Bitsy (2), Ethy (3), Doggo (5), Froggy (7), Hattie (10), Moonie (13), Rocket (16), Whale (20).
- 16–23 **premium** (bought on-chain, default 0.05 SOL → treasury): Diamond Hands, Laser Eyes, King Coin, Ninja, Rainbow, Ghosty, Bull, Bear.
- Level: `level = 1 + ⌊√(xp/50)⌋`.

### 3.4 Game modes and rooms
- **Free Play**: public rooms (40-human capacity, a new one opens when full), with bots.
- **Private room**: join with a code, optional bots, closes when empty.
- **Stake arenas** (one room per arena on-chain): Penny Pond ◎0.01, Silver Stream ◎0.05, Golden Lake ◎0.1. No bots.
  - Everyone starts with equal mass and `value = buy_in`. When a cell is eaten, value moves **in proportion to mass**: `t = ⌊V_b · m_eaten / M_b⌋` (whole lamports, the total is conserved). If the last cell is eaten, the whole value moves.
  - Food gives mass, not value.
  - **Cash-out (C)**: a 3-second channel; it is cancelled if one of your cells is eaten during it. If it succeeds, the server pays out on-chain with `settle_session`.
  - If the connection drops, the cells stay in the world for 45 s (they can be eaten); if the player does not come back, an automatic cash-out.
  - Fee: **5 % of profit only** (`fee_bps=500`); half of the fee goes to the season prize pool, half to the treasury.

### 3.5 Smart bots
- Population: `bot = clamp(18 − humans, 3, 18)`; as humans arrive, bots that die do not respawn, and they come back when humans leave. If a room stays without viewers for 60 s, the simulation sleeps.
- **Context steering**: 24-direction interest/danger maps. Interest: food density (inside a cone, decreasing with distance), prey value, power-ups; danger: threats' proximity to the future position (including the threat's split range), walls, cacti (if you are big). When small and threatened, interest in hiding behind a cactus.
- **Split hunting**: if the prey satisfies `m/2 ≥ 1.25·m_prey` and is within split range, and no threat nearby could eat the halves, aim at the prey's future position and split.
- **Merging**: with no danger/prey, gather at the centre of mass.
- **Personalities**: farmer, hunter, coward, balanced; a difficulty mix (40 % easy, 40 % medium, 20 % hard) → reaction time (100–300 ms), aim error, split courage.
- Cute names (`gm_gummy`, `hodl_hamster`, `moon_mochi` …), random skins, an occasional emote (😋 after a kill, 👑 at the top).

## 4. On-chain program (`solagel`)

### 4.1 Accounts (PDA seeds)
- `Config ["config"]`: admin, server_authority, treasury, fee_bps (≤1000), season_share_bps, skin_price, current_season, paused, counters.
- `PlayerProfile ["profile", owner]`: name (≤16 bytes UTF-8), skin, premium skin bit mask, xp, games/kills/best score, season points, stake stats, timestamps.
- `Arena ["arena", id_u16_le]`: buy_in, max_players, enabled, open_sessions, totals. **The Arena account's lamports above rent = the vault (pot)**; since the program owns it, lamports move directly.
- `Session ["session", arena, player]`: player, arena, buy_in, open time, id. One open session per player per arena.
- `Season ["season", id_u32_le]`: a sorted 20-entry leaderboard (player, points, best score, name, skin), finalized, prize_pool, claimed_mask. **Lamports above rent = the prize pool.**

### 4.2 Instructions
| Instruction | Authority | Description |
|---|---|---|
| `initialize` | the program's **upgrade authority** | creates Config + Season 1 (prevents front-running) |
| `update_config` | admin | authorities, fees, price, pause |
| `create_arena` / `update_arena` | admin | arena tiers |
| `register_player` | player | profile (with a free skin) |
| `update_profile` | player | name/skin (lock checked on-chain) |
| `buy_skin` | player | premium skin; SOL to the treasury |
| `join_arena` | player | buy_in to the arena, a Session is created |
| `settle_session` | server_authority | payout (fee from profit), stats, XP, season points, leaderboard; the Session closes |
| `record_game` | server_authority | free-play stats/XP/season points |
| `refund_session` | player | refunds `min(buy_in, pot)` on a session unsettled for 24 hours (a last resort against a server crash) |
| `fund_season` | anyone | a donation to the prize pool |
| `end_season` | admin | freezes the season, fixes the pool, opens the next season |
| `claim_season_reward` | top 10 | shares: 30/20/14/10/8/6/4.5/3/2.5/2 % |
| `rollover_season` | admin | after the 30-day claim window, moves the remainder to the active season |
| `sweep_arena` | admin | the arena's leftover to the treasury when there are no open sessions |

### 4.3 Security and trust model
- Every money movement is on-chain and auditable; **the correctness of the game's outcome trusts the server** (the server is the referee). This is the standard hybrid model for real-time games; later it could move to verifiable gameplay with MagicBlock ephemeral rollups.
- A `settle_session` payout cannot exceed the arena vault; the vault always stays rent-exempt; all arithmetic is `checked_*`.
- If the server key is compromised, the impact is: the arena vaults. Mitigations: `paused`, key rotation (`update_config`), a minimum SOL on the server wallet, monitoring. An independent audit is recommended before mainnet.
- The server ties a session's age to a forced cash-out at 6 hours (well under the 24-hour refund window) → the refund/game double-spend window is closed.
- Sessions that never connected are refunded by the server after 15 minutes with `payout = buy_in`.

## 5. Server

- `node:http` + `ws`. REST: `/api/health`, `/api/rooms`, `/api/leaderboard` (daily/all time), `/api/season` (from the chain, cached 30 s), `/api/auth/nonce`.
- **Protocol**: client → server binary input (target, split, eject) + JSON control (join, auth, chat, emote, cashout, spectate, viewport). Server → client binary **delta snapshot** (only entities in view; food is sent once; moving entities every tick; removals carry the "eater" id → eat animation) + JSON (leaderboard 1 Hz, kill feed, chat, events, death stats, cash-out state).
- A **spatial grid** (256-unit cells) for collision/view queries.
- **Auth**: a Sign-In-With-Solana style message + ed25519 verification (tweetnacl), a single-use nonce; then a 24-hour HMAC token (no need to sign again).
- **Chain service**: profile cache (skin/name validation), session validation, a **persistent settlement queue** (`data/journal.json`, atomic writes). On every settle event and every 2 s a snapshot with all live stake values is written; on restart, live players are cashed out automatically with their last values → vault conservation.
- If the chain is not configured (no PROGRAM_ID/key), the server runs in free mode only.
- Rate limits, input validation, a per-IP connection limit, a chat filter.

## 6. Client

- Vite + React 19 + TypeScript; the game loop runs outside React (`GameEngine`), the HUD state is updated at ~10 Hz through a small store.
- Renderer: pre-drawn sprites (food, cactus), jelly polygon cells, LOD (no face on small cells), interpolation, a smooth camera/zoom, particles (eat sparkle, split puff, cactus confetti, coin rain).
- Screens: Lobby (live arena background), skin carousel, mode tabs, leaderboard panel (Season on-chain / Today / All time), profile card (level, XP), skin shop, create/edit profile, settings, how to play, death screen, cash-out success screen (confetti + explorer link).
- Wallet: `@solana/wallet-adapter-react` (Phantom/Solflare/Backpack automatically through Wallet Standard), a wallet modal of our own design.
- If the program is not deployed, the on-chain features show gracefully as "offline"; the game is still playable.

## 7. Test strategy
- Program: Rust integration tests with LiteSVM (authorities, fee math, vault conservation, refund timeout, leaderboard ordering, prize claims, skin locks, pause).
- Shared: codec round-trip, formulas.
- Server: physics rules (eating, splitting, merging, cactus pop), stake value conservation (the total stays constant over random eats), journal recovery, a headless bot simulation (thousands of ticks: no NaN, bots grow, the population is stable).
- Client: type check + build; screenshots with Playwright.
- End to end: local validator + deploy + admin init + server + real tx flow.

## 8. Out of scope (for now)
- Verifiable on-chain physics (ephemeral rollup), staking with an SPL token, NFT skins, teams/clans, tournament brackets, cross-server scaling (one process runs many rooms).
