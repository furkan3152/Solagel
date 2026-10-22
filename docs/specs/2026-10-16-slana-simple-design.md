# Slana Simple: no Pass, no seasons, token set after deploy

Status: decided by the owner in chat (2026-10-16). Goal: a smaller, easier-to-audit product for the mainnet launch. The
arena and room system (timed rounds, instances, bots, loot, practice) stays exactly as it is.

## Owner decisions

| Topic | Decision |
|---|---|
| Slana Pass (NFT, mint, reveal, Pass arenas, Pass power, 2 % fee) | **Removed everywhere** (program, SDK, server, web, art, docs). |
| Seasons (season accounts, season vault and pool, points, top-20 table, top-10 prizes, claim, rollover) | **Removed everywhere.** |
| Fee | Flat **5 % of profit** (admin-configurable, ≤ 10 %), paid **100 % to the fee wallet** (default: the admin wallet `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`). No treasury vault, no on-chain burn split; the owner burns manually off-chain (plan: 75 % burned, 25 % kept). |
| Floor loot at the bell | **Burned** (`sweep_loot` burns from the arena vault instead of moving it to a season vault). |
| Gold Lake (50,000), Whale Bay (250,000) | Stay, **open to everyone**. All four arenas differ only by entry fee. |
| Standings | Kept as an **off-chain, prize-free** leaderboard (server data only). |
| Token | **Set after deploy** ("dynamic CA"): the program deploys and initializes without a mint; the admin sets the $SLANA mint later with one command and the whole system (server, web) picks it up from the chain with no rebuild. |

## Program

Remove instructions: `mint_pass`, `close_pass_mint`, `set_pass_collection`, `set_pass_seed_hash`, `reveal_pass`,
`capture_pass_entropy`, the Pass join variant, `end_season`, `claim_season_reward`, `rollover_season`,
`withdraw_treasury`. Remove accounts: `PassLock`, `PassMinted` counters, `Season`, treasury vault, season vault.
Remove Core CPI, SlotHashes entropy and every Pass/season constant, error and event (error codes are re-numbered only if
the reference and lean stay identical; append-only no longer matters because nothing is deployed).

Kept and changed:

- `initialize(fee_bps, settle_fee_lamports, server_authority, fee_wallet)`: no mint, no vaults. Config gets
  `token_mint` / `token_program` = default (unset), `token_decimals` 0, `fee_wallet`.
- **New `set_token_mint`** (admin): accounts `admin`, `config`, `token_mint`, `token_program`. Allowed **once**, only
  while `config.token_mint` is unset (`TokenAlreadySet`); validates the mint exactly like today's `initialize`
  (freeze authority refused, denied Token-2022 extensions refused, mint owned by the given token program) and stores
  mint, program and decimals. Emits `TokenMintSet`.
- `create_arena` and `join_arena` fail with `TokenNotSet` while the mint is unset. `join_arena` loses the Pass path and
  `max_fee_bps` keeps protecting the player; `Arena.requires_pass` is removed.
- `settle_session`: `profit = max(0, payout − entry_fee)`, `fee = floor(profit × session.fee_bps / 10 000)`; the fee
  goes to `fee_wallet_token` (a token account of `config.token_mint` owned by `config.fee_wallet`; checked); the player
  gets `payout − fee`; no burn, no season. Two-phase settle (R24, `owed`) unchanged. Season points removed from
  `record_result`; profile keeps name, skin, XP, games, kills, best/total score, totals.
- `refund_session`: unchanged except the Pass lock.
- `sweep_loot(amount)` (server): **burns** `amount` from the arena vault (`InsufficientPot` if more than the vault),
  emits `LootBurned`.
- `sweep_arena` (admin, arena disabled and idle): moves the whole vault to `fee_wallet_token`.
- `update_config`: fee bps (≤ 1000), settle fee, pause, server authority, admin, fee wallet. No split, no Pass fields.
- Everything else (`register_player`, `update_profile`, `create_arena`, `update_arena`) stays.
- The lean program stays wire-compatible with the reference; the size gate stays (expected well under 50 KB).

## Off-chain

- **SDK / admin CLI:** drop Pass, season and treasury commands; add `pnpm admin set-token --mint <CA>` which also
  creates the fee wallet's token account (admin pays) in the same transaction; `init` no longer needs a mint;
  `create-arena --defaults` creates four open arenas.
- **Server:** reads `token_mint` from the config at start and re-reads it every 30 s until set; while unset it runs
  practice only and reports `tokenReady: false` (`/api/config`, `welcome`). Remove Pass power, NFT verification, Pass
  metadata endpoints, season reads and the entropy capture. The settlement worker passes the fee wallet token account;
  loot sweeps burn. Leaderboard stays off-chain.
- **Web:** remove the Pass tab, mint/reveal flows, season standings/claim and every Pass perk line; the Standings tab
  shows the off-chain leaderboard; arenas show "Opening soon" while `tokenReady` is false; the token symbol and decimals
  come from the config.
- **Art:** keep the coin drawing used by the renderer; delete Pass traits, Pass card and the `pnpm pass:*` generator.
- **Docs / guide / README / PROJECT.md / DEPLOY / OPERATIONS / ARCHITECTURE:** rewritten for the simple model; DEPLOY
  gets the order: deploy → `init` → (later) `set-token` → `create-arena --defaults`.
- **Media:** videos are out of scope for this change (they still mention the Pass and seasons; re-cut later on request).

## Testing

Program: LiteSVM suite on both impls updated (removed instructions' tests deleted; new tests for `set_token_mint`
once-only and validation, join/create blocked before the mint, fee to the fee wallet, loot burn, sweep to fee wallet);
size gate. Server/web: existing suites green with Pass/season tests removed; tests for `tokenReady` false → practice
only and arenas "Opening soon", and for the mint being picked up without restart. Localnet e2e: init without mint,
start server, set mint, create arenas, play a round, fee lands in the fee wallet, loot burned.
