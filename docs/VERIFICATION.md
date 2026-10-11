# SOL beta and admin verification — 2026-10-11

The verified flow is: English lobby → wallet / SOL ticket → durable arena admission → on-chain activation → continuous gameplay → session-specific cash-out receipt.

## Automated checks

| Boundary | Result |
| --- | --- |
| Shared rules and protocol | 23 tests passed |
| Solana SDK, generated account/instruction IDL and deployment budget | 36 tests passed |
| Server, admin authorization, asset validation, admission, bots and settlement | 225 tests passed |
| Browser client, admin actions/network/recovery and wallet outcomes | 68 tests passed |
| TypeScript across the workspace | Passed |
| Server and web production builds | Passed |
| Anchor reference and compact SBF builds | Passed; compact artifact 91,208 bytes |
| Rust unit tests + LiteSVM transaction tests | 54 passed (18 host + 30 integration + 6 differential) |
| Rust formatting and all-target Clippy with warnings denied | Passed |

The SDK IDL was regenerated from the actual Anchor build. WebSocket protocol v2 requires old clients to refresh.

## Compact program and budget

The deployment target is `target/deploy/solagel_compact.so`, **91,208 bytes**, SHA-256 `1cf345b9523bbb719b853e918ec995c144f75fd4870cc7aa5b61281055383de5`. The Anchor reference remains **436,328 bytes** and supplies the IDL and comparison executable. The UI and game rules were not changed by this size reduction.

`corepack pnpm program:test` passed as a complete build/test command. It builds both programs, runs seven compact host tests, then runs 47 reference-host/compact-SBF/differential tests. Six differential tests run both executables in deterministic LiteSVM fixtures and compare success/failure, persisted account bytes, lamports, events and rollback. Coverage includes all 17 instructions, all skin thresholds, malformed argument tags/UTF-8, authority rotation, season rewards/rollover, extended accounts, allowed treasury aliases and session activation/refund/settlement. Ten additional security regressions cover forged ProgramData/owners/discriminators/PDAs, missing permissions, substituted system programs, prefunded accounts, stale seasons, runtime rent changes and atomic failure after transfers.

Two deliberate failure improvements have narrow differential assertions: an impossible `u32::MAX` name-length prefix returns decode error 102 instead of exhausting the reference heap; advancing an exhausted `u32::MAX` season returns arithmetic error 6022 instead of a reference seed-expression panic. Both reject the entire transaction, emit no event and preserve balances/accounts. Normal tested outcomes remain strict comparisons. These tests do not claim exhaustive error-precedence equality for every combination of simultaneous invalid inputs.

Compact host tests additionally check exact basis-point arithmetic against wide-integer reference values (including overflow), skin thresholds against integer square roots, fixed System Program instruction encodings against Solana's SDK, and Borsh decoding cases. Safe account guards, runtime rent and checked money arithmetic remain enabled. The build script rejects SBF stack overflow diagnostics.

A live mainnet rent quote totals **0.476239840 SOL** for Program, ProgramData, Config, first season and three arenas. Adding **0.020000000 SOL** for fees/initial server operation yields **0.496239840 SOL**, below the owner's 0.5 SOL initial ceiling. The [budget record](program-budget.json) includes the artifact hash and RPC timestamp. This is a current estimate; recheck the final binary and transaction fees before signing. Hosting, prize funding, players' accounts and later asset launches are separate. No mainnet transaction was sent.

## Browser checks

Chromium exercised the SOL-first lobby, Practice, friends' rooms, skin collection previews, settings, dark theme, how-to and mobile gameplay against the local server. There were no page errors. Existing Turkish preferences migrated to English, NFT previews offered no payment/mint button, and 320px / 390px layouts had no horizontal overflow. Screenshots are in `docs/images`.

With no chain configured, the UI correctly reports paid entry unavailable and keeps practice playable. The lobby retains the original canvas character artwork, pastel palette and purple outlines.

## Admin control room verification

A production-build Chromium smoke test used an unfunded ephemeral Solana wallet and real Ed25519 signatures against the running HTTP server. It verified unauthorized access rejection, dedicated admin login, durable settings saves, new-entry pause reaching the lobby, disabled practice entry while paused, staged Base/ERC-721 cosmetic mappings saved without public ownership unlock, retained drafts across tabs, audit visibility and wallet logout. All six admin sections fit a 320px viewport; desktop and 390px screenshots are in `docs/images/admin-desktop.jpg` and `admin-mobile.jpg`. No page errors occurred.

Reproduce after `corepack pnpm build` with `corepack pnpm -F @solagel/web smoke:admin`. The script starts an isolated server with temporary data, registers a test wallet, and deletes its temporary settings afterward. It never signs a blockchain transaction.

Automated tests additionally cover dedicated nonce replay/expiry and deployment-bound bearers, current-role revocation and RPC failure, atomic settings persistence and revision conflicts, network/program-bound settings, exact SPL/Token-2022 mint parsing, NFT chain/standard/asset validation, queued-liability preservation, runtime pause during admission, and live capacity changes without ejecting existing players. Admin instruction tests use actual SDK instruction layouts and verify amounts/destinations, fee caps, authority, immutable entry prices, empty-vault sweep and the rollover window. Network tests reject a wrong-cluster RPC override or missing executable program. Canonical public-network genesis hashes were checked against read-only RPC responses. Pending admin signatures are stored separately from credentials and restored across same-tab reload/sign-out to prevent accidental repeat funding.

Token launch announcements preserve SOL entry/payout units. Staged NFT identifiers never imply ownership or unlock a skin. The compact deployment program preserves the established SOL beta ABI and SDK IDL; executable comparisons below verify the tested account and payment behavior.

## Financial regressions covered

- A ticket is durably reserved before activation, then confirmed before cells spawn.
- Duplicate wallet joins, simultaneous first joins, capacity races and canceled activations cannot create two funded lives.
- Paid bots cannot consume humans or receive/cash out SOL; bot mass does not mint monetary value.
- An activated ticket cannot claim the original-buy-in timeout refund after transferring value.
- Partial-cell transfers preserve total funded value and persist before resulting frames are published.
- Journal corruption or write failure stops financial gameplay; records are retained for recovery.
- Reconnect waits for authentication, reclaims the exact paid session and rejects old-life receipts.
- Confirmed receipts persist and replay when their wallet reconnects.
- A submitted wallet transaction with unknown confirmation is shown as uncertain with its explorer link.
- Practice and zero-profit bot/food farming earn no prize-bearing season points. Paid points use `floor(max(payout − buyIn, 0) / 1000)` lamports.

## Signed localnet flow

A fresh throwaway wallet completed the final **91,208-byte compact SBF** program's paid flow on a local validator in 8.5 seconds: registered a profile, bought a 0.01 SOL ticket, signed server authentication, joined after confirmed on-chain activation, and cashed out. The receipt matched the exact session and arena; the session account closed. The wallet received 0.01158688 SOL: 0.01 SOL payout plus 0.00158688 SOL returned session rent. The zero-profit game earned XP but no season points or prize rank. No public-network funds were involved.

Reproduce with `scripts/localnet.sh`, a server configured from `.localnet/server.env`, and `corepack pnpm -F @solagel/server e2e`. The compact run used isolated `.localnet-compact` state on RPC port 8909 and game port 8797; the validator used its own test rent schedule, independently of the mainnet budget quote.

## Admin wallet configuration

The designated wallet `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm` is the default off-chain administrator. Six configuration tests verify its canonical public-key encoding, explicit list overrides, explicit-empty disabling, and unchanged on-chain signer/program settings. This configuration does not assign a deployed program authority.

## Scope

These checks do not constitute an independent security audit. No mainnet deployment, production funds transfer, pump.fun token creation or OpenSea mint was performed. NFT ownership verification and SPL-token economics remain future work after real asset identifiers and launch rules exist. The `Session.activated` ABI change requires draining old sessions and deploying matching program, SDK, server and client versions; see `DEPLOY.md`.
