# Slana v3: lean on-chain program (≤ 0.5 SOL rent) and an English-only project

Status: draft for review · Date: 2026-10-15 · Supersedes nothing; amends the v2 design of 2026-10-14 (since replaced by `2026-10-16-slana-simple-design.md`).

## 1. Goals

1. **Program rent ≤ 0.5 SOL, function unchanged.** The deployed `slana` program today is 676,696 bytes ≈ ◎4.71 locked rent (measured; an Anchor build with `opt-level="z"`, `strip`, `no-log-ix-name` still yields 524,528 bytes ≈ ◎3.65). The ProgramData rent is `(len + 45 + 128) × 6960` lamports, so **≤ 0.5 SOL ⇔ `.so` ≤ 71,665 bytes**. Target ≤ 70,000 bytes (≈ ◎0.49), hard CI gate at 71,000.
2. **English only.** Every user-facing string, doc, spec, plan, code comment, test name, log line, commit message and asset label is English. The Turkish UI language is removed (single locale).

Non-goals: new features, economy changes, changing any rule decided in v2 (R1–R24).

## 2. Approach: Pinocchio program behind an Anchor-compatible interface

Anchor itself is the size problem (macro-generated validation, Borsh, `core::fmt`, IDL plumbing). The program is rewritten with **Pinocchio** (`no_std`, zero-copy, no allocator). To keep every off-chain consumer unchanged, the new program is **wire-compatible with the current Anchor program**:

| Surface | Kept identical |
|---|---|
| Instruction data | 8-byte Anchor discriminator (`sha256("global:<name>")[..8]`) + Borsh-encoded args, same arg order and types |
| Accounts list | same accounts, same order, same signer/writable flags, optional accounts encoded the Anchor way (program id as the "None" placeholder) |
| Account data | 8-byte Anchor account discriminator + the exact Borsh layout and `space` of today's `#[account]` structs |
| PDAs | same seeds and bumps |
| Errors | same `SlanaError` codes (6000+, append-only) and the Anchor built-in codes that clients rely on: 2003, 2006, 2012/2014/2015 (token constraints), 3007, 3012 — plus any other code a test or client asserts |
| Events | same Anchor event encoding (`sol_log_data` of discriminator + Borsh) and the readable `Pass entropy: slot … hash …` log line |

### 2.1 Two crates

- `programs/slana-interface` — an **Anchor crate that is never deployed**. It holds the instruction signatures, account structs, `#[derive(Accounts)]` contexts (for client metas), errors and events, with `unimplemented!()`-free stub handlers. `anchor build` of this crate produces the IDL and TS types exactly as today, so `packages/sdk` (Anchor TS client), the server and the web need **no protocol change**. The IDL drift check in CI stays.
- `programs/slana` — the **deployed Pinocchio program**: manual account validation, manual Borsh read/write at fixed offsets, Pinocchio CPI to System, SPL Token / Token-2022 (`transfer_checked`, `burn`), Associated Token Account (where used), and the existing hand-written Metaplex Core CPI. SHA-256 via the `sol_sha256` syscall. No `format!`, no `alloc`, no floats; logging only through `pinocchio-log` where a log is part of the contract.

### 2.2 Conformance = the existing test suite

The 89 LiteSVM tests move to target the Pinocchio `.so` while building instructions and decoding accounts with `slana-interface` (dev-dependency only, so it never touches the deployed binary). Passing them unchanged (except imports) is the definition of "function preserved". Added:
- a **golden layout test**: every account type round-trips through the interface's `AccountDeserialize` after being written by the program;
- a **discriminator/error table test** comparing the program's constants with the interface's;
- the **size gate** (`.so` ≤ 71,000 bytes) in `cargo test` and CI;
- the localnet e2e (`apps/server/scripts/e2e.ts`) run once at the end against the Pinocchio build.

### 2.3 Size budget and fallbacks

Budget by area (rough): entrypoint/dispatch + validation helpers 10 KB, token CPI 8 KB, Core CPI 6 KB, arenas/sessions/settle/refund 18 KB, Pass mint/reveal/entropy 10 KB, seasons/claim/rollover 10 KB, config/admin 6 KB → ≈ 68 KB. If the first full build exceeds the budget, apply in order: (a) share one validation/serialization routine across instructions; (b) drop non-contract logs; (c) merge rarely used admin instructions behind one discriminator-dispatched `update_*` path **only if** the interface can keep the same IDL; (d) stop and ask the user before touching any behaviour (e.g. the 20-entry on-chain season table).

## 3. English-only project

- Remove `apps/web/src/i18n/tr.ts`, the language switch and `lang` setting; `en.ts` becomes the only table (keys kept). Locale-aware number formatting uses `en-US` (`1,234`, compact `1.5K`).
- Rename Turkish product terms: design system (Turkish name) → **"Paper Ticket"**; arena names (e.g. the Turkish name of Penny Pond) → English names chosen once in `packages/shared/src/arenas.ts`; stamps/labels (the Turkish forms of "EATEN", "PAID", "Under maintenance", "Complete the reveal", …) → English equivalents already present in `en.ts`.
- Translate all docs: README, `docs/*.md`, in-app docs content (drop `content.tr.ts`), the v2 spec and v2 plan, the new v3 plan, PASS-ART, OPERATIONS, DEPLOY (DEPLOY was Turkish).
- Code: comments, test names, log/error strings, bot names, chat filter word lists (keep an English list; the Turkish profanity list is removed), sticker/emote labels, art trait names (`traits.ts`, `palette.ts`), CLI help text, `localnet.sh`.
- Pass NFT metadata (names, trait values, descriptions) is English. Because traits are derived, renaming trait **labels** does not change which Pass gets which trait; byte-parity tests are regenerated in the same commit.
- Screenshots in `docs/images` are re-shot in English.
- A CI grep guard fails on Turkish-specific letters (`[\x{e7}\x{11f}\x{131}\x{f6}\x{15f}\x{fc}\x{c7}\x{11e}\x{130}\x{d6}\x{15e}\x{dc}]`) with no exceptions.

## 4. Risks

- **Behavioural drift in the rewrite** — mitigated by the unchanged test suite + layout/error tables + e2e.
- **Anchor built-in error codes** — only the codes clients depend on are reproduced; tests asserting other built-ins are reviewed one by one and the code chosen is recorded.
- **Budget miss** — fallback ladder in §2.3, user asked before any behavioural trade-off.
- **Security** — manual validation is where Pinocchio programs go wrong; a dedicated security review checks every account's owner/signer/writable/PDA/discriminator check against the Anchor constraint it replaces.

## 5. Deliverables

1. `programs/slana-interface` (Anchor, IDL source) and `programs/slana` (Pinocchio, deployed), all tests green against the Pinocchio `.so`, size ≤ 71,000 bytes, DEPLOY costs updated (≈ ◎0.5 locked, ≈ ◎1.0 during deploy).
2. English-only repository and UI, screenshots refreshed, grep guard in CI.
3. Localnet e2e passing on the final build.
