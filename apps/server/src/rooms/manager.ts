import { TICK_MS, arenaMeta, type BlockedArena, type League, type RoomInfo, type RoundWindow } from '@slana/shared';
import type { ChainGateway } from '../chain/types';
import type { ServerConfig } from '../config';
import type { Conn } from '../net/conn';
import type { ArenaEntry } from '../stake/ledger';
import { Room, type BellSettled, type RoomDeps } from './room';
import { RoundClock } from './round-clock';

/** How long the gateway remembers an AFK ticket settled at a bell (for `round_ended`). */
export const BELL_MEMO_MS = 30 * 60_000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** On-chain arena list is re-read at most this often. */
const ARENA_CACHE_MS = 30_000;
/** Practice players with this profile level or more always play in the pro league. */
export const PRO_LEVEL = 5;
/** A rookie game with max mass above this promotes the player's IP to pro… */
export const PROMOTE_MAX_MASS = 3000;
/** …and so does one with at least this many player kills. */
export const PROMOTE_KILLS = 8;
/** How long a promotion lasts. */
export const PROMOTION_MS = 24 * 3600_000;

interface ArenaData {
  buyIn: number;
  maxPlayers: number;
  enabled: boolean;
  requiresPass: boolean;
  /** Vault balance (raw units); null = not tracked (dev-fake). */
  pot: number | null;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly conns = new Set<Conn>();
  private timer: NodeJS.Timeout | null = null;
  private lastCleanup = Date.now();
  private arenaCache: { at: number; ids: Map<number, ArenaData> } | null = null;
  /** IP → time of the promotion to the pro league. */
  private readonly promotions = new Map<string, number>();
  private readonly deps: RoomDeps;
  /** Arenas kept disabled because their vault cannot cover the journal (id → message). */
  private readonly underfunded = new Map<number, string>();
  /** `enabled` of each arena at the last chain read (detects a disabled → enabled flip). */
  private readonly lastEnabled = new Map<number, boolean>();
  /** `arenaId:wallet` → the AFK ticket the last bell settled while its player was away. */
  private readonly bellMemo = new Map<string, BellSettled & { at: number }>();

  constructor(
    private readonly cfg: ServerConfig,
    deps: RoomDeps,
    private readonly chain: ChainGateway,
  ) {
    this.deps = {
      ...deps,
      pass: deps.pass ?? cfg.pass,
      round: deps.round ?? cfg.round,
      // one clock for the gateway and every room
      clock: deps.clock ?? new RoundClock(deps.now, deps.round ?? cfg.round),
      onGameOver: (e) => {
        this.onGameOver(e);
        deps.onGameOver?.(e);
      },
      onBellSettled: (e) => {
        this.bellMemo.set(`${e.arenaId}:${e.wallet}`, { ...e, at: Date.now() });
        deps.onBellSettled?.(e);
      },
    };
    this.createPractice('rookie');
    this.createPractice('pro');
  }

  /** The wall clock arena rounds run on (Unix ms; injectable through `RoomDeps.now`). */
  now(): number {
    return this.deps.clock!.now();
  }

  /** The arena round running at `now` (shared by every arena and instance). */
  roundWindow(now = this.now()): RoundWindow {
    return this.deps.clock!.window(now);
  }

  /** The ticket a bell settled while this wallet was away from the arena (kept `BELL_MEMO_MS`). */
  bellSettled(arenaId: number, wallet: string): BellSettled | null {
    const key = `${arenaId}:${wallet}`;
    const m = this.bellMemo.get(key);
    if (!m) return null;
    if (Date.now() - m.at > BELL_MEMO_MS) {
      this.bellMemo.delete(key);
      return null;
    }
    return m;
  }

  forgetBellSettled(arenaId: number, wallet: string): void {
    this.bellMemo.delete(`${arenaId}:${wallet}`);
  }

  /* ---------------------------------------------------------------- */
  /* Practice leagues                                                 */
  /* ---------------------------------------------------------------- */

  private createPractice(league: League): Room {
    let n = 1;
    while (this.rooms.has(`practice-${league}-${n}`)) n++;
    const room = new Room(
      {
        id: `practice-${league}-${n}`,
        mode: 'practice',
        league,
        name: `${league === 'rookie' ? 'Rookie' : 'Pro'} Pond #${n}`,
        maxPlayers: this.cfg.practiceCapacity,
        bots: league === 'rookie' ? this.cfg.bots.practiceRookie : this.cfg.bots.practicePro,
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /**
   * Busiest non-full practice room of a league (so players meet each other),
   * else a new one. `prefer` (the room the connection is already in) wins when
   * it serves that league and has space.
   */
  practiceRoom(league: League, prefer?: Room | null): Room {
    if (prefer && prefer.opts.mode === 'practice' && prefer.opts.league === league && !prefer.isFull) return prefer;
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.opts.mode !== 'practice' || r.opts.league !== league || r.isFull) continue;
      if (!best || r.humans.size > best.humans.size) best = r;
    }
    return best ?? this.createPractice(league);
  }

  /** `pro` for level ≥ 5 profiles and for IPs promoted in the last 24 h, else `rookie`. */
  leagueFor(conn: Conn, now = Date.now()): League {
    if ((conn.profile?.level ?? 0) >= PRO_LEVEL) return 'pro';
    const at = this.promotions.get(conn.ip);
    return at !== undefined && now - at < PROMOTION_MS ? 'pro' : 'rookie';
  }

  private onGameOver(e: Parameters<NonNullable<RoomDeps['onGameOver']>>[0]): void {
    if (e.room.opts.mode !== 'practice' || e.room.opts.league !== 'rookie' || !e.conn) return;
    if (e.stats.maxMass > PROMOTE_MAX_MASS || e.stats.playersEaten >= PROMOTE_KILLS) {
      const first = !this.promotions.has(e.conn.ip);
      this.promotions.set(e.conn.ip, Date.now());
      if (first) this.deps.log(`league: ${e.conn.ip} promoted to pro`);
    }
  }

  /** Default room for lobby spectators. */
  lobbyRoom(): Room {
    let best: Room | null = null;
    for (const r of this.rooms.values()) if (r.opts.mode === 'practice' && (!best || r.humans.size > best.humans.size)) best = r;
    return best ?? this.createPractice('rookie');
  }

  privateRoom(code: string | null): Room | null {
    if (code) return this.rooms.get(`priv-${code}`) ?? null;
    let c = '';
    do {
      c = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(`priv-${c}`));
    const room = new Room(
      {
        id: `priv-${c}`,
        mode: 'private',
        name: `Private · ${c}`,
        code: c,
        maxPlayers: this.cfg.privateRoomCapacity,
        bots: this.cfg.bots.private,
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /* ---------------------------------------------------------------- */
  /* Arenas (sharded into instances)                                  */
  /* ---------------------------------------------------------------- */

  private async arenas(): Promise<Map<number, ArenaData>> {
    if (this.arenaCache && Date.now() - this.arenaCache.at < ARENA_CACHE_MS) return this.arenaCache.ids;
    const list = await this.chain.listArenas();
    const ids = new Map<number, ArenaData>(
      list.map((a) => [a.id, { buyIn: a.entryFee, maxPlayers: a.maxSessions, enabled: a.enabled, requiresPass: a.requiresPass, pot: a.pot }]),
    );
    this.arenaCache = { at: Date.now(), ids };
    await this.recheckVaults(ids);
    return ids;
  }

  /**
   * Vault guard while the server runs (R20): on every arena refresh, every arena's vault is
   * compared with what the journal owes it, so a disable → sweep → re-enable sequence is
   * caught even when it happens between two refreshes. A healthy vault clears a stale entry.
   *
   * The arena list is cached, so the pot of a running arena can trail joins that the journal
   * already counts (live tickets). A shortfall of an arena that was enabled at the last read
   * too is therefore confirmed with a fresh chain read before the arena is blocked; a
   * disabled or just re-enabled arena is blocked at once (no joins can explain its shortfall).
   * Live instances do not exempt an arena: a blocked arena sells no ticket.
   */
  private async recheckVaults(ids: Map<number, ArenaData>): Promise<void> {
    let fresh: Map<number, number | null> | null = null;
    for (const [id, a] of ids) {
      const before = this.lastEnabled.get(id);
      this.lastEnabled.set(id, a.enabled);
      if (a.pot === null) continue;
      const owed = this.deps.journal.owedByArena(id);
      if (a.pot >= owed || this.underfunded.has(id) || !a.enabled || before !== true) {
        this.vaultCovers(id, a);
        continue;
      }
      try {
        fresh ??= new Map((await this.chain.listArenas(true)).map((x) => [x.id, x.pot]));
      } catch {
        continue;
      }
      const pot = fresh.get(id);
      if (pot === undefined || pot === null) continue;
      this.vaultCovers(id, { ...a, pot });
    }
  }

  /** Every open instance of an arena, by instance number. */
  arenaInstances(arenaId: number): Room[] {
    return [...this.rooms.values()]
      .filter((r) => r.opts.mode === 'arena' && r.opts.stake?.arenaId === arenaId)
      .sort((a, b) => (a.opts.instance ?? 1) - (b.opts.instance ?? 1));
  }

  private createArenaInstance(arenaId: number, arena: ArenaData): Room {
    const taken = new Set(this.arenaInstances(arenaId).map((r) => r.opts.instance ?? 1));
    let n = 1;
    while (taken.has(n)) n++;
    const meta = arenaMeta(arenaId);
    const room = new Room(
      {
        id: `arena-${arenaId}-${n}`,
        mode: 'arena',
        name: n === 1 ? meta.name : `${meta.name} #${n}`,
        instance: n,
        maxPlayers: this.cfg.arenaInstanceCap,
        bots: this.cfg.bots.arena,
        stake: { arenaId, buyIn: arena.buyIn, requiresPass: arena.requiresPass },
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /**
   * Vault guard (R20), checked when an arena is attached (no instance yet in this
   * process): its on-chain vault must hold at least what the journal says it owes (loot +
   * pending payouts + loot sweeps + live tickets). A vault swept or drained while loot was journaled
   * would otherwise pay old loot with other players' entry fees, or fail `InsufficientPot`.
   * An underfunded arena stays disabled (re-checked on every attach attempt) and is logged
   * loudly once.
   */
  private vaultCovers(arenaId: number, arena: ArenaData): boolean {
    if (arena.pot === null) return true;
    const owed = this.deps.journal.owedByArena(arenaId);
    if (arena.pot >= owed) {
      if (this.underfunded.delete(arenaId)) this.deps.log(`arena #${arenaId}: vault ${arena.pot} now covers the journal (${owed}) — enabled again`);
      return true;
    }
    if (!this.underfunded.has(arenaId)) {
      const msg =
        `!!! arena #${arenaId} KEPT DISABLED: its vault holds ${arena.pot} raw units but the journal owes ${owed} ` +
        `(loot + pending payouts + loot sweeps + live tickets). Was the arena swept? Do not re-enable a swept arena; ` +
        `top up the vault or settle the journal by hand before attaching it.`;
      this.underfunded.set(arenaId, msg);
      this.deps.log(msg);
    }
    return false;
  }

  /** Arenas the vault guard keeps disabled (id → reason). */
  underfundedArenas(): ReadonlyMap<number, string> {
    return this.underfunded;
  }

  /** The public form of `underfundedArenas` (rooms message, `/api/rooms`): the lobby must not sell these. */
  blockedArenas(): BlockedArena[] {
    return [...this.underfunded.keys()].sort((a, b) => a - b).map((arenaId) => ({ arenaId, reason: 'vault_short' }));
  }

  private arenaAllowed(arenaId: number): boolean {
    return this.chain.stakeEnabled && (this.cfg.chain.arenaIds.length === 0 || this.cfg.chain.arenaIds.includes(arenaId));
  }

  /**
   * Room for a new arena player: the busiest instance `arena-<id>-<n>` with
   * fewer humans than the instance cap, else a new instance. Null when the
   * arena does not exist or is disabled.
   */
  async arenaRoom(arenaId: number): Promise<Room | null> {
    if (!this.arenaAllowed(arenaId)) return null;
    const arena = (await this.arenas()).get(arenaId);
    if (!arena || !arena.enabled) return null;
    if (this.underfunded.has(arenaId)) return null;
    if (this.arenaInstances(arenaId).length === 0 && !this.vaultCovers(arenaId, arena)) return null;
    let best: Room | null = null;
    for (const r of this.arenaInstances(arenaId)) {
      if (r.humans.size >= this.cfg.arenaInstanceCap) continue;
      if (!best || r.humans.size > best.humans.size) best = r;
    }
    const room = best ?? this.createArenaInstance(arenaId, arena);
    // a join is under way: keep cleanup from closing this (possibly idle) instance meanwhile
    room.lastActivity = Date.now();
    return room;
  }

  /**
   * Re-validates a room picked by `arenaRoom` after the join's awaits: it must
   * still be in the map (cleanup may have closed it) and have space. Otherwise
   * picks again, with the same checks. Null when no live room is available.
   */
  async confirmArenaRoom(arenaId: number, room: Room): Promise<Room | null> {
    const live = (r: Room | null): r is Room => r !== null && this.rooms.get(r.id) === r && !r.isFull;
    if (live(room)) {
      room.lastActivity = Date.now();
      return room;
    }
    const again = await this.arenaRoom(arenaId);
    return live(again) ? again : null;
  }

  /** The instance of `arenaId` in which `wallet` holds a live ticket, if any. */
  findArenaStake(arenaId: number, wallet: string): { room: Room; entry: ArenaEntry } | null {
    for (const room of this.arenaInstances(arenaId)) {
      const entry = room.findStakeByWallet(wallet);
      if (entry) return { room, entry };
    }
    return null;
  }

  /**
   * Makes sure every enabled arena has its first instance (shown in the lobby;
   * it also adopts loot journaled by any instance before a restart).
   */
  async ensureArenaRooms(): Promise<void> {
    if (!this.chain.stakeEnabled) return;
    try {
      for (const [id, a] of await this.arenas()) {
        if (!a.enabled || !this.arenaAllowed(id)) continue;
        if (this.underfunded.has(id)) continue;
        if (this.arenaInstances(id).length === 0 && !this.vaultCovers(id, a)) continue;
        if (!this.rooms.has(`arena-${id}-1`)) this.createArenaInstance(id, a);
      }
    } catch (err) {
      this.deps.log(`arena discovery failed: ${(err as Error).message}`);
    }
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()].filter((r) => r.opts.mode !== 'private').map((r) => r.info());
  }

  online(): number {
    return this.conns.size;
  }

  liveSessions(): Set<string> {
    const s = new Set<string>();
    for (const r of this.rooms.values()) for (const k of r.liveSessions()) s.add(k);
    return s;
  }

  connsByWallet(wallet: string): Conn[] {
    return [...this.conns].filter((c) => c.wallet === wallet);
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                             */
  /* ---------------------------------------------------------------- */

  start(): void {
    let next = performance.now();
    const loop = () => {
      const now = performance.now();
      let n = 0;
      while (now >= next && n < 3) {
        this.tickAll(TICK_MS);
        next += TICK_MS;
        n++;
      }
      if (now - next > 250) next = now + TICK_MS; // fell far behind: resync
      this.timer = setTimeout(loop, Math.max(0, next - performance.now()));
    };
    this.timer = setTimeout(loop, 0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  tickAll(dt: number): void {
    for (const room of this.rooms.values()) {
      try {
        room.tick(dt);
      } catch (err) {
        this.deps.log(`room ${room.id} tick failed: ${(err as Error).stack ?? err}`);
      }
    }
    const now = Date.now();
    if (now - this.lastCleanup > 15_000) {
      this.lastCleanup = now;
      this.cleanup(now);
    }
  }

  private cleanup(now: number): void {
    for (const [key, m] of this.bellMemo) if (now - m.at > BELL_MEMO_MS) this.bellMemo.delete(key);
    for (const room of [...this.rooms.values()]) {
      const idle = room.conns.size === 0 && room.humans.size === 0;
      if (!idle) continue;
      if (room.opts.mode === 'private' && now - room.lastActivity > 120_000) this.rooms.delete(room.id);
      // every league keeps its first room
      if (room.opts.mode === 'practice' && !room.id.endsWith('-1') && now - room.lastActivity > 300_000) this.rooms.delete(room.id);
      // extra arena instances close once empty, with no ticket and no loot left on their floor
      if (
        room.opts.mode === 'arena' &&
        (room.opts.instance ?? 1) > 1 &&
        room.liveSessions().length === 0 &&
        room.world.loot().length === 0 &&
        now - room.lastActivity > 300_000
      )
        this.rooms.delete(room.id);
    }
    for (const [ip, at] of this.promotions) if (now - at >= PROMOTION_MS) this.promotions.delete(ip);
  }

  shutdown(): void {
    this.stop();
    for (const room of this.rooms.values()) room.shutdown();
  }
}
