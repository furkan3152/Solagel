import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SettleReason = 'cashout' | 'death' | 'afk' | 'crash' | 'stale' | 'maxage' | 'kicked';

export interface SettlementItem {
  kind: 'settle' | 'record';
  /** Unique key: the session PDA for settlements, `<wallet>:<n>` for records. */
  key: string;
  /** Wallet (base58). */
  player: string;
  arenaId?: number;
  session?: string;
  /** On-chain session id (settle only); guards against settling a re-joined session. */
  sessionId?: number;
  /** Lamports owed (settle only). */
  payout?: number;
  score: number;
  kills: number;
  xp: number;
  reason?: SettleReason;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
}

export interface LiveStake {
  roomId: string;
  session: string;
  sessionId: number;
  player: string;
  arenaId: number;
  value: number;
  score: number;
  kills: number;
}

interface JournalFile {
  version: 1;
  pending: SettlementItem[];
  live: LiveStake[];
  updatedAt: number;
}

/**
 * Crash-safe record of money the server owes. Every change is written with
 * write-to-temp + rename, so the file on disk is always a complete snapshot.
 *
 * Invariant: at any instant, Σ live values + Σ pending payouts (per arena)
 * equals what the arena vault owes, because value only leaves `live` in the
 * same write that adds the matching pending settlement.
 */
export class Journal {
  private pendingItems: SettlementItem[] = [];
  private liveByRoom = new Map<string, LiveStake[]>();

  constructor(
    private readonly path: string | null,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as JournalFile;
      if (data.version !== 1 || !Array.isArray(data.pending) || !Array.isArray(data.live)) throw new Error('bad journal shape');
      this.pendingItems = data.pending;
      for (const l of data.live) {
        const list = this.liveByRoom.get(l.roomId) ?? [];
        list.push(l);
        this.liveByRoom.set(l.roomId, list);
      }
    } catch (err) {
      const backup = `${this.path}.corrupt-${Date.now()}`;
      this.log(`!!! journal at ${this.path} is unreadable (${(err as Error).message}); moved to ${backup}. Manual review required.`);
      try {
        renameSync(this.path, backup);
      } catch {
        /* ignore */
      }
    }
  }

  get pending(): readonly SettlementItem[] {
    return this.pendingItems;
  }

  live(): LiveStake[] {
    return [...this.liveByRoom.values()].flat();
  }

  /**
   * Converts every player that was alive when the server stopped into a
   * settlement at their last snapshot value ("auto cash-out on crash").
   * Returns the number of recovered players.
   */
  recoverLive(now = Date.now()): number {
    const live = this.live();
    for (const l of live) {
      if (this.pendingItems.some((p) => p.key === l.session)) continue;
      this.pendingItems.push({
        kind: 'settle',
        key: l.session,
        player: l.player,
        arenaId: l.arenaId,
        session: l.session,
        sessionId: l.sessionId,
        payout: l.value,
        score: l.score,
        kills: l.kills,
        xp: 0,
        reason: 'crash',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      });
    }
    this.liveByRoom.clear();
    this.persist();
    return live.length;
  }

  /** Atomically enqueue settlements and replace a room's live snapshot. */
  commit(opts: { enqueue?: SettlementItem[]; roomId?: string; live?: LiveStake[] }): void {
    if (opts.enqueue) {
      for (const item of opts.enqueue) {
        if (!this.pendingItems.some((p) => p.key === item.key)) this.pendingItems.push(item);
      }
    }
    if (opts.roomId !== undefined && opts.live) {
      if (opts.live.length > 0) this.liveByRoom.set(opts.roomId, opts.live);
      else this.liveByRoom.delete(opts.roomId);
    }
    this.persist();
  }

  enqueue(item: SettlementItem): void {
    this.commit({ enqueue: [item] });
  }

  /** Marks an item as done (settled on-chain or no longer applicable). */
  remove(key: string): void {
    const before = this.pendingItems.length;
    this.pendingItems = this.pendingItems.filter((p) => p.key !== key);
    if (this.pendingItems.length !== before) this.persist();
  }

  /** Records a failed attempt with exponential backoff (max 5 minutes). */
  retryLater(key: string, error: string, now = Date.now()): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (!item) return;
    item.attempts++;
    item.lastError = error.slice(0, 300);
    item.nextAttemptAt = now + Math.min(300_000, 2000 * 2 ** Math.min(item.attempts, 8));
    this.persist();
  }

  private persist(): void {
    if (!this.path) return;
    const data: JournalFile = { version: 1, pending: this.pendingItems, live: this.live(), updatedAt: Date.now() };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }
}
