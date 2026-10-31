import type { SettleReason, SettlementItem } from '../stake/journal';
import type { ArenaEntry } from '../stake/ledger';

/**
 * The seam for staked bots (testnet only; see the 2026-10-31 spec, section 2).
 *
 * A zero-value bot (every network, every practice room) carries no value: eating it gives mass
 * only, and when it eats a staker the staker's share spills as floor loot.
 *
 * A staked bot is a bot with its own wallet and a real arena ticket. Inside the room it is a
 * staker like any player: it sits in the arena ledger, value moves to and from it exactly like a
 * player's (`ArenaLedger.transfer`), it is journaled as a live stake, and at its death, at the
 * bell (or at a server stop) the room queues its settlement in the same journal as everyone else
 * (the chain worker settles it on chain). Bots never take a seat a human needs: staked bots
 * count towards the room's bot cap but are never sent home to make room (they hold a ticket);
 * zero-value bots go first, and bots never block a join.
 *
 * The room does the in-game part (`Room.seatStakedBot`, the settlements). The chain part — bot
 * wallets derived from the server key and kept in `DATA_DIR`, funding them with `tELYMUM` and gas,
 * buying the ticket with `join` — lives behind this interface and is plugged in through
 * `RoomDeps.stakedBots`. Without a source (mainnet, tests) arenas field zero-value bots only.
 */
export interface StakedBotSource {
  /**
   * How many staked bots this arena should field right now. 0 on any non-testnet chain, when the
   * chain is off or when the admin set none (`BotSettings.testnet`, see `BotSettingsStore.stakedWanted`).
   */
  wanted(arenaId: number): number;
  /**
   * Buys a ticket for a free bot wallet in this arena (on-chain `join`) and resolves with it, or
   * null when that is not possible now (no free wallet, bankroll empty, chain error). The room
   * calls it at most once at a time per room and seats the ticket with `Room.seatStakedBot`.
   */
  acquire(arenaId: number, roomId: string): Promise<StakedBotTicket | null>;
  /**
   * The bot's ticket finished: its settlement (`item`, already in the journal) is queued. The
   * wallet may buy a new ticket after the chain worker confirms it.
   */
  released(ticket: StakedBotTicket, reason: SettleReason, item: SettlementItem): void;
}

/** A bought arena ticket for a bot wallet: the same fields a human's ticket brings (`JoinOptions.stake`). */
export interface StakedBotTicket {
  /** `stake.player` is the bot wallet (EIP-55); `stake.value` starts at the entry fee, like a player's. */
  stake: Omit<ArenaEntry, 'pid'>;
  /** Optional display name (else the room picks a natural one). */
  name?: string;
}
