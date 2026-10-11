import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  /** On-chain session id (settle only) — guards against settling a re-joined session. */
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
  /** Signed transaction recorded before broadcast, preserved across restarts. */
  submittedSignature?: string;
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

export interface SettlementReceipt {
  kind: 'settle';
  key: string;
  player: string;
  arenaId: number;
  sessionId: number;
  signature: string;
  /** Gross payout; the program deducts any profit fee. */
  payout: number;
  settledAt: number;
}

const MAX_COMPLETED_RECEIPTS = 1_000;

interface JournalFile {
  version: 1;
  pending: SettlementItem[];
  live: LiveStake[];
  /** Optional for journals created before reconnect receipt recovery existed. */
  completed?: SettlementReceipt[];
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
  private completed: SettlementReceipt[] = [];
  private persistenceFailure: Error | null = null;

  /** After any disk failure, recovery must precede further financial activity. */
  get healthy(): boolean { return this.persistenceFailure === null; }

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
      validateSnapshot(data.pending, data.live);
      validateReceipts(data.completed ?? []);
      this.pendingItems = data.pending;
      this.completed = (data.completed ?? []).slice(-MAX_COMPLETED_RECEIPTS);
      for (const l of data.live) {
        const list = this.liveByRoom.get(l.roomId) ?? [];
        list.push(l);
        this.liveByRoom.set(l.roomId, list);
      }
    } catch (err) {
      const message = `journal at ${this.path} is unreadable (${(err as Error).message}); refusing to start because balances need recovery. Original file preserved.`;
      this.log(`!!! ${message}`);
      throw new Error(message, { cause: err });
    }
  }

  get pending(): readonly SettlementItem[] {
    return this.pendingItems;
  }

  live(): LiveStake[] {
    return [...this.liveByRoom.values()].flat();
  }

  receiptsFor(player: string): readonly SettlementReceipt[] {
    return this.completed.filter((r) => r.player === player).map((r) => ({ ...r }));
  }

  /** A confirmed send becomes a replayable receipt in the same durable write as claim removal. */
  complete(key: string, signature: string, now = Date.now()): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (!item || item.kind !== 'settle') throw new Error('cannot complete an unknown financial claim');
    const receipt: SettlementReceipt = { kind: 'settle', key, player: item.player, arenaId: item.arenaId!,
      sessionId: item.sessionId!, signature, payout: item.payout!, settledAt: now };
    const completed = [...this.completed.filter((r) => r.key !== key || r.sessionId !== item.sessionId), receipt].slice(-MAX_COMPLETED_RECEIPTS);
    this.save(this.pendingItems.filter((p) => p.key !== key), this.liveByRoom, completed);
  }

  /**
   * Converts every player that was alive when the server stopped into a
   * settlement at their last snapshot value ("auto cash-out on crash").
   * Returns the number of recovered players.
   */
  recoverLive(now = Date.now()): number {
    const live = this.live();
    const recovered = live.map((l): SettlementItem => ({
      kind: 'settle', key: l.session, player: l.player, arenaId: l.arenaId,
      session: l.session, sessionId: l.sessionId, payout: l.value,
      score: l.score, kills: l.kills, xp: 0, reason: 'crash',
      attempts: 0, nextAttemptAt: now, createdAt: now,
    }));
    this.save([...this.pendingItems, ...recovered], new Map());
    return live.length;
  }

  /** Atomically enqueue settlements and replace a room's live snapshot. */
  commit(opts: { enqueue?: SettlementItem[]; roomId?: string; live?: LiveStake[] }): void {
    const pending = [...this.pendingItems];
    for (const item of opts.enqueue ?? []) {
      const previous = pending.find((p) => p.key === item.key);
      if (previous) {
        if (previous.kind !== item.kind || previous.player !== item.player || previous.sessionId !== item.sessionId || previous.payout !== item.payout) {
          throw new Error(`conflicting settlement for ${item.key}`);
        }
      } else pending.push({ ...item });
    }
    const rooms = new Map(this.liveByRoom);
    if (opts.roomId !== undefined && opts.live) {
      if (opts.live.length > 0) rooms.set(opts.roomId, opts.live.map((l) => ({ ...l })));
      else rooms.delete(opts.roomId);
    }
    this.save(pending, rooms);
  }

  enqueue(item: SettlementItem): void {
    this.commit({ enqueue: [item] });
  }

  /** Marks an item as done (settled on-chain or no longer applicable). */
  remove(key: string): void {
    const pending = this.pendingItems.filter((p) => p.key !== key);
    if (pending.length !== this.pendingItems.length) this.save(pending, this.liveByRoom);
  }

  /** Records a failed attempt with exponential backoff (max 5 minutes). */
  retryLater(key: string, error: string, now = Date.now()): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (!item) return;
    const attempts = item.attempts + 1;
    this.replace(key, { ...item, attempts, lastError: error.slice(0, 300), nextAttemptAt: now + Math.min(300_000, 2000 * 2 ** Math.min(attempts, 8)) });
  }

  submitted(key: string, signature: string): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (item) this.replace(key, { ...item, submittedSignature: signature });
  }

  private replace(key: string, item: SettlementItem): void {
    this.save(this.pendingItems.map((p) => p.key === key ? item : p), this.liveByRoom);
  }

  /** Persist before publishing memory state: an I/O failure never pretends a commit succeeded. */
  private save(pending: SettlementItem[], rooms: Map<string, LiveStake[]>, completed = this.completed): void {
    if (this.persistenceFailure) throw this.persistenceFailure;
    const live = [...rooms.values()].flat();
    validateSnapshot(pending, live);
    validateReceipts(completed);
    if (this.path) {
      try {
        const data: JournalFile = { version: 1, pending, live, completed, updatedAt: Date.now() };
        mkdirSync(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.tmp`;
        const fd = openSync(tmp, 'w', 0o600);
        try {
          writeFileSync(fd, JSON.stringify(data));
          fsyncSync(fd);
        } finally { closeSync(fd); }
        renameSync(tmp, this.path);
        const directory = openSync(dirname(this.path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      } catch (err) {
        this.persistenceFailure = new Error(`Settlement journal write failed; financial activity is halted until recovery: ${(err as Error).message}`, { cause: err });
        this.log(`!!! ${this.persistenceFailure.message}`);
        throw this.persistenceFailure;
      }
    }
    this.pendingItems = pending;
    this.liveByRoom = rooms;
    this.completed = completed;
  }
}

const nonnegativeInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function validateReceipts(receipts: SettlementReceipt[]): void {
  if (!Array.isArray(receipts)) throw new Error('invalid receipt archive');
  for (const r of receipts) {
    if (!r || r.kind !== 'settle' || ![r.key, r.player, r.signature].every(nonempty)
      || ![r.arenaId, r.sessionId, r.payout, r.settledAt].every(nonnegativeInt) || r.arenaId > 65535) throw new Error('invalid settlement receipt');
  }
}

function validateSnapshot(pending: SettlementItem[], live: LiveStake[]): void {
  const keys = new Set<string>();
  const totals = new Map<number, number>();
  const claim = (key: string, arenaId: number, value: number) => {
    if (keys.has(key)) throw new Error(`duplicate financial claim ${key}`);
    keys.add(key);
    if (!nonnegativeInt(arenaId) || arenaId > 65535 || !nonnegativeInt(value)) throw new Error('invalid journal balance');
    const total = (totals.get(arenaId) ?? 0) + value;
    if (!nonnegativeInt(total)) throw new Error('journal total exceeds safe accounting range');
    totals.set(arenaId, total);
  };
  for (const p of pending) {
    if (!p || !nonempty(p.key) || !nonempty(p.player) || !['settle', 'record'].includes(p.kind)
      || ![p.score, p.kills, p.xp, p.attempts, p.nextAttemptAt, p.createdAt].every(nonnegativeInt)) throw new Error('invalid journal item');
    if (p.submittedSignature !== undefined && !nonempty(p.submittedSignature)) throw new Error('invalid submitted signature');
    if (p.kind === 'settle') {
      if (p.session !== p.key || (p.sessionId !== undefined && !nonnegativeInt(p.sessionId))) throw new Error('invalid settlement session');
      claim(p.key, p.arenaId!, p.payout!);
    } else {
      if (keys.has(p.key)) throw new Error('duplicate journal item');
      keys.add(p.key);
    }
  }
  for (const l of live) {
    if (!l || !nonempty(l.roomId) || !nonempty(l.player) || !nonempty(l.session)
      || ![l.sessionId, l.score, l.kills].every(nonnegativeInt)) throw new Error('invalid live stake');
    claim(l.session, l.arenaId, l.value);
  }
}
