import { TICK_MS, arenaMeta, type RoomInfo } from '@slana/shared';
import type { ChainGateway } from '../chain/types';
import type { ServerConfig } from '../config';
import type { Conn } from '../net/conn';
import { Room, type RoomDeps } from './room';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly conns = new Set<Conn>();
  private freeCounter = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastCleanup = Date.now();
  private arenaCache: { at: number; ids: Map<number, { buyIn: number; maxPlayers: number; enabled: boolean }> } | null = null;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly deps: RoomDeps,
    private readonly chain: ChainGateway,
  ) {
    this.createFree();
  }

  /* ---------------------------------------------------------------- */
  /* Rooms                                                            */
  /* ---------------------------------------------------------------- */

  private createFree(): Room {
    const n = ++this.freeCounter;
    const room = new Room(
      {
        id: `free-${n}`,
        mode: 'free',
        name: `Coin Pond #${n}`,
        maxPlayers: this.cfg.freeRoomCapacity,
        bots: { target: this.cfg.bots.target, min: this.cfg.bots.min, max: this.cfg.bots.max },
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /** Busiest free room that still has space (so players meet each other). */
  freeRoom(prefer?: Room | null): Room {
    if (prefer && prefer.opts.mode === 'free' && !prefer.isFull) return prefer;
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.opts.mode !== 'free' || r.isFull) continue;
      if (!best || r.humans.size > best.humans.size) best = r;
    }
    return best ?? this.createFree();
  }

  /** Default room for lobby spectators. */
  lobbyRoom(): Room {
    let best: Room | null = null;
    for (const r of this.rooms.values()) if (r.opts.mode === 'free' && (!best || r.humans.size > best.humans.size)) best = r;
    return best ?? this.createFree();
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
        bots: { target: this.cfg.bots.privateTarget, min: 2, max: this.cfg.bots.privateTarget },
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  private async arenas(): Promise<Map<number, { buyIn: number; maxPlayers: number; enabled: boolean }>> {
    if (this.arenaCache && Date.now() - this.arenaCache.at < 30_000) return this.arenaCache.ids;
    const list = await this.chain.listArenas();
    const ids = new Map(list.map((a) => [a.id, { buyIn: a.buyIn, maxPlayers: a.maxPlayers, enabled: a.enabled }]));
    this.arenaCache = { at: Date.now(), ids };
    return ids;
  }

  /** Stake room for an on-chain arena (created lazily). */
  async stakeRoom(arenaId: number): Promise<Room | null> {
    if (!this.chain.stakeEnabled) return null;
    if (this.cfg.chain.arenaIds.length > 0 && !this.cfg.chain.arenaIds.includes(arenaId)) return null;
    const existing = this.rooms.get(`stake-${arenaId}`);
    if (existing) return existing;
    const arena = (await this.arenas()).get(arenaId);
    if (!arena || !arena.enabled) return null;
    const meta = arenaMeta(arenaId);
    const room = new Room(
      {
        id: `stake-${arenaId}`,
        mode: 'stake',
        name: meta.name.en,
        maxPlayers: arena.maxPlayers,
        bots: null,
        stake: { arenaId, buyIn: arena.buyIn },
      },
      this.deps,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /** Make sure stake rooms exist for every enabled arena (shown in the lobby). */
  async ensureStakeRooms(): Promise<void> {
    if (!this.chain.stakeEnabled) return;
    try {
      for (const [id, a] of await this.arenas()) if (a.enabled) await this.stakeRoom(id);
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
    for (const room of [...this.rooms.values()]) {
      const idle = room.conns.size === 0 && room.humans.size === 0;
      if (!idle) continue;
      if (room.opts.mode === 'private' && now - room.lastActivity > 120_000) this.rooms.delete(room.id);
      if (room.opts.mode === 'free' && room.id !== 'free-1' && now - room.lastActivity > 300_000) this.rooms.delete(room.id);
    }
  }

  shutdown(): void {
    this.stop();
    for (const room of this.rooms.values()) room.shutdown();
  }
}
