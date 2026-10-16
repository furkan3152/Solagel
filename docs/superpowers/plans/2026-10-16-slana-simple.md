# Slana Simple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Remove the Slana Pass and seasons, pay the flat profit fee to the fee wallet, burn floor loot, and let the
admin set the token mint after deploy, keeping arenas, rounds and rooms unchanged.

**Spec:** `docs/superpowers/specs/2026-10-16-slana-simple-design.md` (binding for every value below).

## Global Constraints
- Fee: default `fee_bps` 500, max 1000; fee wallet default = admin `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`.
- Token mint set once by the admin after `initialize`; nothing on-chain or off-chain may assume a mint at deploy time.
- Arena/round/room behaviour unchanged (5-minute rounds, joins close in the last 60 s, instances of 50, bots, loot).
- Program: ref and lean wire-compatible; lean `.so` ≤ 71,000 bytes (report the new size and rent);
  `#![deny(clippy::arithmetic_side_effects)]`; IDL drift check green.
- English only (CI guard); no emoji; never commit keypairs, `target/`, `.localnet/`; never touch
  `target/deploy/slana-keypair.json` in tests.
- Done means: `scripts/test-program.sh`, `pnpm -r typecheck && pnpm -r test`, `pnpm -F @slana/web build` green.

## Review Focus
- A settle must never send the fee to an account not owned by `config.fee_wallet` or not of `config.token_mint`.
- `set_token_mint` must be impossible twice and impossible for a non-admin; a frozen/denied-extension mint is refused.
- Before the mint is set: no arena can be created or joined, the server serves practice only, the web shows arenas as
  "Opening soon" and never crashes on an unset mint (default pubkey).
- After the mint is set the server and web pick it up without a restart or rebuild.
- Removing Pass/season code must not leave dead routes, UI tabs, env vars or docs that promise them.

## Task 1: Program
- Apply the spec's Program section to `programs/slana-ref` and `programs/slana-lean` (remove Pass/season/treasury,
  add `set_token_mint`, `fee_wallet`, fee to the fee wallet token account, `sweep_loot` burns, `sweep_arena` to the fee
  wallet). Regenerate the IDL/TS types (`packages/sdk/src/idl`) with the repo tooling.
- Tests (LiteSVM, both impls): set_token_mint once-only, non-admin, frozen mint, denied extension, Token-2022 ok;
  create_arena/join_arena before the mint → `TokenNotSet`; settle with profit pays fee to the fee wallet and the rest to
  the player; settle with a wrong fee account (wrong owner, wrong mint) fails; loot burn lowers supply and vault;
  sweep_arena to the fee wallet; two-phase settle and refund still pass; size gate.

## Task 2: SDK and admin CLI
- `packages/sdk`: builders, account views and fee math for the new program; remove Pass/season/treasury code; admin CLI
  `init` (no mint, `--fee-wallet` default admin), `set-token --mint <CA>` (also creates the fee wallet's associated
  token account idempotently, admin pays), `create-arena --defaults` (four open arenas), `update-config`, `status`,
  `pause`, `sweep`; `status` shows "token: not set" until set. Tests for the fee math and the CLI parsing.

## Task 3: Server
- Config watcher: token mint read from the chain at start and every 30 s until set; `tokenReady` on `/api/config` and
  `welcome`; arenas attach only once set. Remove Pass power, NFT verification, Pass metadata/image routes, season reads,
  entropy capture, Pass env vars. Settlement worker passes the fee wallet token account; loot sweeps burn. Leaderboard
  stays off-chain. Dev fake chain starts with the mint unset unless `DEV_FAKE_TOKEN=1` (the demo sets it) and has a dev
  route to set it. Update `apps/server/scripts/e2e.ts` for: init without mint, set mint, arenas, a round, fee in the fee
  wallet, loot burned. Tests for the unset → set transition.

## Task 4: Web and art
- Remove the Pass tab, mint/reveal, season standings and claim, Pass perk copy, Pass arena badges; Standings = off-chain
  leaderboard; arenas "Opening soon" while `tokenReady` is false; symbol/decimals from config. `packages/art`: keep the
  coin drawing, remove Pass traits/card/generator and its scripts. RTL tests for the unset-token lobby; smoke run.

## Task 5: Docs and demo
- README, `docs/PROJECT.md`, ARCHITECTURE, DEPLOY (order: deploy → init → set-token → create arenas; costs with the new
  size), OPERATIONS, in-app guide and facts, remove PASS-ART.md; `pnpm demo` works (fake chain with the token set);
  re-shoot `docs/images` that show the Pass or seasons.
