export interface StakeEntry {
  pid: number;
  /** Wallet (base58). */
  player: string;
  /** Session PDA (base58). */
  session: string;
  /** On-chain session id (PDAs are reused across joins; the id is unique). */
  sessionId: number;
  arenaId: number;
  buyIn: number;
  /** Current in-game value in lamports. */
  value: number;
  /** On-chain session open time (unix seconds). */
  openedAt: number;
  kills: number;
}

/**
 * In-game value accounting for a stake room. Value only moves between players
 * (never created or destroyed), so the sum always equals the lamports the
 * arena vault owes to the players currently in the room.
 */
export class StakeLedger {
  private readonly entries = new Map<number, StakeEntry>();

  join(entry: StakeEntry): void {
    if (this.entries.has(entry.pid)) throw new Error(`pid ${entry.pid} already staked`);
    if (!Number.isSafeInteger(entry.value) || entry.value < 0) throw new Error('invalid stake value');
    if (this.all().some((e) => e.session === entry.session || e.player === entry.player)) throw new Error('session already staked');
    if (!Number.isSafeInteger(this.total() + entry.value)) throw new Error('stake total exceeds safe accounting range');
    this.entries.set(entry.pid, { ...entry });
  }

  has(pid: number): boolean {
    return this.entries.has(pid);
  }

  get(pid: number): StakeEntry | undefined {
    return this.entries.get(pid);
  }

  value(pid: number): number {
    return this.entries.get(pid)?.value ?? 0;
  }

  /**
   * Moves value from the victim to the eater proportionally to the eaten mass:
   * t = floor(V · m / M). The victim's last cell transfers everything.
   * Returns the lamports moved.
   */
  transfer(fromPid: number, toPid: number, massEaten: number, victimTotalBefore: number, last: boolean): number {
    const from = this.entries.get(fromPid);
    const to = this.entries.get(toPid);
    if (!from || !to || from === to) return 0;
    if (!Number.isFinite(massEaten) || !Number.isFinite(victimTotalBefore) || massEaten <= 0 || victimTotalBefore <= 0) return 0;
    let t: number;
    if (last || victimTotalBefore <= 0) {
      t = last ? from.value : 0;
    } else {
      const ratio = Math.min(1, Math.max(0, massEaten / victimTotalBefore));
      t = Math.floor(from.value * ratio);
    }
    t = Math.max(0, Math.min(from.value, t));
    from.value -= t;
    to.value += t;
    return t;
  }

  /** Removes a player and returns their final entry (value = payout owed). */
  leave(pid: number): StakeEntry | undefined {
    const e = this.entries.get(pid);
    if (e) this.entries.delete(pid);
    return e;
  }

  total(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.value;
    return sum;
  }

  all(): StakeEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
