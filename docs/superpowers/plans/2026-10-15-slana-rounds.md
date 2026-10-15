# Slana Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Paid arenas play 5-minute wall-clock rounds: no cash-out, late join and buy-back at the same fee until the last minute, everyone alive is paid their till at the bell, floor loot goes to the season pool.

**Spec:** `docs/superpowers/specs/2026-10-15-slana-rounds-design.md` (binding for every value below).

## Global Constraints
- Round: `RULES.roundMs = 300_000`, `RULES.roundJoinCloseMs = 60_000`, aligned to Unix time (`n = floor(now / roundMs)`); env overrides `ROUND_SECONDS`, `ROUND_JOIN_CLOSE_SECONDS` (server only).
- Practice is unchanged. Admin kick and shutdown still settle at the current value.
- Program: lean `.so` ≤ 71,000 bytes; `#![deny(clippy::arithmetic_side_effects)]`; ref and lean wire-compatible; IDL drift check stays green; error codes append-only.
- English only (CI guard). No emoji in UI. Touch targets ≥ 44 px. Reduced-motion paths for new animations.
- Never commit keypairs, `target/`, `.localnet/`; never touch `target/deploy/slana-keypair.json` in tests.
- Done means: `cargo test` (both `SLANA_IMPL=ref` and `lean`), clippy gate, `pnpm -r typecheck && pnpm -r test`, `pnpm -F @slana/web build` green.

## Review Focus
- A ticket bought while joins are closed must play the next round, never be lost or refunded as stale.
- A staker who disconnects (AFK) must still be paid at the bell (or lose it if eaten), never cashed out early.
- Round end with zero loot / zero stakers must not enqueue empty or failing chain work (zero sweep = skip).
- Server restart mid-round: live stakes and loot recovered from the journal must still conserve value; a sweep item pending at restart is executed exactly once.
- Client clock skew: timers use the server time offset, never the raw local clock.

## Task 1: Program `sweep_loot`
- Add `sweep_loot(amount: u64)` to `programs/slana-ref` (accounts, constraints, `LootSwept { arena_id: u16, season_id: u32, amount: u64 }` event) and to `programs/slana-lean` (new instruction file, dispatch, discriminator, event), exactly as the spec's Program section; reuse the `sweep_arena` helpers (`stake::check_arena`, `check_arena_vault`, `check_current_season`, `check_token_addresses`, `pay_from_vault`, `stake::add`). Signer check: `server == config.server_authority` else `Unauthorized`; `amount > vault.amount` → `InsufficientPot`; `amount == 0` → Ok with no transfer and no event.
- Regenerate the IDL + TS types in `packages/sdk/src/idl/`; add `client.ix.sweepLoot(server, { id, amount, currentSeason, tokenMint, tokenProgram })` to the SDK.
- Tests (LiteSVM, both impls): happy path moves tokens and `season.pool`; wrong signer; amount > vault; zero amount no-op; wrong season; discriminator/error table tests updated; size gate passes (report bytes before/after).

## Task 2: Server rounds
- `packages/shared`: `RULES.roundMs`, `RULES.roundJoinCloseMs`; `roundAt(nowMs, roundMs, closeMs) → { n, startsAt, endsAt, joinsCloseAt }`; protocol: `round` field on room info and `joined`, `serverNow` on `welcome`/`pong`, new server message `{ t: 'roundOver'; round: number; payout: number; stats: DeathStats; standings: { name: string; value: number; you?: boolean }[] }`, error codes `round_closed` (with `opensAt`) and `no_cashout`; `SettleReason` gains `'round'`.
- `apps/server`: config reads the env overrides; gateway refuses arena joins inside the closed window; rooms reject cash-out in arenas and no longer AFK-cash-out stakers; round-end handler per the spec (settle live + AFK at value, reason `round`; sweep item for floor loot in the same journal commit; `roundOver` to humans; world reset; bots continue). Journal gets a `kind: 'sweep'` item (`key = sweep:<roomId>:<n>`, `arenaId`, `amount`) counted in the conservation invariant; `chain/solana.ts` worker sends `sweepLoot`; `chain/dev-fake.ts` adds to its season pool. Zero amount → no item.
- Tests: round math (boundaries, env overrides); join refused at `joinsCloseAt` and accepted at the next `startsAt`; cash-out rejected; AFK staker survives past `afkGraceMs` and is settled at the bell; round end settles everyone and sweeps loot (conservation test extended); sweep item survives journal reload and is executed once; fake chain season pool grows by the swept amount; `apps/server/scripts/e2e.ts` uses round end instead of cash-out (run with `ROUND_SECONDS=30` on localnet).

## Task 3: Web rounds UI
- Server time offset from `serverNow`; a `useRound()` hook giving `{ n, msLeft, phase: 'open' | 'closing' }` per arena.
- HUD round chip (`m:ss`, "Final minute", 10 s countdown); cash-out button, key and sheet removed from arenas; round-end freeze + bell + "Round over" receipt sheet (till, fee, paid, place, top 5, "Next round" / "Lobby"); lobby ticket rows show round state; held-ticket state when bought in the closed window with auto-join at the next round; death sheet "Buy back in" / "Next round in".
- Sound: last-10 s tick, round bell, announcer "One minute left.", "Ten seconds.", "Round over.".
- `i18n/en.ts` strings for all of the above; remove cash-out copy.
- Tests: RTL for chip phases, receipt sheet, lobby states, held ticket auto-join, no cash-out control in arenas; Playwright smoke still green.

## Task 4: Docs, guide and demo
- In-app guide (`ui/docs/content.en.ts`, `facts.ts`), README, `docs/*.md` (rules, economics, operations: sweep_loot, round env vars), Pass perks (the faster cash-out perk is gone in arenas), DEPLOY costs if size changed; `pnpm demo` shows rounds (demo may shorten rounds with `ROUND_SECONDS`); walkthrough recorder flow updated (play until the bell instead of cash-out).
- CI green; the English guard passes.
