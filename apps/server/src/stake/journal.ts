import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * Why a ticket was settled. `round`: alive at the round end (paid arenas). `cashout` and `afk` are
 * no longer produced by arena rooms (timed rounds) but stay readable in old journals.
 */
export type SettleReason = 'cashout' | 'death' | 'afk' | 'crash' | 'stale' | 'maxage' | 'kicked' | 'round';

export interface SettlementItem {
  /** v1 journals also held free-play `record` items; v2 drops them on load. */
  kind: 'settle';
  /** Unique key: the session PDA. */
  key: string;
  /** Wallet (base58). */
  player: string;
  arenaId?: number;
  session?: string;
  /** On-chain session id (settle only); guards against settling a re-joined session. */
  sessionId?: number;
  /** Raw token units owed. */
  payout?: number;
  score: number;
  kills: number;
  xp: number;
  reason?: SettleReason;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
  /**
   * Attempts that failed on the player's token account itself (closed meanwhile, owner
   * changed, Token-2022 MemoTransfer required, ...). After a few, the worker settles without
   * the account and the session is finalized with `owed` (R24).
   */
  tokenFailures?: number;
}

/**
 * Floor loot an arena instance still held at a round end, moved to the current season's pool
 * by `sweep_loot` (server-signed). Only the loot value the room computed is ever swept: never
 * live stakes or owed payouts. Idempotent by `key` = `sweep:<roomId>:<round>`.
 */
export interface SweepItem {
  kind: 'sweep';
  /** `sweep:<roomId>:<round>`. */
  key: string;
  arenaId: number;
  /** Arena instance whose floor held the loot. */
  roomId: string;
  /** Round number (`roundAt(...).n`) that ended. */
  round: number;
  /** Raw token units to move from the arena vault to the season vault (> 0). */
  amount: number;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
  /**
   * The last transaction sent for this sweep, when (Unix ms) and the `lastValidBlockHeight` of
   * its blockhash. A sweep has no on-chain marker, so it is sent again only once that
   * transaction provably cannot land: the block height ('confirmed') is past
   * `sentLastValidBlockHeight` AND its signature did not land. Persisted before each send, so
   * a restart keeps the guard.
   */
  sentSignature?: string;
  sentAt?: number;
  sentLastValidBlockHeight?: number;
}

/** Everything the chain worker executes: ticket settlements and loot sweeps. */
export type JournalItem = SettlementItem | SweepItem;

/** Raw token units a journal item still owes out of its arena vault. */
export const itemAmount = (item: JournalItem): number => (item.kind === 'sweep' ? item.amount : (item.payout ?? 0));

export const sweepKey = (roomId: string, round: number): string => `sweep:${roomId}:${round}`;

export interface LiveStake {
  roomId: string;
  session: string;
  sessionId: number;
  player: string;
  arenaId: number;
  value: number;
  score: number;
  kills: number;
  hasPass: boolean;
}

/** A loot piece lying on an arena instance's floor (value in raw token units). */
export interface LootRecord {
  /** The arena instance (room id) whose floor holds the piece. */
  roomId: string;
  arenaId: number;
  x: number;
  y: number;
  value: number;
}

/** Room id of an arena's first instance (where recovered loot is merged). */
export const firstArenaInstance = (arenaId: number): string => `arena-${arenaId}-1`;

interface JournalFile {
  version: 2;
  pending: JournalItem[];
  live: LiveStake[];
  loot: LootRecord[];
  updatedAt: number;
}

interface JournalFileV1 {
  version: 1;
  pending: SettlementItem[];
  live: Omit<LiveStake, 'hasPass'>[];
  updatedAt: number;
}

/**
 * Crash-safe record of money the server owes. Every change is written with
 * write-to-temp + rename, so the file on disk is always a complete snapshot.
 *
 * Invariant: at any instant, Σ live values + Σ loot + Σ pending amounts (payouts and
 * loot sweeps, per arena) equals what the arena vault owes, because value only leaves
 * `live` in the same write that adds the matching pending settlement, loot only leaves
 * the floor records in the same write that adds its sweep, and the room writes live
 * values and loot together.
 *
 * File format v2 adds `loot` and `LiveStake.hasPass`; v1 files are migrated on load.
 * Loot is keyed by arena instance (room id), so instances of one arena never
 * overwrite each other's records; on restart an arena's first instance adopts
 * every instance's loot (`adoptLoot`). Records written before instances
 * existed (no `roomId`) belong to the first instance.
 */
export class Journal {
  private pendingItems: JournalItem[] = [];
  private liveByRoom = new Map<string, LiveStake[]>();
  private lootByRoom = new Map<string, LootRecord[]>();
  /** Arenas whose loot was already adopted in this process (restored once only). */
  private readonly adopted = new Set<number>();
  /** `load` quarantined an unreadable file in this process. */
  private quarantinedHere = false;

  constructor(
    private readonly path: string | null,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as JournalFile | JournalFileV1;
      const data = migrate(raw);
      // v1 free-play `record` items: v2 writes no on-chain records, so they are dropped
      // (any other unknown kind is kept and reaches the worker's loud "unknown kind" path)
      const settle = data.pending.filter((p) => (p as { kind: string }).kind !== 'record');
      const legacy = data.pending.length - settle.length;
      this.pendingItems = settle;
      if (legacy > 0) this.log(`journal: dropped ${legacy} legacy free-play record item(s) (v2 writes no on-chain records)`);
      for (const l of data.live) {
        const list = this.liveByRoom.get(l.roomId) ?? [];
        list.push(l);
        this.liveByRoom.set(l.roomId, list);
      }
      for (const l of data.loot) {
        const list = this.lootByRoom.get(l.roomId) ?? [];
        list.push(l);
        this.lootByRoom.set(l.roomId, list);
      }
      if (legacy > 0) this.persist();
    } catch (err) {
      this.quarantinedHere = true;
      const backup = `${this.path}.corrupt-${Date.now()}`;
      this.log(`!!! journal at ${this.path} is unreadable (${(err as Error).message}); moved to ${backup}. Manual review required.`);
      try {
        renameSync(this.path, backup);
      } catch {
        /* ignore */
      }
    }
  }

  get pending(): readonly JournalItem[] {
    return this.pendingItems;
  }

  /** The pending ticket settlements (without loot sweeps). */
  settlements(): SettlementItem[] {
    return this.pendingItems.filter((p): p is SettlementItem => p.kind === 'settle');
  }

  live(): LiveStake[] {
    return [...this.liveByRoom.values()].flat();
  }

  /** Loot that was on any instance of an arena at the last write (empty when none). Non-destructive. */
  recoverLoot(arenaId: number): LootRecord[] {
    const out: LootRecord[] = [];
    for (const list of this.lootByRoom.values()) for (const l of list) if (l.arenaId === arenaId) out.push({ ...l });
    return out;
  }

  /**
   * Moves every loot record of `arenaId` (from all instances) under `roomId`
   * in one atomic write and returns them. The adopting room restores them, so
   * its later commits keep the whole amount. One-shot per arena and process:
   * a second call returns nothing, so the same loot is never restored twice.
   */
  adoptLoot(arenaId: number, roomId: string): LootRecord[] {
    if (this.adopted.has(arenaId)) return [];
    this.adopted.add(arenaId);
    const all = this.recoverLoot(arenaId).map((l) => ({ ...l, roomId }));
    let moved = false;
    for (const [rid, list] of [...this.lootByRoom]) {
      if (rid === roomId || !list.some((l) => l.arenaId === arenaId)) continue;
      moved = true;
      const rest = list.filter((l) => l.arenaId !== arenaId);
      if (rest.length > 0) this.lootByRoom.set(rid, rest);
      else this.lootByRoom.delete(rid);
    }
    const own = (this.lootByRoom.get(roomId) ?? []).filter((l) => l.arenaId !== arenaId);
    if (all.length > 0 || own.length > 0) this.lootByRoom.set(roomId, [...own, ...all]);
    else this.lootByRoom.delete(roomId);
    if (moved) this.persist();
    return all.map((l) => ({ ...l }));
  }

  /**
   * What the journal says arena `arenaId`'s vault owes: Σ pending payouts and loot sweeps + Σ loot
   * on its floors + Σ live ticket values (raw token units). The vault must hold at least this.
   */
  owedByArena(arenaId: number): number {
    let sum = 0;
    for (const p of this.pendingItems) if (p.arenaId === arenaId) sum += itemAmount(p);
    for (const list of this.lootByRoom.values()) for (const l of list) if (l.arenaId === arenaId) sum += l.value;
    for (const list of this.liveByRoom.values()) for (const l of list) if (l.arenaId === arenaId) sum += l.value;
    return sum;
  }

  /** Σ loot value over every arena. */
  lootTotal(): number {
    let sum = 0;
    for (const list of this.lootByRoom.values()) for (const l of list) sum += l.value;
    return sum;
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

  /**
   * Atomically enqueue settlements, replace a room's live snapshot and
   * replace an arena instance's loot records.
   */
  commit(opts: {
    enqueue?: JournalItem[];
    roomId?: string;
    live?: LiveStake[];
    loot?: { roomId: string; arenaId: number; items: { x: number; y: number; value: number }[] };
  }): void {
    if (opts.enqueue) {
      for (const item of opts.enqueue) {
        if (!this.pendingItems.some((p) => p.key === item.key)) this.pendingItems.push(item);
      }
    }
    if (opts.roomId !== undefined && opts.live) {
      if (opts.live.length > 0) this.liveByRoom.set(opts.roomId, opts.live);
      else this.liveByRoom.delete(opts.roomId);
    }
    if (opts.loot) {
      const { roomId, arenaId, items } = opts.loot;
      if (items.length > 0) this.lootByRoom.set(roomId, items.map((i) => ({ roomId, arenaId, x: i.x, y: i.y, value: i.value })));
      else this.lootByRoom.delete(roomId);
    }
    this.persist();
  }

  enqueue(item: JournalItem): void {
    this.commit({ enqueue: [item] });
  }

  /**
   * Records the transaction just sent for a sweep item with its blockhash's
   * `lastValidBlockHeight` (persisted before the send is awaited); an empty `signature` clears
   * it (the program rejected it: nothing moved).
   */
  markSent(key: string, signature: string, at = Date.now(), lastValidBlockHeight?: number): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (!item || item.kind !== 'sweep') return;
    if (signature) {
      item.sentSignature = signature;
      item.sentAt = at;
      if (lastValidBlockHeight === undefined) delete item.sentLastValidBlockHeight;
      else item.sentLastValidBlockHeight = lastValidBlockHeight;
    } else {
      delete item.sentSignature;
      delete item.sentAt;
      delete item.sentLastValidBlockHeight;
    }
    this.persist();
  }

  /** Marks an item as done (settled on-chain or no longer applicable). */
  remove(key: string): void {
    const before = this.pendingItems.length;
    this.pendingItems = this.pendingItems.filter((p) => p.key !== key);
    if (this.pendingItems.length !== before) this.persist();
  }

  /**
   * Records a failed attempt with exponential backoff (max 5 minutes), or after
   * `opts.delayMs` when given. `tokenFailure` counts a failure caused by the player's
   * token account (`tokenFailures`).
   */
  retryLater(key: string, error: string, now = Date.now(), opts: { delayMs?: number; tokenFailure?: boolean } = {}): void {
    const item = this.pendingItems.find((p) => p.key === key);
    if (!item) return;
    item.attempts++;
    item.lastError = error.slice(0, 300);
    item.nextAttemptAt = now + (opts.delayMs ?? Math.min(300_000, 2000 * 2 ** Math.min(item.attempts, 8)));
    if (opts.tokenFailure && item.kind === 'settle') item.tokenFailures = (item.tokenFailures ?? 0) + 1;
    this.persist();
  }

  /**
   * Quarantined journal files next to this one (`<name>.corrupt-<ts>`, moved aside by
   * `load`). While any exists, what the server owed at that time is unknown (M9).
   */
  quarantinedFiles(): string[] {
    if (!this.path) return this.quarantinedHere ? ['(in-memory)'] : [];
    const dir = dirname(this.path);
    const prefix = `${basename(this.path)}.corrupt-`;
    try {
      return readdirSync(dir).filter((f) => f.startsWith(prefix));
    } catch {
      return this.quarantinedHere ? [`${prefix}?`] : [];
    }
  }

  private persist(): void {
    if (!this.path) return;
    const data: JournalFile = {
      version: 2,
      pending: this.pendingItems,
      live: this.live(),
      loot: [...this.lootByRoom.values()].flat(),
      updatedAt: Date.now(),
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.path);
  }
}

/** Validates a journal file and upgrades v1 (no loot, no `hasPass`) to v2. */
function migrate(data: JournalFile | JournalFileV1): JournalFile {
  if (!data || !Array.isArray(data.pending) || !Array.isArray(data.live)) throw new Error('bad journal shape');
  if (data.version === 1) {
    return {
      version: 2,
      pending: data.pending,
      live: data.live.map((l) => ({ ...l, hasPass: false })),
      loot: [],
      updatedAt: data.updatedAt,
    };
  }
  if (data.version !== 2 || !Array.isArray(data.loot)) throw new Error('bad journal shape');
  for (const p of data.pending) {
    if ((p as { kind: string }).kind !== 'sweep') continue;
    const sw = p as SweepItem;
    if (typeof sw.key !== 'string' || !Number.isSafeInteger(sw.amount) || sw.amount <= 0) throw new Error('bad sweep item');
    if (!Number.isInteger(sw.arenaId) || sw.arenaId < 0 || typeof sw.roomId !== 'string' || !Number.isInteger(sw.round)) throw new Error('bad sweep item');
  }
  for (const l of data.loot) {
    if (!Number.isSafeInteger(l.value) || l.value <= 0 || !Number.isFinite(l.x) || !Number.isFinite(l.y)) throw new Error('bad loot record');
    if (!Number.isInteger(l.arenaId) || l.arenaId < 0) throw new Error('bad loot record');
    // written before arena instances existed: the arena's single room is its first instance
    if (l.roomId === undefined) l.roomId = firstArenaInstance(l.arenaId);
    else if (typeof l.roomId !== 'string' || l.roomId.length === 0) throw new Error('bad loot record');
  }
  return data;
}
