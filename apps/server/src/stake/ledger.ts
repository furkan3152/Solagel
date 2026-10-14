export interface ArenaEntry {
  pid: number;
  /** Wallet (base58). */
  player: string;
  /** Session PDA (base58). */
  session: string;
  /** On-chain session id (PDAs are reused across joins; the id is unique). */
  sessionId: number;
  arenaId: number;
  /** Entry fee paid for this session, raw token units. */
  entryFee: number;
  /** Current in-game value, raw token units. */
  value: number;
  /** On-chain session open time (unix seconds). */
  openedAt: number;
  /** The player held a Slana Pass when the session was opened. */
  hasPass: boolean;
}

/**
 * In-game value accounting for an arena room. Value moves between stakers
 * (`transfer`), leaves a staker as loot when a bot eats them (`spill`) and
 * comes back from loot (`credit`). The room keeps
 * Σ ledger + Σ loot on the floor == what the arena vault owes the room's players.
 */
export class ArenaLedger {
  private readonly entries = new Map<number, ArenaEntry>();

  join(entry: ArenaEntry): void {
    if (this.entries.has(entry.pid)) throw new Error(`pid ${entry.pid} already staked`);
    if (!Number.isSafeInteger(entry.value) || entry.value < 0) throw new Error('invalid stake value');
    this.entries.set(entry.pid, { ...entry });
  }

  has(pid: number): boolean {
    return this.entries.has(pid);
  }

  get(pid: number): ArenaEntry | undefined {
    return this.entries.get(pid);
  }

  value(pid: number): number {
    return this.entries.get(pid)?.value ?? 0;
  }

  /** The victim's share for an eaten cell: floor(V · m / M), everything for the last cell. */
  private share(from: ArenaEntry, massEaten: number, victimTotalBefore: number, last: boolean): number {
    let t: number;
    if (last) t = from.value;
    else if (!(victimTotalBefore > 0)) t = 0;
    else t = Math.floor(from.value * Math.min(1, Math.max(0, massEaten / victimTotalBefore)));
    return Number.isFinite(t) ? Math.max(0, Math.min(from.value, t)) : 0;
  }

  /**
   * Moves value from the victim to the eater proportionally to the eaten mass:
   * t = floor(V · m / M). The victim's last cell transfers everything.
   * Returns the amount moved.
   */
  transfer(fromPid: number, toPid: number, massEaten: number, victimTotalBefore: number, last: boolean): number {
    const from = this.entries.get(fromPid);
    const to = this.entries.get(toPid);
    if (!from || !to || from === to) return 0;
    const t = this.share(from, massEaten, victimTotalBefore, last);
    from.value -= t;
    to.value += t;
    return t;
  }

  /**
   * A bot ate (part of) a staker: removes the same share `transfer` would
   * move and returns it. The caller must put exactly that much on the floor as loot.
   */
  spill(victimPid: number, massEaten: number, victimTotalBefore: number, last: boolean): number {
    const from = this.entries.get(victimPid);
    if (!from) return 0;
    const t = this.share(from, massEaten, victimTotalBefore, last);
    from.value -= t;
    return t;
  }

  /** Adds picked-up loot. Returns false (nothing credited) for unknown players or invalid amounts. */
  credit(pid: number, amount: number): boolean {
    const e = this.entries.get(pid);
    if (!e || !Number.isSafeInteger(amount) || amount < 0) return false;
    e.value += amount;
    return true;
  }

  /** Removes a player and returns their final entry (value = payout owed). */
  leave(pid: number): ArenaEntry | undefined {
    const e = this.entries.get(pid);
    if (e) this.entries.delete(pid);
    return e;
  }

  total(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.value;
    return sum;
  }

  all(): ArenaEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
