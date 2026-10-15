# Slana: operations guide

What comes after the setup: the season cycle, the Pass reveal, the treasury, pausing, shutting an arena down, key
rotation and the journal backup. Setup: [DEPLOY.md](DEPLOY.md). Money flow and trust model:
[ARCHITECTURE.md](ARCHITECTURE.md). Every command below exists in `pnpm admin help`.

The commands take `--url`, `--keypair` (default `~/.config/solana/id.json`, i.e. the admin) and `--program`; see
[DEPLOY.md](DEPLOY.md). Before and after every operation:

```bash
pnpm admin status
```

`status` prints: the admin and server keys (with their SOL balances), the token mint and its supply, the fee and the split,
the deposit, the current season, `paused`, the totals, the treasury and season vault balances, the arenas (open tickets /
cap, vault, enabled or not), the season's top 10 and its pool, the previous season's frozen pool, its unclaimed part and
the claim mask, the Pass collection, the base URI, minted / supply, the supply lock, the mint state, the seed hash, the
entropy (target slot or captured hash) and the reveal (the admin seed and the final seed the traits derive from).

## Monitoring

- `GET /api/health`: `ok`, uptime, players online, room count (the Docker health check uses it).
- `GET /api/rooms`: rooms, instances, human and bot counts, loot on the floor.
- `GET /api/pending?wallet=<address>`: the payouts the server is still sending for a wallet. The game of a player without
  a token account (or whose account refuses the payout) no longer waits (R24): the server settles it without the account,
  the session becomes `finalized` and the `owed` amount stays in the vault; the log says `finalized … (to collect)`. The
  player collects it with "Collect payout" on the web, with no waiting time. In the `status` output these sessions count
  as open (the vault cannot be swept).
- Server log lines starting with `!!!` need attention (e.g. an unreadable journal, an arena whose vault falls short). The
  server logs a warning when the server key drops below ◎0.05.

## Season cycle

A season has **no** fixed end time on-chain; the admin ends it. You announce the calendar (e.g. 30 days) to the players
yourself.

1. **While the season runs**, points come only from Pass tickets; the pool fills from the season share of the fees
   (default 30 %) and from swept arenas. `status` shows the pool and the top 10.
2. **End it:**
   ```bash
   pnpm admin end-season
   ```
   The current season's pool is frozen as `prize_pool` and the next season starts immediately. The admin pays the rent of
   the new Season account (≈◎0.0099).
3. **Claims:** the top 10 claim their prizes themselves from the Ranks page: 30 % / 20 % / 14 % / 10 % / 8 % / 6 % /
   4.5 % / 3 % / 2.5 % / 2 % of the frozen pool. The window is 30 days after the season ends (`CLAIM_WINDOW_SECS`).
4. **Rollover:** once the 30 days have passed, move what was not claimed (rounding remainders and empty ranks included) to
   the active season:
   ```bash
   pnpm admin rollover --season <N>
   ```
   The program refuses a rollover before the window closes (`ClaimWindowOpen`).

## Pass reveal

The reveal is the second half of the commit–reveal, and its order matters (ruling R23):

- Once the mint **is over** (`close-mint` or the last Pass minted) the mint **can never reopen**; there is no entropy
  target yet.
- `reveal` publishes the seed **in the open** on-chain (the program checks `sha256(seed) == pass_seed_hash`) and **only
  then** records the target slot: the current slot + `ENTROPY_DELAY_SLOTS` (150 slots ≈ 1 minute).
- Once the target has passed, `capture_pass_entropy`, which anyone can send, reads from the SlotHashes sysvar the hash of
  the slot produced at the target or in the first block after it, stores it as `pass_entropy`, computes the final seed
  `pass_final_seed = sha256(seed ‖ pass_entropy)` and completes the reveal. The traits of every Pass can be computed by
  anyone with `passTraits(pass_final_seed, n, pass_supply)`.

Because the seed is public before the target slot, everyone learns the result at the same moment; the admin has no
information advantage. The remaining risk (honestly): someone who dislikes the result can hope the window (≈512 slots)
passes without a capture, which moves the target to a new future slot. But anyone (Pass holders included) can capture at
any time; the game server and the web's Pass page capture too, so no single party controls the timing.

1. End the mint (if the supply is sold out, the program has already ended it):
   ```bash
   pnpm admin close-mint
   ```
   If no Pass was minted, the command only clears the flag (the mint can be reopened). Once minting has started,
   `update-config --mint-open false` is refused (`UseCloseMint`): only `close-mint` ends the mint.
2. Compare the seed file's hash with the one on-chain:
   ```bash
   pnpm admin pass-seed                       # prints the sha256 of keys/pass-seed.json
   pnpm admin status                          # the "seed hash" line
   ```
3. Reveal the seed (this also sets the target slot):
   ```bash
   pnpm admin reveal [--seed-file keys/pass-seed.json]
   ```
   The program checks that the mint is over and that `sha256(seed) == pass_seed_hash`; it stores the seed in the open and
   writes the target slot. The command prints the target slot. The Pass page shows "Waiting for the reveal to complete".
4. Complete the reveal: the game server sends `capture_pass_entropy` itself once the target slot has passed (it pays only
   the network fee and retries every 30 s on failure; the log says `chain: Pass entropy captured … final seed …`). On the
   web's Pass page any connected wallet can press "Complete the reveal". By hand:
   ```bash
   pnpm admin capture-entropy                 # any wallet can send it
   pnpm admin status                          # entropy, final seed
   ```
5. The game server reads the reveal from the chain (config cache 30 s), and `/pass/<n>.json` and `/pass/<n>.png` return
   the traits instead of the sealed content. Cache lifetimes: JSON 60 s while sealed, 1 hour after the reveal (no JSON
   caching at all if `PUBLIC_URL` is empty); PNG 300 s while sealed, 1 day after the reveal. Ask the marketplaces for a
   metadata refresh.
6. Optional: render the collection offline and archive it, or upload it to Arweave ([PASS-ART.md](PASS-ART.md)).

> **The supply is fixed.** The traits depend on `pass_supply` (the 1/1 placement and the de-duplication run over the
> whole collection). The program does not change the supply once the mint has opened (`SupplyLocked`); the CLI also
> refuses `update-config --supply` and `open-mint --supply` from then on. Set the supply before `open-mint`. Ending the
> mint early is fine: the supply stays the same and the numbers that were not minted are never minted.

## Treasury

The treasury share of the fees (default 50 %) builds up in the treasury vault (`status` → `vaults treasury`).

```bash
pnpm admin withdraw-treasury --amount <token> --to <owner wallet>
```

`--to` is a **wallet address** (not a token account): the payout goes to this wallet's associated token account; if the
account does not exist it is created in the same transaction (the admin pays its rent). The amount is written in whole
tokens and cannot exceed the vault.

## Pausing and emergencies

| What | Command | Effect |
|---|---|---|
| Stop new tickets | `pnpm admin update-config --paused true` | `join_arena` is refused; **payouts and refunds go on**. To undo: `--paused false` |
| Close one arena | `pnpm admin update-arena --id N --enabled false` | no tickets can be bought for that arena; open tickets are played and close |
| Close the arenas on the server | `STAKE_ENABLED=false` in the server environment, restart | the arenas leave the lobby; the payout queue keeps running |
| Change the fee or the deposit | `pnpm admin update-config --fee-bps N --pass-fee-bps N --split T/S/B --settle-fee-lamports N` | the fee rate and the deposit apply to tickets **bought from now on** (an open ticket keeps the rate of the moment it was bought: `Session.fee_bps`); the split applies to later payouts; the fee is at most 1000 (10 %) |
| Turn off the Pass power | `PASS_START_MASS_MUL=1` and `PASS_CASHOUT_MS=3000` on the server, restart | Pass tickets start and cash out like the others |

On `SIGTERM`/`SIGINT` the server cashes out the players in the arenas and saves its state; use it for restarts (Docker
`stop` sends SIGTERM).

### Shutting an arena down for good (sweep)

1. `pnpm admin update-arena --id N --enabled false`
2. Wait for the open tickets to close: `status` → `open 0/…`. The server cashes tickets out automatically within 6 hours
   at the latest; those that do not close can be refunded by the player after 24 hours. Settled sessions whose payout
   has not been collected (`finalized`) also count as open: `sweep` is refused (`ArenaHasOpenSessions`) until the player
   presses "Collect payout"; that amount belongs to the player, you have to wait.
3. Make sure no loot is left in that arena's rooms in `/api/rooms`, and that `GET /api/pending` / the server log shows no
   pending payout for that arena (the CLI cannot see the server's journal).
4. ```bash
   pnpm admin sweep --id N --force
   ```
   Without `--force` the command only prints the warning and stops. The whole vault moves to the current season's pool
   (it goes back to the players). The program only sweeps a disabled arena with no open tickets. Do not re-enable a swept
   arena: loot left in the server's journal is no longer in the vault. The server checks this too: when it binds an arena
   whose vault does not cover the journal's debt (loot + pending payouts + live tickets), it keeps the arena disabled and
   logs `!!! arena #N KEPT DISABLED`.

## Rotating the server key

Only `Config.server_authority` can sign payouts; the pending payouts in the journal are sent with the new key.

1. Generate and fund a new key:
   ```bash
   solana-keygen new -o keys/server-2.json --no-bip39-passphrase
   solana transfer $(solana-keygen pubkey keys/server-2.json) 0.5 --allow-unfunded-recipient
   ```
2. Stop the server (SIGTERM: players are cashed out, payouts stay in the journal).
3. Change it on-chain:
   ```bash
   pnpm admin update-config --server $(solana-keygen pubkey keys/server-2.json)
   ```
4. Start the server with the same `DATA_DIR` and `SERVER_KEYPAIR=keys/server-2.json`; the pending payouts are sent with
   the new key. As long as the key does not match, the server says "server key is not the program server authority",
   waits and retries.
5. Withdraw the SOL left on the old key and destroy the key.

If the key **leaked**, first `pnpm admin update-config --paused true`, then step 3 right away: until it is replaced, the
old key can close open tickets with any amount that does not exceed the vault. For the admin key use
`update-config --admin <new>`; for the upgrade authority `solana program set-upgrade-authority`.

## Journal backup

Contents of `DATA_DIR`:

| File | Contents | If it is lost |
|---|---|---|
| `journal.json` | pending payouts, live values in the arenas, loot in the rooms | **owed payouts drop out of the queue** (players can only get their entry fee refunded after 24 hours); the stale-ticket sweeper stays off until `STALE_SWEEP_ACK=1` |
| `leaderboards.json` | the server's Today / All time tables | display only |
| `pass/` | Pass PNG cache | regenerated |
| `*.dev-fake.json` | `DEV_FAKE_CHAIN` files | nothing to do with real money |

- Whenever a payout is queued, and as values change at most once a second, the journal is **written to a temporary file
  and renamed**: the file on disk is a complete snapshot at every moment. Copy it regularly (e.g. once a minute, from a
  persistent volume) and keep the backups encrypted (they contain wallet addresses).
- An unreadable journal is moved aside as `journal.json.corrupt-<time>` and the server starts empty; a `!!!` warning
  appears in the log. Stop the server and put the last good backup back.
- **After a quarantine the stale-ticket sweeper is off (M9).** While a `journal.json.corrupt-*` file is in `DATA_DIR`, the
  server does not refund tickets that look unplayed from their entry fee: the lost journal may hold those tickets' real
  outcome (e.g. a winning cash-out). Every 30 minutes the log says `!!! chain: stale-session sweeper is OFF`. Inspect the
  quarantined file, settle the owed payouts by hand (or put the good backup back), then restart with
  `STALE_SWEEP_ACK=1` or move the file out of `DATA_DIR`.
- Restore: stop the server, put the file in place as `DATA_DIR/journal.json`, start it. The records of tickets already
  paid or refunded drop out by themselves (session closed or `SessionMismatch`); live tickets from the old snapshot are
  cashed out automatically. An old backup can bring back loot collected after its date: use the newest backup you have.
- Never use the same `DATA_DIR` or the same `SERVER_KEYPAIR` on two servers at once.

## Program upgrade

```bash
anchor build --ignore-keys && pnpm -F @slana/sdk sync-idl && scripts/build-lean.sh && scripts/test-program.sh
scripts/deploy-lean.sh <cluster-url> target/deploy/slana-keypair.json   # with the upgrade authority
```

> **Never `anchor deploy`.** It deploys `target/deploy/slana.so`, the ~679 KB Anchor reference, instead of the lean
> program, and its rent would lock ≈ ◎4.7. Upgrades always go through `scripts/deploy-lean.sh` (`solana program deploy target/deploy/slana_lean.so`).

Keep the account layout (state.rs) backward compatible; if the new `.so` is larger, first run
`solana program extend <PROGRAM_ID> <bytes>`. On mainnet, do the upgrade through a multisig and try it on devnet first.
