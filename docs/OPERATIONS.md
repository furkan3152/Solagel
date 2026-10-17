# Slana: operations guide

What comes after the setup: the fee wallet, the loot burn, pausing, shutting an arena down, key rotation and the journal
backup. Setup: [DEPLOY.md](DEPLOY.md). Money flow and trust model: [ARCHITECTURE.md](ARCHITECTURE.md). Every command below
exists in `pnpm admin help`.

The commands take `--url`, `--keypair` (default `~/.config/solana/id.json`; it must be the admin wallet
`D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`, `SLANA_ADMIN` in `scripts/admin.env`) and `--program`; see
[DEPLOY.md](DEPLOY.md). Every admin command is run by this wallet; the server key is a separate hot key that only
settles sessions and burns floor loot. `pnpm admin` reads a keypair file only (no `usb://ledger`); the admin panel below signs with a browser wallet or a Ledger instead. Before and after every operation:

```bash
pnpm admin status
```

`status` prints: the admin and server keys (with their SOL balances), the token (`token: not set (run \`pnpm admin
set-token --mint <CA>\`; arenas open after it)` until it is set, then the mint, token program, decimals, symbol and
supply), the fee wallet, its token account and balance (and a warning when that account is missing), the fee and the
deposit, `paused`, the totals and the arenas (open tickets / cap, vault, enabled or not).

## Admin panel

`/admin` on the web app (not linked from the lobby) does every `pnpm admin` operation signed by the connected browser
wallet: Phantom, Solflare, or a Ledger through either. Connect the admin wallet; any other wallet sees the status
read-only. Each action opens a review sheet that lists every instruction to be signed (decoded values and every
account), then the wallet prompt; the result shows the signature with an explorer link and the status is re-read.

| Task | In `/admin` | CLI |
|---|---|---|
| Status | Status card (Refresh) | `pnpm admin status` |
| Pause / unpause | Pause | `update-config --paused true\|false` |
| Fee, settle fee, server key, fee wallet, admin transfer | Update config (warns when the server authority is not this server's key; an admin transfer needs an explicit acknowledgement) | `update-config ...` |
| Enable / disable an arena, entry fee, cap | Update arena | `update-arena ...` |
| Shut an arena down | Sweep arena (disabled and idle arenas only; acknowledgement required) | `sweep --id N --force` |
| Recreate the fee wallet's token account | Fee wallet token account → Recreate | `update-config --fee-wallet <same>` |

On mainnet a red banner stays at the top. The RPC, program id and cluster come from the game server's `/api/config`,
or from the web build's `VITE_RPC_URL`, `VITE_PROGRAM_ID` and `VITE_SOLANA_CLUSTER`.

## Monitoring

- `GET /api/health`: `ok`, uptime, players online, room count (the Docker health check uses it).
- `GET /api/rooms`: rooms, instances, human and bot counts, loot on the floor.
- `GET /api/pending?wallet=<address>`: the payouts the server is still sending for a wallet. The game of a player without
  a token account (or whose account refuses the payout) no longer waits (R24): the server settles it without the account,
  the session becomes `finalized` and the `owed` amount stays in the vault; the log says `finalized … (to collect)`. The
  player collects it with "Collect payout" on the web, with no waiting time. In the `status` output these sessions count
  as open (the vault cannot be swept).
- `GET /api/config`: `chain.tokenReady` is `false` until `set-token` has run, then `true` with the token's mint, symbol and
  decimals and the current `feeBps`. After `set-token` the server picks the token up within 30 s and logs
  `game token set — mint …`; no restart is needed. New arenas can take up to about 60 s to appear in `/api/rooms`.
- Server log lines starting with `!!!` need attention (e.g. an unreadable journal, an arena whose vault falls short, an
  unusable fee wallet token account). The server logs a warning when the server key drops below ◎0.05.

## The fee wallet

The whole fee of every settlement (5 % of profit by default, at most 10 %) is paid to one token account: a token
account of the game mint owned by `Config.fee_wallet`. By default the fee wallet is the admin wallet. There is no
treasury vault, no season pool and no on-chain burn split; what the fee wallet holds is yours, and tokens are burned
off-chain by hand (the plan is 75 % burned, 25 % kept).

- `pnpm admin set-token` creates the fee wallet's associated token account in the same transaction (the admin pays its
  rent). `pnpm admin update-config --fee-wallet <pubkey>` does the same for a new fee wallet, and `pnpm admin sweep`
  creates it if it is missing. `pnpm admin status` shows the account and its balance.
- **Never close the fee wallet's token account.** Settlement checks the account before every payout. If it is missing,
  owned by another program, of another mint, frozen or otherwise unusable, **every settlement is held**: players are not
  paid until it is fixed. The server logs this loudly, about once a minute:

  ```
  !!! chain: fee wallet token account <address> (fee wallet <wallet>) is <problem>: ALL settlements are held. Recreate it ...
  ```

  Nothing is lost and no player is blamed: the held items wait in the journal and go out by themselves (the log says
  `fee wallet token account … is usable again — settlements resume`) as soon as the account exists again. To recreate it,
  press "Recreate token account" in `/admin`, run `pnpm admin update-config --fee-wallet <the current fee wallet>` (it prepends the idempotent account creation), or
  `spl-token create-account <MINT> --owner <fee wallet> --fee-payer <keypair>` (add `--program-id` for a Token-2022 mint).
  The server never creates the account itself.
- **Do not add Token-2022 extensions to the fee wallet's token account** (for example a required memo, `MemoTransfer`).
  The fee is sent without a memo, so an account that demands one refuses it and settlements are held like above.
- Moving the tokens out is up to you: they are an ordinary balance of the fee wallet. Keep the token account open (it can
  stay at a balance of 0).
- A different fee wallet (`update-config --fee-wallet`) applies to settlements from then on, including tickets that are
  already open (the fee goes to whichever wallet is in the Config at settlement); the new wallet's token account is
  created in the same transaction.
- The fee wallet may play as an ordinary player. When its own token account is both the player's and the fee account, the
  server settles that ticket without the player's account (the amount is kept as `owed`) and the wallet collects it with
  "Collect payout".

## Arena rounds and the loot sweep

Paid arenas play wall-clock rounds: `ROUND_SECONDS` (default 300) and `ROUND_JOIN_CLOSE_SECONDS` (default 60, capped at half
a round) in the server environment. Round *n* covers `[n × ROUND_SECONDS, (n + 1) × ROUND_SECONDS)` of Unix time, so keep
the server clock synced (NTP). There is no cash-out: at the bell every live ticket is paid its value, and the loot left
on the floor is journaled as a `sweep` item (`sweep:<roomId>:<round>`) and sent with the server-signed program
instruction `sweep_loot(amount)`, which burns that amount from the arena vault (the token supply drops; the program
emits `LootBurned`).

- A sweep is journaled like a payout. After a crash it is resumed; it is resent only once its blockhash has provably
  expired, so it is never applied twice. It belongs to no wallet, so `GET /api/pending?wallet=` does not list it; the journal (`DATA_DIR/journal.json`, kind `sweep`) and the log do.
- `!!! chain: arena #N vault cannot cover the loot sweep ...` means the vault holds less than the journal says; the server
  retries with backoff. Do not force anything: check the arena with `pnpm admin status` first. `!!! chain: dropping
  malformed loot sweep` and `... without a recorded blockhash expiry; not resending` need a manual look at the journal.
- `sweep_loot` burns, and its only cap is the vault balance (the same trust as `settle_session`). The server computes the
  amount from the floor loot it holds; only the server key can send it. A leaked server key could therefore burn an
  arena's whole vault, including tickets that have not been played: **protect the server key** like the payout key it is
  (a separate hot key, minimal SOL, rotate it at once if it may have leaked, see below).
- A short `ROUND_SECONDS` is for demos and tests (`ROUND_SECONDS=90 pnpm demo`; the localnet e2e uses 30). Keep the
  default in production so players see the same 5-minute rounds the guide describes.

## Pausing and emergencies

| What | Command | Effect |
|---|---|---|
| Stop new tickets | `pnpm admin update-config --paused true` | `join_arena` is refused; payouts and refunds go on. To undo: `--paused false` |
| Close one arena | `pnpm admin update-arena --id N --enabled false` | no tickets can be bought for that arena; open tickets are played and close |
| Close the arenas on the server | `STAKE_ENABLED=false` in the server environment, restart | the arenas leave the lobby; the payout queue keeps running |
| Change the fee or the deposit | `pnpm admin update-config --fee-bps N --settle-fee-lamports N` | the fee rate and the deposit apply to tickets bought from now on (an open ticket keeps the rate of the moment it was bought: `Session.fee_bps`); the fee is at most 1000 (10 %) and the whole of it goes to the fee wallet |
| Change the fee wallet | `pnpm admin update-config --fee-wallet <pubkey>` | the new wallet's token account is created in the same transaction (admin pays); it must stay open, see "The fee wallet" |

On `SIGTERM`/`SIGINT` the server settles the players in the arenas at their current value (an operator exit, not a cash-out they chose) and saves its state; use it for restarts (Docker
`stop` sends SIGTERM).

### Shutting an arena down for good (sweep)

1. `pnpm admin update-arena --id N --enabled false`
2. Wait for the open tickets to close: `status` → `open 0/…`. Live tickets are paid at the next round bell (at most
   `ROUND_SECONDS`, 5 minutes by default); those that do not close can be refunded by the player after 24 hours. Settled sessions whose payout
   has not been collected (`finalized`) also count as open: `sweep` is refused (`ArenaHasOpenSessions`) until the player
   presses "Collect payout"; that amount belongs to the player, you have to wait.
3. Make sure no loot is left in that arena's rooms in `/api/rooms`, and that `GET /api/pending` / the server log shows no
   pending payout or loot sweep for that arena (the CLI cannot see the server's journal).
4. ```bash
   pnpm admin sweep --id N --force
   ```
   Without `--force` the command only prints the warning and stops. The whole vault moves to the fee wallet's token
   account (the command creates it if it is missing). `sweep_arena` only works on a disabled arena with no open tickets (the per-round `sweep_loot` is separate: it burns, see Arena rounds). Do not re-enable a swept
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

If the key leaked, first `pnpm admin update-config --paused true`, then step 3 right away: until it is replaced, the
old key can close open tickets with any amount that does not exceed the vault and burn up to a vault's balance with `sweep_loot`. For the admin key use
`update-config --admin <new>`; for the upgrade authority `solana program set-upgrade-authority`.

## Journal backup

Contents of `DATA_DIR`:

| File | Contents | If it is lost |
|---|---|---|
| `journal.json` | pending payouts, live values in the arenas, loot in the rooms | **owed payouts drop out of the queue** (players can only get their entry fee refunded after 24 hours); the stale-ticket sweeper stays off until `STALE_SWEEP_ACK=1` |
| `leaderboards.json` | the server's Today / All time tables | display only |
| `*.dev-fake.json` | `DEV_FAKE_CHAIN` files | nothing to do with real money |

- Whenever a payout is queued, and as values change at most once a second, the journal is **written to a temporary file
  and renamed**: the file on disk is a complete snapshot at every moment. Copy it regularly (e.g. once a minute, from a
  persistent volume) and keep the backups encrypted (they contain wallet addresses).
- An unreadable journal is moved aside as `journal.json.corrupt-<time>` and the server starts empty; a `!!!` warning
  appears in the log. Stop the server and put the last good backup back.
- **After a quarantine the stale-ticket sweeper is off (M9).** While a `journal.json.corrupt-*` file is in `DATA_DIR`, the
  server does not refund tickets that look unplayed from their entry fee: the lost journal may hold those tickets' real
  outcome (e.g. a winning round-end payout). Every 30 minutes the log says `!!! chain: stale-session sweeper is OFF`. Inspect the
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

> **Never `anchor deploy`.** It deploys `target/deploy/slana.so`, the 454,704-byte Anchor reference, instead of the lean
> program (39,032 bytes), and its rent would lock about ◎3.2. Upgrades always go through `scripts/deploy-lean.sh` (`solana program deploy target/deploy/slana_lean.so`).

The upgrade authority is the admin wallet: `deploy-lean.sh` moves it there after a deploy, so an upgrade is signed by the
admin (`--keypair <admin keypair> --upgrade-authority <admin keypair>`); it skips the move when the admin already is the
authority. Never pass `--final`: the program must stay upgradeable and closable.

Keep the account layout (state.rs) backward compatible; if the new `.so` is larger, first run
`solana program extend <PROGRAM_ID> <bytes>`. On mainnet, try the upgrade on devnet first; a multisig is optional later.

## Emergency stop / close

The program is deliberately kept upgradeable (never `--final`), so the admin wallet can stop or close it at any time.
Three steps, from gentle to final. Run every command with the admin wallet.

**(a) Instant pause.** Stops new tickets at once; payouts, refunds and collections keep working.

```bash
pnpm admin update-config --paused true --keypair <admin keypair>     # undo: --paused false
```

**(b) Optional graceful wind-down.** Do this when there is time, so no player or token is stranded:

1. Pause (a) and set `STAKE_ENABLED=false` on the server, so the arenas leave the lobby.
2. Disable the arenas (`pnpm admin update-arena --id N --enabled false`) and let the open sessions settle. Players
   collect their payouts and, after 24 hours, refund any ticket that did not settle. `pnpm admin status` must show
   `open 0` for every arena.
3. Sweep each idle arena into the fee wallet: `pnpm admin sweep --id N --force`.
4. Move the fee wallet's tokens wherever you want them (they are an ordinary balance of that wallet).

**(c) Instant close.** Irreversible.

```bash
scripts/close-program.sh <cluster-url> <admin-keypair>          # prints the state, asks you to type the program id
scripts/close-program.sh <cluster-url> <admin-keypair> --force  # no confirmation
```

The script prints the on-chain state first (`pnpm admin status`: the paused flag, each arena's open sessions and vault,
the fee wallet and its token account), then a warning, then runs `solana program close <PROGRAM_ID>
--bypass-warning --recipient <admin> --keypair <admin>` and prints the reclaimed SOL (about 0.2729 SOL of ProgramData
rent).

> **Warning.** Once the program is closed, every token left in a program-owned vault (the arenas) is
> **permanently inaccessible**, open sessions can no longer settle or refund, and nothing can be recovered. A closed
> program id can **never be reused**: redeploying means a new program id, a new Config and a new token setup (`init`, then `set-token` again). This is also
> the only way out of a wrong `set-token`: the token can be set once and never changed. Prefer (a) and (b) unless it is a
> real emergency.
