# Slana v3 (Lean Program + English) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a byte-for-byte wire-compatible Pinocchio rewrite of the `slana` program at ≤ 71,000 bytes (≤ 0.5 SOL rent) and make the whole repository English-only.

**Architecture:** The current Anchor program becomes `programs/slana-ref` (lib name stays `slana`, so the IDL and the TS SDK are unchanged); it is never deployed and serves as IDL source and differential-test reference. The new `programs/slana-lean` (Pinocchio, lib `slana_lean`) is the deployed artifact. The existing LiteSVM suite runs against both `.so` files; passing it on the lean build defines "function preserved".

**Tech Stack:** Anchor 1.2.1 (reference/IDL only), Pinocchio 0.11.x + pinocchio-token 0.7 / pinocchio-token-2022 0.4 / pinocchio-system 0.6 / pinocchio-log 0.5, Rust 1.97.1, Agave 4.3 (`/opt/solana/bin`), LiteSVM 0.17, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-10-15-slana-lean-program-and-english-design.md`

## Global Constraints

- Deployed program size: `target/deploy/slana_lean.so` ≤ **71,000 bytes** (enforced by a test and CI). Rent formula `(len + 45 + 128) × 6960` lamports.
- Wire compatibility with the reference: instruction discriminators + Borsh args, account order/flags, account discriminators + Borsh layout + `space`, PDA seeds, `SlanaError` codes (6000+, append-only), events, and the Anchor built-in codes 2003, 2006, 2012, 2014, 2015, 3007, 3012 where the reference raises them.
- Program id unchanged: `5skf5Twyqr8M84dJ8RLGfz1NU6fR3zPDRLUvGd5y7472`. The program keypair is never committed.
- Lean program: `no_std`, no allocator, no `format!`/`core::fmt`, no floats. Logging only where it is part of the contract (`Pass entropy: slot … hash …`, events).
- No behaviour change to any v2 ruling (R1–R24). Any behavioural trade-off needed for size → stop and ask the user.
- English only everywhere when Phase B is done; CI grep guard rejects the Turkish-specific letters `[\x{e7}\x{11f}\x{131}\x{f6}\x{15f}\x{fc}\x{c7}\x{11e}\x{130}\x{d6}\x{15e}\x{dc}]` (PCRE code points: c-cedilla, g-breve, dotless i, o-umlaut, s-cedilla, u-umlaut and their capitals) in tracked text files.
- Never commit keypairs, seeds, `.localnet/`, `target/`. Commit messages end with the two attribution lines.
- Done means: `cargo test` (both implementations), `pnpm -r typecheck && pnpm -r test`, `pnpm -F @slana/web build`, `pnpm -F @slana/server build`, size gate, localnet e2e on the lean build.

## Review Focus

1. A missing owner/signer/writable/PDA/discriminator check in the lean program that the Anchor constraint enforced (account substitution).
2. Borsh layout drift (padding, `Option`, `String` length prefix, `Vec` of `LeaderEntry`) between lean writes and reference reads.
3. Closing accounts: lamports drained, data zeroed, owner reassigned, so a closed account cannot be revived in the same transaction.
4. Token-2022 vs SPL Token program selection and `transfer_checked` decimals.
5. Arithmetic overflow (the reference builds with `overflow-checks = true`; lean must use checked math explicitly).

---

## Phase A — lean program

### Task 1: Split workspace, scaffold lean crate, dual-target test harness, size gate

**Files:** move `programs/slana` → `programs/slana-ref` (package `slana-ref`, `[lib] name = "slana"`); create `programs/slana-lean/{Cargo.toml,src/lib.rs,src/entrypoint.rs}`; modify `programs/slana-ref/tests/common/mod.rs` (or move tests to a shared `programs/tests` crate), `Anchor.toml`, root `Cargo.toml`, `scripts/{localnet.sh,sync-idl.mjs,fetch-programs.sh}`, `.github/workflows/ci.yml`, `Dockerfile` if it references the `.so`.

**Interfaces — produces:**
- `cargo build-sbf --manifest-path programs/slana-lean/Cargo.toml` → `target/deploy/slana_lean.so`.
- Test harness env var `SLANA_IMPL=ref|lean` (default `lean`); `ref` loads `target/deploy/slana.so`, `lean` loads `target/deploy/slana_lean.so`, both at the same program id. A `cargo test` alias or script runs the suite twice.
- `tests/size.rs::lean_program_fits_half_sol` asserts `slana_lean.so` ≤ 71,000 bytes and prints the rent.
- Lean entrypoint dispatches on the 8-byte discriminator; every instruction initially returns Anchor's `InstructionFallbackNotFound` (101).

- [ ] Step 1: Move the crate with `git mv`, rename the package, keep lib name `slana`; `anchor build --ignore-keys` still emits the same IDL (`git diff --exit-code packages/sdk/src/idl` after sync-idl).
- [ ] Step 2: Scaffold the lean crate (Pinocchio `no_std` entrypoint, `panic = "abort"` + `opt-level = "z"` + `strip` in a dedicated release profile for this crate only, the 21 discriminators as constants generated from the reference by a test that compares them with `sha256("global:<name>")`).
- [ ] Step 3: Harness selects the `.so` by `SLANA_IMPL`; run `SLANA_IMPL=ref cargo test` → 89 pass; `SLANA_IMPL=lean` → failures expected (record the count).
- [ ] Step 4: Add the size gate test; update scripts/CI so the deploy artifact is `slana_lean.so` (localnet `--bpf-program`/deploy uses it) and CI runs both suites (lean failures allowed only in this task: mark the lean job `continue-on-error: true` with a TODO removed in Task 5).
- [ ] Step 5: Commit `build: split Anchor reference and Pinocchio lean program, dual-target tests`.

### Task 2: Lean foundations + config/admin instructions

**Files:** `programs/slana-lean/src/{error.rs,state.rs,accounts.rs,borsh.rs,cpi/{system.rs,token.rs},instructions/{initialize,update_config,set_pass_collection,set_pass_seed_hash,create_arena,update_arena,withdraw_treasury}.rs}`.

**Interfaces — produces:** `state.rs` — fixed-offset readers/writers for `Config`, `PlayerProfile`, `Arena`, `Session`, `PassLock`, `Season` (with `[LeaderEntry; LEADERBOARD_SIZE]` as the reference stores it), `MintCounter`, each with `DISCRIMINATOR` and `SPACE` equal to the reference. `accounts.rs` — `check_signer`, `check_writable`, `check_owner`, `check_pda(seeds, bump) -> Result`, `load::<T>(acc)` (owner + discriminator + length), `init_pda(payer, acc, seeds, space)`, `close(acc, dest)`. `error.rs` — `SlanaError` codes identical to the reference + the Anchor built-ins listed in Global Constraints.

- [ ] Step 1: Golden layout test (`tests/layout.rs`): for each account type, create via the lean program where possible (or write raw bytes with lean serializers in a host test) and decode with the reference `AccountDeserialize`; and the reverse. Error-code table test comparing lean constants to the reference enum.
- [ ] Step 2: Implement the seven admin/config instructions, porting validation one-for-one from the reference (`initialize` checks the ProgramData upgrade authority exactly as today).
- [ ] Step 3: `SLANA_IMPL=lean cargo test --test admin` green; ref suite still green; record size.
- [ ] Step 4: Commit `feat(lean): accounts, layout, config and admin instructions`.

### Task 3: Profiles and the arena money path

**Files:** `programs/slana-lean/src/instructions/{register_player,update_profile,join_arena,join_arena_with_pass,settle_session,refund_session,sweep_arena}.rs`, `src/logic.rs` (split_payout, mul_bps, apply_game, leader_entry, upsert_leaderboard — ported from the reference `logic.rs` with its unit tests).

- [ ] Step 1: Port `logic.rs` with its unit tests (host `cargo test -p slana-lean`).
- [ ] Step 2: Implement the seven instructions: Token/Token-2022 detection by mint owner, `transfer_checked`, `burn`, the R7 extension deny-list (`validate_mint`), Pass gating via the Core asset parser, PassLock, fee snapshot (R19), `max_fee_bps`/`max_entry_fee`/`max_settle_fee` (M3), two-phase settle with optional `player_token` (R24), finalized refund, sweep guards.
- [ ] Step 3: `SLANA_IMPL=lean` → `profile`, `arena`, `pass_gate`, `settle_finalize` green; ref green; size recorded.
- [ ] Step 4: Commit `feat(lean): profiles, joins, two-phase settle, refund, sweep`.

### Task 4: Pass collection, mint, reveal, entropy

**Files:** `programs/slana-lean/src/{core_asset.rs,core_cpi.rs}`, `src/instructions/{mint_pass,close_pass_mint,reveal_pass,capture_pass_entropy}.rs`.

- [ ] Step 1: Port the Core asset parser and the CreateV2 CPI (account order and data identical to the reference); SlotHashes lookup (minimal slot ≥ target, coverage check) with the reference's unit tests.
- [ ] Step 2: Implement the four instructions incl. R17 (supply immutable), R22/R23 order, `MintCounter`, per-wallet limit, min tokens, the `msg`-equivalent log line via `pinocchio-log`, and the `PassEntropyCaptured` event bytes.
- [ ] Step 3: `SLANA_IMPL=lean cargo test --test pass_mint` green (incl. the 512-entry CU test — report lean CU vs ref).
- [ ] Step 4: Commit `feat(lean): Pass mint, reveal and SlotHashes entropy`.

### Task 5: Seasons, full parity, size gate on

**Files:** `programs/slana-lean/src/instructions/{end_season,claim_season_reward,rollover_season}.rs`; CI.

- [ ] Step 1: Implement the three instructions (prize table, 30-day window, claimed mask, rollover).
- [ ] Step 2: Full suite green on both implementations; size gate green; remove `continue-on-error` from the lean CI job; add a CI step printing lean vs ref size and CU table.
- [ ] Step 3: If size > 71,000: apply spec §2.3 steps (a)–(c) only; if still over, STOP and report (do not change behaviour).
- [ ] Step 4: Commit `feat(lean): seasons; lean program passes the full suite under 71 KB`.

### Task 6: Lean as the deployed program; localnet e2e; deploy docs

**Files:** `scripts/localnet.sh`, `apps/server/scripts/e2e.ts` (only if paths change), `docs/DEPLOY.md`, `docs/ARCHITECTURE.md`, `README.md`, `Dockerfile`/CI as needed.

- [ ] Step 1: Localnet deploys `slana_lean.so` at the program id; run `scripts/localnet.sh` + server + `pnpm -F @slana/server e2e` → pass; record CU per tx vs the web limits (adjust limits only if a lean tx exceeds 50 % of its limit).
- [ ] Step 2: DEPLOY: build/deploy commands for the lean program (`cargo build-sbf …` + `solana program deploy target/deploy/slana_lean.so --program-id …`), IDL from the reference, new cost table (locked rent ≈ ◎0.5, temporary buffer ≈ ◎0.5).
- [ ] Step 3: Commit `chore: deploy the lean program; e2e and cost docs`.

## Phase B — English only

### Task 7: English core packages, server and program sources

**Files:** `packages/{shared,art,sdk}/**`, `apps/server/**`, `programs/**`, `scripts/**` — every file listed by `git grep -lP` with the guard's letter class outside `apps/web` and `docs`.

- [ ] Step 1: Translate comments, log/error strings, CLI help, bot names, emote/sticker labels, arena names (choose English names once in `packages/shared/src/arenas.ts`), art trait/palette labels; delete the Turkish chat-filter list (keep the English one).
- [ ] Step 2: Regenerate any byte-parity fixtures (Pass metadata) in the same commit; all tests green.
- [ ] Step 3: Commit `chore: English-only core packages, server and program`.

### Task 8: English-only web

**Files:** delete `apps/web/src/i18n/tr.ts`, `apps/web/src/ui/docs/content.tr.ts`; modify `apps/web/src/i18n/{index.ts,en.ts}`, settings (remove language option), every component with Turkish literals, design-system naming (the Turkish name → "Paper Ticket"), gallery, tests.

- [ ] Step 1: Single locale; `en-US` number formatting (compact `1.5K`); remove language UI/state/storage; keep `t()` keys.
- [ ] Step 2: Replace remaining Turkish literals in components/stamps; update tests (parity tests that compared TR/EN become single-table completeness tests).
- [ ] Step 3: Web typecheck/test/build green; Playwright shots of lobby, ticket sheet, game HUD, death, cash-out, Pass, leaderboard, profile, docs (desktop + mobile, paper + night) to the scratchpad; look at them.
- [ ] Step 4: Commit `feat(web): English-only interface`.

### Task 9: English docs, specs, screenshots, grep guard

**Files:** `README.md`, `docs/*.md`, `docs/superpowers/specs/2026-10-14-slana-design.md`, `docs/superpowers/plans/2026-10-14-slana-v2.md`, older specs/plans with Turkish, `docs/design/*.html`, `docs/images/*.webp`, `.github/workflows/ci.yml`.

- [ ] Step 1: Translate every remaining Turkish document faithfully (keep meaning and numbers; mark nothing as "translated").
- [ ] Step 2: Re-shoot `docs/images/*.webp` in English; README links valid.
- [ ] Step 3: CI step `git grep -nP` with the guard's letter class `-- ':!*.webp' ':!*.png' && exit 1 || true` (fails on any match); run it locally → clean.
- [ ] Step 4: Full verification (Global Constraints "Done means"); commit `docs: English-only documentation and guard`.
