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
  pending: SettlementItem[];
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
 * Invariant: at any instant, Σ live values + Σ loot + Σ pending payouts (per
 * arena) equals what the arena vault owes, because value only leaves `live`
 * in the same write that adds the matching pending settlement, and the room
 * writes live values and loot together.
 *
 * File format v2 adds `loot` and `LiveStake.hasPass`; v1 files are migrated on load.
 * Loot is keyed by arena instance (room id), so instances of one arena never
 * overwrite each other's records; on restart an arena's first instance adopts
 * every instance's loot (`adoptLoot`). Records written before instances
 * existed (no `roomId`) belong to the first instance.
 */
export class Journal {
  private pendingItems: SettlementItem[] = [];
  private liveByRoom = new Map<string, LiveStake[]>();
  private lootByRoom = new Map<string, LootRecord[]>();

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
      this.pendingItems = data.pending;
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

  /** Loot that was on any instance of an arena at the last write (empty when none). Non-destructive. */
  recoverLoot(arenaId: number): LootRecord[] {
    const out: LootRecord[] = [];
    for (const list of this.lootByRoom.values()) for (const l of list) if (l.arenaId === arenaId) out.push({ ...l });
    return out;
  }

  /**
   * Moves every loot record of `arenaId` (from all instances) under `roomId`
   * in one atomic write and returns them. The adopting room restores them, so
   * its later commits keep the whole amount.
   */
  adoptLoot(arenaId: number, roomId: string): LootRecord[] {
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
    enqueue?: SettlementItem[];
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
  for (const l of data.loot) {
    if (!Number.isSafeInteger(l.value) || l.value <= 0 || !Number.isFinite(l.x) || !Number.isFinite(l.y)) throw new Error('bad loot record');
    if (!Number.isInteger(l.arenaId) || l.arenaId < 0) throw new Error('bad loot record');
    // written before arena instances existed: the arena's single room is its first instance
    if (l.roomId === undefined) l.roomId = firstArenaInstance(l.arenaId);
    else if (typeof l.roomId !== 'string' || l.roomId.length === 0) throw new Error('bad loot record');
  }
  return data;
}
