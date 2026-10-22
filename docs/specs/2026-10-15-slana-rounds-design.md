# Slana: timed rounds for paid arenas

Status: decided (2026-10-15). Replaces "cash out anytime" in paid arenas. Practice is unchanged.

## Decisions

| Question | Decision |
|---|---|
| Cash-out in paid arenas | Removed. Nobody leaves with money before the round ends. |
| Payout at round end | Everyone alive keeps their till: payout = current value, fee on profit only (5 %, 2 % with a Pass, the fee snapshot taken at join, R19). Eaten players get 0 for that ticket. |
| Round length | 5 minutes. |
| Late join / re-entry | Anyone can join a running round at the same entry fee; a player who was eaten may buy a new ticket and re-enter the same round. Joins close in the last 60 s. |
| Loot still on the floor at round end | Moves to the current season pool. |

## Round clock

- Rounds are wall-clock aligned: round *n* runs `[n·300 s, (n+1)·300 s)` of Unix time, identical for every arena and every instance, so "the game ends at the same moment" for everyone. A new round opens the instant the previous one ends (no intermission; the results screen is client-side).
- `joinsCloseAt = endsAt − 60 s`. From then until `endsAt` the server refuses new arena joins with `round_closed` + `opensAt` (= `endsAt`).
- A ticket bought while joins are closed is not lost: the on-chain session stays open and the client holds it ("Ticket held — next round in 0:41") and joins automatically when the next round opens. The stale-session refund window (hours) is far longer than 60 s.
- Values live in `packages/shared` `RULES.roundMs = 300_000`, `RULES.roundJoinCloseMs = 60_000`. The server reads `ROUND_SECONDS` / `ROUND_JOIN_CLOSE_SECONDS` (tests, localnet e2e, demo recording); production uses the defaults.

## Server

- `cashout` messages in arena rooms are rejected (`error: no_cashout`); the AFK grace no longer cashes a staker out: AFK cells stay in the arena until eaten or until the round ends. Admin kick and server shutdown still settle at the current value (operator exits, not player exits).
- At `endsAt` each arena room, in one tick: settles every live staker (connected or AFK) at their value with reason `round`; collects the value of all floor loot, clears it, and enqueues one `sweep` journal item `{ arenaId, roomId, amount, round }` in the same atomic journal write (so Σ live + Σ loot + Σ pending is preserved); sends every human `{ t: 'roundOver', round, payout, stats, standings }` (top 10 by value at the bell); resets the world for the next round (bots keep playing).
- Players who were eaten are back in the lobby (death sheet → "Buy back in" while joins are open).
- Room listings and `joined` carry `round: { n, endsAt, joinsCloseAt }`; `welcome`/`pong` carry `serverNow` so clients can correct clock skew.
- The chain worker executes `sweep` items with the new program instruction `sweep_loot` (below); the dev fake chain adds the amount to its season pool. Sweep items retry like settlements and are idempotent by key `sweep:<roomId>:<round>`.

## Program: `sweep_loot(amount: u64)`

The existing `sweep_arena` is admin-only and needs a disabled arena with no open sessions, so it cannot run every 5 minutes. New instruction, in both `slana-ref` (IDL source) and `slana-lean` (deployed):

- Accounts: `server` (signer, `== config.server_authority`), `config`, `arena`, `vault` (arena PDA vault, mut), `season` (current, mut), `season_vault` (mut), `token_mint`, `token_program`, with the same checks as `sweep_arena` except the signer.
- `require!(amount <= vault.amount)` (`InsufficientPot`), `amount == 0` is a no-op that still succeeds; transfers `vault → season_vault`, `season.pool += amount`, emits `LootSwept { arena_id, season_id, amount }`.
- Trust model: the same as `settle_session`, where the server already chooses each payout up to the vault balance. No new authority is created.
- Lean `.so` stays under the 71,000-byte gate; tests run on both implementations.

## Web

- HUD: round chip with `m:ss` remaining; at `joinsCloseAt` it turns to "Final minute"; last 10 s a large countdown. No cash-out button or key in arenas (practice keeps its exit).
- Round end: the world freezes, a bell, then the receipt sheet ("Round over"): your till, fee, paid, your place, the room's top 5; actions "Next round" (buy a ticket) and "Lobby".
- Lobby tickets: each arena shows "Round ends in 3:12" or "Joins closed · next round in 0:42"; buying in the closed window shows the held-ticket state and auto-joins.
- Death sheet in arenas: "Buy back in · ◎fee" while joins are open, else "Next round in m:ss".
- Sound: soft tick each second in the last 10 s, a bell at round end; announcer lines "One minute left.", "Ten seconds.", "Round over." (existing cooldown rules).
- Guide, facts, docs and README describe rounds; every "cash out anytime" copy is removed.

## Testing

Program: `sweep_loot` happy path, over-vault amount, wrong signer, zero amount, on both impls. Server: round clock math, join refusal window, cash-out rejected, AFK not settled, round-end settlement of live + AFK stakers, loot sweep conserves value (conservation test), journal recovery of sweep items, fake chain pool increase. Web: RTL for the round chip states, results sheet, lobby states, held ticket. Localnet e2e with `ROUND_SECONDS=30`.
