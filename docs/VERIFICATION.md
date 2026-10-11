# SOL beta verification — 2026-10-11

The verified flow is: English lobby → wallet / SOL ticket → durable arena admission → on-chain activation → continuous gameplay → session-specific cash-out receipt.

## Automated checks

| Boundary | Result |
| --- | --- |
| Shared rules and protocol | 21 tests passed |
| Solana SDK and generated account/instruction IDL | 32 tests passed |
| Server, admission races, bots, journal and settlement | 94 tests passed |
| Browser client reconnect, receipt identity and wallet transaction outcomes | 21 tests passed |
| TypeScript across the workspace | Passed |
| Server and web production builds | Passed |
| Anchor SBF program build | Passed |
| Rust unit tests + LiteSVM transaction tests | 31 passed (11 unit + 20 integration) |
| Rust formatting and all-target Clippy with warnings denied | Passed |

The SDK IDL was regenerated from the actual Anchor build. WebSocket protocol v2 requires old clients to refresh.

## Browser checks

Chromium exercised the SOL-first lobby, Practice, friends' rooms, skin collection previews, settings, dark theme, how-to and mobile gameplay against the local server. There were no page errors. Existing Turkish preferences migrated to English, NFT previews offered no payment/mint button, and 320px / 390px layouts had no horizontal overflow. Screenshots are in `docs/images`.

With no chain configured, the UI correctly reports paid entry unavailable and keeps practice playable. The lobby retains the original canvas character artwork, pastel palette and purple outlines.

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

A fresh throwaway wallet completed the final SBF program's paid flow on a local validator in 8.5 seconds: registered a profile, bought a 0.01 SOL ticket, signed server authentication, joined after confirmed on-chain activation, and cashed out. The receipt matched the exact session and arena; the session account closed. The wallet received 0.01158688 SOL: 0.01 SOL payout plus 0.00158688 SOL returned session rent. The zero-profit game earned XP but no season points or prize rank. No public-network funds were involved.

Reproduce with `scripts/localnet.sh`, a server configured from `.localnet/server.env`, and `corepack pnpm -F @solagel/server e2e`.

## Scope

These checks do not constitute an independent security audit. No mainnet deployment, production funds transfer, pump.fun token creation or OpenSea mint was performed. NFT ownership verification and SPL-token economics remain future work after real asset identifiers and launch rules exist. The `Session.activated` ABI change requires draining old sessions and deploying matching program, SDK, server and client versions; see `DEPLOY.md`.
