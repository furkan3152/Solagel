import {
  BOOST_RULES,
  CellFlag,
  boostDurationMs,
  shockRange,
  type BoostKind,
  EntityKind,
  FOOD_GEM,
  FOOD_GOLD,
  FOOD_MASS,
  PowerUpType,
  RULES,
  boostDecayFactor,
  canEat,
  clamp,
  coversVictim,
  massToRadius,
  mergeDelayMs,
  radiusToMass,
  speedForRadius,
} from '@elymum/shared';
import { Cell, Eject, Food, Loot, Player, PowerUp, Virus, type DynamicEntity, type StaticEntity } from './entities';
import { Grid } from './grid';
import { mulberry32, randRange, type Rng } from './rng';

export interface WorldConfig {
  width: number;
  height: number;
  foodTarget: number;
  virusTarget: number;
  maxPowerUps: number;
  powerUps: boolean;
  coinRain: boolean;
  seed?: number;
  /** Override for tests: first coin rain delay (ms). */
  firstCoinRainMs?: number;
}

export type DeathCause = 'eat' | 'virus' | 'left';

export interface KillEvent {
  killer: Player | null;
  victim: Player;
  cause: DeathCause;
}

export interface CellEatenEvent {
  eater: Player;
  victim: Player;
  /** Mass of the eaten cell. */
  mass: number;
  /** Victim's total mass immediately before this cell was eaten. */
  victimTotalBefore: number;
  /** True when this was the victim's last cell. */
  last: boolean;
  /** Where the eaten cell was. */
  x: number;
  y: number;
}

export interface TickEvents {
  kills: KillEvent[];
  cellsEaten: CellEatenEvent[];
  pops: { player: Player; x: number; y: number }[];
  pickups: { player: Player; type: PowerUpType; until: number }[];
  airdrops: { x: number; y: number; type: PowerUpType }[];
  coinRain: 'start' | 'end' | null;
  /** Loot picked up by human players this tick. */
  lootPicked: { pid: number; lootId: number; value: number }[];
  /** Ejected blobs eaten by another player's cell this tick (integrity telemetry: who fed whom). */
  ejectsEaten: { ownerId: number; eaterId: number }[];
}

const FOOD_RADIUS = [10, 10, 10, 10, 10, 10, 12, 16];
const STATIC_MAX_R = 150;
const POWERUP_TYPES = [PowerUpType.Magnet, PowerUpType.Pump, PowerUpType.Shield, PowerUpType.Bag];
const POWERUP_LIFETIME_MS = 45_000;
const COIN_RAIN_MS = 25_000;
const COIN_RAIN_EVERY_MS = 240_000;
/** A thorn bush that was eaten grows back after this long (one at a time). */
const VIRUS_REGROW_MS = 4_000;
/** Thorn bushes never grow this close to a cell's edge (nor on a fresh spawn). */
const VIRUS_CELL_CLEARANCE = 160;
/** A spawn spot keeps this much room around thorn bushes. */
const SPAWN_VIRUS_CLEARANCE = 220;
/** Approximate flight distance of a freshly split half (boost only). */
const SPLIT_REACH = RULES.splitSpeed / -Math.log(RULES.splitDecayPerSec);

const emptyEvents = (): TickEvents => ({ kills: [], cellsEaten: [], pops: [], pickups: [], airdrops: [], coinRain: null, lootPicked: [], ejectsEaten: [] });

export interface AddPlayerOptions {
  name: string;
  skin: number;
  flags?: number;
  isBot?: boolean;
  /** Fixed spawn position (tests); otherwise a safe spot is chosen. */
  x?: number;
  y?: number;
  mass?: number;
  /** Brief invulnerability after spawning (default true). */
  spawnShield?: boolean;
}

/**
 * Authoritative agar-style simulation. Time is driven by `tick(dtMs)` so the
 * world is fully deterministic for a given seed and input sequence.
 */
export class World {
  readonly rng: Rng;
  now = 0;
  tickCount = 0;

  readonly players = new Map<number, Player>();
  readonly cells: Cell[] = [];
  readonly ejects: Eject[] = [];
  readonly viruses: Virus[] = [];
  readonly powerUps: PowerUp[] = [];
  private readonly lootList: Loot[] = [];
  foodCount = 0;

  /** Food, viruses and power-ups (rarely move). */
  readonly staticGrid: Grid<StaticEntity>;
  /** Player cells and ejected mass (rebuilt every tick). */
  readonly dynGrid: Grid<DynamicEntity>;
  /** All live entities by id (used by visibility / bots). */
  readonly entities = new Map<number, StaticEntity | DynamicEntity>();

  /** Entities removed during the current tick: id → eater entity id (0 = none). */
  removed = new Map<number, number>();
  events: TickEvents = emptyEvents();

  coinRainUntil = 0;
  private nextCoinRainAt: number;
  private nextAirdropAt: number;
  private nextVirusAt = 0;
  private nextEntityId = 1;
  private nextPlayerId = 1;
  private maxCellRadius = 0;
  private foodBudget = 0;
  private lastDtMs = 0;

  constructor(readonly cfg: WorldConfig) {
    this.rng = mulberry32(cfg.seed ?? (Date.now() ^ 0x5eed) >>> 0);
    this.staticGrid = new Grid(cfg.width, cfg.height, 256);
    this.dynGrid = new Grid(cfg.width, cfg.height, 256);
    this.nextCoinRainAt = cfg.firstCoinRainMs ?? 150_000;
    this.nextAirdropAt = 15_000;
    this.fillFood(cfg.foodTarget);
    for (let i = 0; i < cfg.virusTarget; i++) this.spawnVirus();
  }

  /* ---------------------------------------------------------------- */
  /* Ids                                                              */
  /* ---------------------------------------------------------------- */

  private newEntityId(): number {
    const id = this.nextEntityId;
    this.nextEntityId = this.nextEntityId >= 0xfffffffe ? 1 : this.nextEntityId + 1;
    return id;
  }

  private newPlayerId(): number {
    for (let i = 0; i < 0xffff; i++) {
      const id = this.nextPlayerId;
      this.nextPlayerId = this.nextPlayerId >= 0xffff ? 1 : this.nextPlayerId + 1;
      if (!this.players.has(id)) return id;
    }
    throw new Error('player ids exhausted');
  }

  /* ---------------------------------------------------------------- */
  /* Players                                                          */
  /* ---------------------------------------------------------------- */

  addPlayer(opts: AddPlayerOptions): Player {
    const mass = opts.mass ?? RULES.startMass;
    const spot = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : this.findSpawnSpot(massToRadius(mass));
    const p = new Player(this.newPlayerId(), opts.name, opts.skin, opts.flags ?? 0, opts.isBot ?? false, this.now, spot.x, spot.y);
    this.players.set(p.id, p);
    this.addCell(p, spot.x, spot.y, mass);
    p.stats.maxMass = mass;
    if (opts.spawnShield ?? true) p.shieldUntil = this.now + RULES.spawnShieldMs;
    return p;
  }

  /** Removes a player and all of their cells (no eater). */
  removePlayer(pid: number): Player | undefined {
    const p = this.players.get(pid);
    if (!p) return undefined;
    for (const c of [...p.cells]) this.removeCell(c, 0);
    p.alive = false;
    this.players.delete(pid);
    return p;
  }

  setTarget(pid: number, x: number, y: number): void {
    const p = this.players.get(pid);
    if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // allow aiming a little outside the world, never absurdly far
    const m = 2000;
    p.targetX = clamp(x, -m, this.cfg.width + m);
    p.targetY = clamp(y, -m, this.cfg.height + m);
  }

  queueSplit(pid: number): void {
    const p = this.players.get(pid);
    if (p && p.splitQueued < 4) p.splitQueued++;
  }

  queueEject(pid: number): void {
    const p = this.players.get(pid);
    if (p) p.ejectQueued = true;
  }

  /**
   * Applies a bought power-up (the room checked charges, cooldowns and limits). Magnet and Speed
   * start now (they add to a running map power-up of the same kind); the Shockwave fires at the
   * start of the next tick. False when the player is not alive (nothing happened).
   */
  useBoost(pid: number, kind: BoostKind): boolean {
    const p = this.players.get(pid);
    if (!p || !p.alive || p.cells.length === 0) return false;
    switch (kind) {
      case 'magnet':
        p.magnetUntil = Math.max(p.magnetUntil, this.now) + boostDurationMs('magnet');
        return true;
      case 'speed':
        p.pumpUntil = Math.max(p.pumpUntil, this.now) + boostDurationMs('speed');
        return true;
      case 'shock':
        p.shockQueued = true;
        return true;
    }
    return false;
  }

  /**
   * Shockwave: every coin of another player within `shockRange` of one of `p`'s cells and at most
   * `massRatio` times that cell's mass is launched straight away from it (a split-like boost that
   * decays), and food and ejected mass in reach are pushed out too. Thorn bushes, loot and bigger
   * coins do not move. Pushed coins get `graceMs` in which they neither eat nor are eaten by any
   * coin, so the push never feeds the user (or a third player) a kill. No mass changes hands.
   */
  private fireShock(p: Player): void {
    const s = BOOST_RULES.shock;
    p.shockFxUntil = this.now + s.fxMs;
    const graceUntil = this.now + s.graceMs;
    for (const c of p.cells) {
      if (c.removed) continue;
      const R = shockRange(c.r);
      // the grid was built last tick: a little slack for what moved since
      const pad = R + this.maxCellRadius + 64;
      this.dynGrid.forEachIn(c.x - pad, c.y - pad, c.x + pad, c.y + pad, (e) => {
        if (e.removed) return;
        const dx = e.x - c.x;
        const dy = e.y - c.y;
        const d = Math.hypot(dx, dy);
        if (e.kind === EntityKind.Cell) {
          if (e.player === p || d - e.r >= R || e.mass > c.mass * s.massRatio) return;
        } else if (d >= R) return;
        let ux = 1;
        let uy = 0;
        if (d > 1e-6) {
          ux = dx / d;
          uy = dy / d;
        } else {
          const a = this.rng() * Math.PI * 2;
          ux = Math.cos(a);
          uy = Math.sin(a);
        }
        const speed = s.pushSpeed * (0.4 + 0.6 * clamp(1 - d / R, 0, 1));
        e.vx += ux * speed;
        e.vy += uy * speed;
        if (e.kind === EntityKind.Cell) e.pushedUntil = Math.max(e.pushedUntil, graceUntil);
        e.version = this.tickCount;
      });
      this.staticGrid.forEachIn(c.x - R, c.y - R, c.x + R, c.y + R, (f) => {
        if (f.kind !== EntityKind.Food || f.removed) return;
        const dx = f.x - c.x;
        const dy = f.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d >= R) return;
        const ux = d > 1e-6 ? dx / d : 1;
        const uy = d > 1e-6 ? dy / d : 0;
        const nd = d + (R - d) * s.foodPush;
        f.x = clamp(c.x + ux * nd, f.r, this.cfg.width - f.r);
        f.y = clamp(c.y + uy * nd, f.r, this.cfg.height - f.r);
        f.version = this.tickCount;
        this.staticGrid.update(f);
      });
    }
  }

  /**
   * Picks a spawn location far from anything that could eat a newborn cell. Every cell that could
   * eat it counts with its reach: its split lunge (when a half could still eat the newborn) plus
   * how far it travels while the spawn shield is up, so big cells are kept clearly away.
   */
  findSpawnSpot(radius: number): { x: number; y: number } {
    const { width, height } = this.cfg;
    const margin = Math.min(300, width / 4);
    const newborn = radiusToMass(radius);
    const shieldS = RULES.spawnShieldMs / 1000;
    let best = { x: width / 2, y: height / 2 };
    let bestScore = -Infinity;
    for (let i = 0; i < 64; i++) {
      const x = randRange(this.rng, margin, width - margin);
      const y = randRange(this.rng, margin, height - margin);
      let score = 4000;
      for (const c of this.cells) {
        if (!canEat(c.mass, newborn)) continue;
        const gap = Math.hypot(c.x - x, c.y - y) - c.r - radius;
        const reach = (canEat(c.mass / 2, newborn) ? SPLIT_REACH : 0) + speedForRadius(c.r) * shieldS * 0.5;
        score = Math.min(score, gap - reach);
      }
      for (const v of this.viruses) {
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < v.r + radius + SPAWN_VIRUS_CLEARANCE) score -= 1000;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- */
  /* Entity helpers                                                   */
  /* ---------------------------------------------------------------- */

  private addCell(p: Player, x: number, y: number, mass: number): Cell {
    const c = new Cell(this.newEntityId(), p, x, y, mass, this.tickCount, this.now);
    p.cells.push(c);
    this.cells.push(c);
    this.entities.set(c.id, c);
    this.dynGrid.insert(c);
    return c;
  }

  private removeCell(c: Cell, eaterId: number): void {
    if (c.removed) return;
    c.removed = true;
    const owned = c.player.cells;
    const i = owned.indexOf(c);
    if (i >= 0) owned.splice(i, 1);
    this.dynGrid.remove(c);
    this.entities.delete(c.id);
    this.removed.set(c.id, eaterId);
    // this.cells is compacted once per tick
  }

  private removeStatic(e: StaticEntity, eaterId: number): void {
    if (e.removed) return;
    e.removed = true;
    this.staticGrid.remove(e);
    this.entities.delete(e.id);
    this.removed.set(e.id, eaterId);
    if (e.kind === EntityKind.Food) this.foodCount--;
  }

  private removeEject(e: Eject, eaterId: number): void {
    if (e.removed) return;
    e.removed = true;
    this.dynGrid.remove(e);
    this.entities.delete(e.id);
    this.removed.set(e.id, eaterId);
  }

  spawnFood(x?: number, y?: number, forceVariant?: number): Food {
    const roll = this.rng();
    const goldChance = this.now < this.coinRainUntil ? 0.22 : 0.02;
    const variant =
      forceVariant ??
      (roll < goldChance ? FOOD_GOLD : roll < goldChance + 0.08 ? FOOD_GEM : Math.floor(this.rng() * 6));
    const f = new Food(
      this.newEntityId(),
      x ?? randRange(this.rng, 20, this.cfg.width - 20),
      y ?? randRange(this.rng, 20, this.cfg.height - 20),
      FOOD_MASS[variant],
      FOOD_RADIUS[variant],
      variant,
      this.tickCount,
    );
    this.staticGrid.insert(f);
    this.entities.set(f.id, f);
    this.foodCount++;
    return f;
  }

  private fillFood(count: number): void {
    for (let i = 0; i < count; i++) this.spawnFood();
  }

  spawnVirus(x?: number, y?: number): Virus | null {
    const r = massToRadius(RULES.virusMass);
    let vx = x;
    let vy = y;
    if (vx === undefined || vy === undefined) {
      // avoid spawning on top of a cell
      for (let attempt = 0; attempt < 10; attempt++) {
        const cx = randRange(this.rng, r * 2, this.cfg.width - r * 2);
        const cy = randRange(this.rng, r * 2, this.cfg.height - r * 2);
        let ok = true;
        for (const c of this.cells) {
          if (Math.hypot(c.x - cx, c.y - cy) < c.r + r + VIRUS_CELL_CLEARANCE) {
            ok = false;
            break;
          }
        }
        if (ok) {
          vx = cx;
          vy = cy;
          break;
        }
      }
      if (vx === undefined || vy === undefined) return null;
    }
    const v = new Virus(this.newEntityId(), vx, vy, RULES.virusMass, this.tickCount);
    this.viruses.push(v);
    this.staticGrid.insert(v);
    this.entities.set(v.id, v);
    return v;
  }

  spawnPowerUp(type?: PowerUpType, x?: number, y?: number): PowerUp {
    const t = type ?? POWERUP_TYPES[Math.floor(this.rng() * POWERUP_TYPES.length)];
    const pu = new PowerUp(
      this.newEntityId(),
      x ?? randRange(this.rng, 200, this.cfg.width - 200),
      y ?? randRange(this.rng, 200, this.cfg.height - 200),
      t,
      this.now,
      this.now + POWERUP_LIFETIME_MS,
      this.tickCount,
    );
    this.powerUps.push(pu);
    this.staticGrid.insert(pu);
    this.entities.set(pu.id, pu);
    return pu;
  }

  /**
   * Spills `total` token units as `pieces` loot pieces bursting out of (x, y)
   * at `RULES.lootSpeed` in random directions. Piece values sum exactly to
   * `total` (the division remainder goes on the first piece); there are
   * never more pieces than units.
   */
  spawnLoot(x: number, y: number, total: number, pieces: number): void {
    if (!Number.isSafeInteger(total) || total <= 0) return;
    const n = Math.max(1, Math.min(total, Math.floor(Number.isFinite(pieces) ? pieces : 1)));
    const each = Math.floor(total / n);
    const first = total - each * (n - 1);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      this.addLoot(x, y, i === 0 ? first : each, Math.cos(a) * RULES.lootSpeed, Math.sin(a) * RULES.lootSpeed);
    }
  }

  /** Puts loot back at rest (crash recovery). */
  restoreLoot(items: { x: number; y: number; value: number }[]): void {
    for (const it of items) {
      if (!Number.isSafeInteger(it.value) || it.value <= 0) continue;
      this.addLoot(Number.isFinite(it.x) ? it.x : this.cfg.width / 2, Number.isFinite(it.y) ? it.y : this.cfg.height / 2, it.value, 0, 0);
    }
  }

  /** Removes every loot piece from the floor and returns their total value (round end: it is burned). */
  takeLoot(): number {
    let sum = 0;
    for (const l of this.lootList) {
      sum += l.value;
      this.removeStatic(l, 0);
    }
    this.lootList.length = 0;
    return sum;
  }

  /** Round reset: clears the ejected mass lying around (players are removed by their owners). */
  clearEjects(): void {
    for (const e of this.ejects) this.removeEject(e, 0);
    this.ejects.length = 0;
  }

  /** Loot currently on the floor. */
  loot(): { id: number; x: number; y: number; value: number }[] {
    return this.lootList.map((l) => ({ id: l.id, x: l.x, y: l.y, value: l.value }));
  }

  private addLoot(x: number, y: number, value: number, vx: number, vy: number): Loot {
    const r = RULES.lootRadius;
    const l = new Loot(this.newEntityId(), clamp(x, r, this.cfg.width - r), clamp(y, r, this.cfg.height - r), value, vx, vy, this.tickCount);
    this.lootList.push(l);
    this.staticGrid.insert(l);
    this.entities.set(l.id, l);
    return l;
  }

  private moveLoot(dt: number): void {
    if (this.lootList.length === 0) return;
    const keep = Math.pow(RULES.lootFrictionPerSec, dt);
    for (const l of this.lootList) {
      if (l.vx === 0 && l.vy === 0) continue;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.vx *= keep;
      l.vy *= keep;
      if (l.vx * l.vx + l.vy * l.vy < 25) {
        l.vx = 0;
        l.vy = 0;
      }
      if (l.x < l.r || l.x > this.cfg.width - l.r) l.vx = -l.vx;
      if (l.y < l.r || l.y > this.cfg.height - l.r) l.vy = -l.vy;
      l.x = clamp(l.x, l.r, this.cfg.width - l.r);
      l.y = clamp(l.y, l.r, this.cfg.height - l.r);
      this.staticGrid.update(l);
      l.version = this.tickCount;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tick                                                             */
  /* ---------------------------------------------------------------- */

  tick(dtMs: number): TickEvents {
    this.tickCount++;
    this.now += dtMs;
    this.lastDtMs = dtMs;
    this.removed = new Map();
    this.events = emptyEvents();
    const dt = dtMs / 1000;

    this.processInputs();
    this.moveCells(dt, dtMs);
    this.moveEjectsAndViruses(dt, dtMs);
    this.moveLoot(dt);
    this.rebuildDynamicGrid();
    this.resolveOwnCells(dt);
    this.applyMagnets(dt);
    this.eatStatic();
    this.eatDynamic();
    this.feedViruses();
    this.decayAndCap(dt);
    this.compact();
    this.updateFlagsAndStats();
    this.spawnStuff();
    return this.events;
  }

  private processInputs(): void {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      // two split passes per tick at most (fast double-split still works across ticks)
      let passes = Math.min(p.splitQueued, 2);
      p.splitQueued -= passes;
      while (passes-- > 0) this.splitPlayer(p);
      if (p.shockQueued) {
        p.shockQueued = false;
        this.fireShock(p);
      }
      if (p.ejectQueued) {
        p.ejectQueued = false;
        if (this.now - p.lastEjectAt >= RULES.ejectCooldownMs) {
          p.lastEjectAt = this.now;
          this.ejectFrom(p);
        }
      }
    }
  }

  private aimDir(p: Player, from: { x: number; y: number }): { dx: number; dy: number } {
    const dx = p.targetX - from.x;
    const dy = p.targetY - from.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) {
      const a = this.rng() * Math.PI * 2;
      return { dx: Math.cos(a), dy: Math.sin(a) };
    }
    return { dx: dx / d, dy: dy / d };
  }

  splitPlayer(p: Player): void {
    const sorted = [...p.cells].sort((a, b) => b.mass - a.mass);
    for (const c of sorted) {
      if (p.cells.length >= RULES.maxCells) break;
      if (c.mass < RULES.splitMinMass) continue;
      const half = c.mass / 2;
      const { dx, dy } = this.aimDir(p, c);
      c.setMass(half);
      const n = this.addCell(p, c.x + dx * 2, c.y + dy * 2, half);
      n.vx = dx * RULES.splitSpeed;
      n.vy = dy * RULES.splitSpeed;
      const mergeAt = this.now + mergeDelayMs(half * 2);
      n.mergeAt = mergeAt;
      c.mergeAt = Math.max(c.mergeAt, mergeAt);
      n.noCollideUntil = this.now + RULES.splitNoCollideMs;
      c.noCollideUntil = n.noCollideUntil;
      c.version = this.tickCount;
    }
  }

  private ejectFrom(p: Player): void {
    for (const c of p.cells) {
      if (c.mass < RULES.ejectMinMass) continue;
      const { dx, dy } = this.aimDir(p, c);
      const jitter = (this.rng() - 0.5) * 0.25;
      const cos = Math.cos(jitter);
      const sin = Math.sin(jitter);
      const ex = dx * cos - dy * sin;
      const ey = dx * sin + dy * cos;
      c.setMass(c.mass - RULES.ejectCost);
      c.version = this.tickCount;
      const startDist = c.r + 6;
      this.spawnEject(c.x + ex * startDist, c.y + ey * startDist, ex * RULES.ejectSpeed, ey * RULES.ejectSpeed, p.id, p.skin);
    }
  }

  spawnEject(x: number, y: number, vx: number, vy: number, ownerId: number, skin: number): Eject {
    const e = new Eject(
      this.newEntityId(),
      clamp(x, 0, this.cfg.width),
      clamp(y, 0, this.cfg.height),
      RULES.ejectMass,
      vx,
      vy,
      ownerId,
      skin,
      this.now,
      this.tickCount,
    );
    this.ejects.push(e);
    this.entities.set(e.id, e);
    this.dynGrid.insert(e);
    return e;
  }

  private clampToWorld(e: { x: number; y: number; r: number }): void {
    const m = Math.min(e.r * 0.5, this.cfg.width / 2, this.cfg.height / 2);
    e.x = clamp(e.x, m, this.cfg.width - m);
    e.y = clamp(e.y, m, this.cfg.height - m);
  }

  private moveCells(dt: number, dtMs: number): void {
    const decay = boostDecayFactor(dtMs);
    for (const p of this.players.values()) {
      if (p.cells.length === 0) continue;
      const speedMul = p.pumpUntil > this.now ? RULES.pumpSpeedMul : 1;
      for (const c of p.cells) {
        const ox = c.x;
        const oy = c.y;
        const dx = p.targetX - c.x;
        const dy = p.targetY - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.5) {
          const ease = Math.min(1, dist / 48);
          const step = speedForRadius(c.r) * speedMul * ease * dt;
          const move = Math.min(step, dist);
          c.x += (dx / dist) * move;
          c.y += (dy / dist) * move;
        }
        if (c.vx !== 0 || c.vy !== 0) {
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.vx *= decay;
          c.vy *= decay;
          if (c.vx * c.vx + c.vy * c.vy < 25) {
            c.vx = 0;
            c.vy = 0;
          }
        }
        this.clampToWorld(c);
        if (c.x !== ox || c.y !== oy) c.version = this.tickCount;
      }
    }
  }

  private moveEjectsAndViruses(dt: number, dtMs: number): void {
    const decay = boostDecayFactor(dtMs);
    for (const e of this.ejects) {
      if (e.removed || (e.vx === 0 && e.vy === 0)) continue;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vx *= decay;
      e.vy *= decay;
      if (e.vx * e.vx + e.vy * e.vy < 25) {
        e.vx = 0;
        e.vy = 0;
      }
      // bounce off the world border
      if (e.x < e.r || e.x > this.cfg.width - e.r) e.vx = -e.vx;
      if (e.y < e.r || e.y > this.cfg.height - e.r) e.vy = -e.vy;
      e.x = clamp(e.x, e.r, this.cfg.width - e.r);
      e.y = clamp(e.y, e.r, this.cfg.height - e.r);
      e.version = this.tickCount;
    }
    for (const v of this.viruses) {
      if (v.removed || (v.vx === 0 && v.vy === 0)) continue;
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.vx *= decay;
      v.vy *= decay;
      if (v.vx * v.vx + v.vy * v.vy < 25) {
        v.vx = 0;
        v.vy = 0;
      }
      if (v.x < v.r || v.x > this.cfg.width - v.r) v.vx = -v.vx;
      if (v.y < v.r || v.y > this.cfg.height - v.r) v.vy = -v.vy;
      v.x = clamp(v.x, v.r, this.cfg.width - v.r);
      v.y = clamp(v.y, v.r, this.cfg.height - v.r);
      this.staticGrid.update(v);
      v.version = this.tickCount;
    }
  }

  private rebuildDynamicGrid(): void {
    this.dynGrid.clear();
    let maxR = 0;
    for (const c of this.cells) {
      if (c.removed) continue;
      this.dynGrid.insert(c);
      if (c.r > maxR) maxR = c.r;
    }
    for (const e of this.ejects) if (!e.removed) this.dynGrid.insert(e);
    this.maxCellRadius = maxR;
  }

  /** Pushes a player's own cells apart, or merges them once their cooldown is over. */
  private resolveOwnCells(dt: number): void {
    for (const p of this.players.values()) {
      const cells = p.cells;
      if (cells.length < 2) continue;
      const center = p.center();
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        if (a.removed) continue;
        // cohesion: once mergeable, drift toward the group's centre
        if (this.now >= a.mergeAt) {
          const dx = center.x - a.x;
          const dy = center.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > 1) {
            const pull = Math.min(d, speedForRadius(a.r) * 0.35 * dt);
            a.x += (dx / d) * pull;
            a.y += (dy / d) * pull;
          }
        }
        for (let j = i + 1; j < cells.length; j++) {
          const b = cells[j];
          if (b.removed || a.removed) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const sum = a.r + b.r;
          if (d >= sum) continue;
          const mergeable = this.now >= a.mergeAt && this.now >= b.mergeAt;
          if (mergeable) {
            const big = a.mass >= b.mass ? a : b;
            const small = big === a ? b : a;
            if (d < big.r - small.r * 0.3 || d < big.r * 0.6) {
              big.setMass(big.mass + small.mass);
              big.version = this.tickCount;
              this.removeCell(small, big.id);
            }
            continue;
          }
          if (this.now < a.noCollideUntil || this.now < b.noCollideUntil) continue;
          if (d < 1e-6) {
            const ang = this.rng() * Math.PI * 2;
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            d = 1;
          } else {
            dx /= d;
            dy /= d;
          }
          const overlap = sum - d;
          const total = a.mass + b.mass;
          const pushA = overlap * (b.mass / total);
          const pushB = overlap * (a.mass / total);
          a.x -= dx * pushA;
          a.y -= dy * pushA;
          b.x += dx * pushB;
          b.y += dy * pushB;
        }
      }
      for (const c of cells) {
        this.clampToWorld(c);
        c.version = this.tickCount;
      }
    }
  }

  private applyMagnets(dt: number): void {
    for (const p of this.players.values()) {
      if (p.magnetUntil <= this.now) continue;
      for (const c of p.cells) {
        const range = c.r * RULES.magnetRangeFactor + 60;
        this.staticGrid.forEachIn(c.x - range, c.y - range, c.x + range, c.y + range, (f) => {
          if (f.kind !== EntityKind.Food || f.removed) return;
          const dx = c.x - f.x;
          const dy = c.y - f.y;
          const d = Math.hypot(dx, dy);
          if (d > range || d < 1) return;
          const step = Math.min(d, 700 * dt);
          f.x += (dx / d) * step;
          f.y += (dy / d) * step;
          f.version = this.tickCount;
          this.staticGrid.update(f);
        });
      }
    }
  }

  /** Cells eat food, collect power-ups and pop viruses. */
  private eatStatic(): void {
    for (const c of this.cells) {
      if (c.removed) continue;
      const reach = c.r + STATIC_MAX_R;
      this.staticGrid.forEachIn(c.x - reach, c.y - reach, c.x + reach, c.y + reach, (e) => {
        if (e.removed || c.removed) return;
        const dx = e.x - c.x;
        const dy = e.y - c.y;
        const d2 = dx * dx + dy * dy;
        switch (e.kind) {
          case EntityKind.Food:
            if (d2 < c.r * c.r) {
              c.setMass(c.mass + e.mass);
              c.version = this.tickCount;
              c.player.stats.foodEaten++;
              this.removeStatic(e, c.id);
            }
            break;
          case EntityKind.Loot:
            // only humans pick loot (bots carry no value)
            if (!c.player.isBot && d2 < c.r * c.r) {
              this.removeStatic(e, c.id);
              const li = this.lootList.indexOf(e);
              if (li >= 0) this.lootList.splice(li, 1);
              this.events.lootPicked.push({ pid: c.player.id, lootId: e.id, value: e.value });
            }
            break;
          case EntityKind.PowerUp: {
            const reachPu = c.r + e.r * 0.5;
            if (d2 < reachPu * reachPu) this.collectPowerUp(c, e);
            break;
          }
          case EntityKind.Virus: {
            if (c.mass < e.mass * RULES.virusPopRatio) break;
            if (!coversVictim(c.r, e.r, Math.sqrt(d2))) break;
            this.removeStatic(e, c.id);
            const vi = this.viruses.indexOf(e);
            if (vi >= 0) this.viruses.splice(vi, 1);
            c.setMass(c.mass + e.mass);
            c.version = this.tickCount;
            this.popCell(c);
            break;
          }
        }
      });
    }
  }

  private collectPowerUp(c: Cell, pu: PowerUp): void {
    const p = c.player;
    this.removeStatic(pu, c.id);
    const idx = this.powerUps.indexOf(pu);
    if (idx >= 0) this.powerUps.splice(idx, 1);
    let until = this.now;
    switch (pu.type) {
      case PowerUpType.Magnet:
        until = p.magnetUntil = Math.max(p.magnetUntil, this.now) + RULES.magnetMs;
        break;
      case PowerUpType.Pump:
        until = p.pumpUntil = Math.max(p.pumpUntil, this.now) + RULES.pumpMs;
        break;
      case PowerUpType.Shield:
        until = p.shieldUntil = Math.max(p.shieldUntil, this.now) + RULES.shieldMs;
        break;
      case PowerUpType.Bag: {
        const bonus = clamp(p.totalMass() * RULES.bagMassFraction, RULES.bagMassMin, 300);
        c.setMass(c.mass + bonus);
        c.version = this.tickCount;
        break;
      }
    }
    this.events.pickups.push({ player: p, type: pu.type, until });
  }

  /** Virus pop: half the cell's mass bursts into up to 15 pieces flying outward. */
  private popCell(c: Cell): void {
    const p = c.player;
    const slots = RULES.maxCells - p.cells.length;
    this.events.pops.push({ player: p, x: c.x, y: c.y });
    if (slots <= 0) return;
    let pieces = Math.min(slots, RULES.virusMaxPieces);
    const explode = c.mass * RULES.virusPopFraction;
    let pieceMass = explode / pieces;
    if (pieceMass < 12) {
      pieces = Math.floor(explode / 12);
      pieceMass = 12;
    }
    if (pieces <= 0) return;
    c.setMass(c.mass - pieceMass * pieces);
    const mergeAt = this.now + mergeDelayMs(c.mass + pieceMass * pieces);
    c.mergeAt = Math.max(c.mergeAt, mergeAt);
    const base = this.rng() * Math.PI * 2;
    for (let i = 0; i < pieces; i++) {
      const a = base + (i / pieces) * Math.PI * 2 + (this.rng() - 0.5) * 0.3;
      const n = this.addCell(p, c.x, c.y, pieceMass);
      const speed = RULES.splitSpeed * (0.75 + this.rng() * 0.3);
      n.vx = Math.cos(a) * speed;
      n.vy = Math.sin(a) * speed;
      n.mergeAt = mergeAt;
      n.noCollideUntil = this.now + RULES.splitNoCollideMs;
    }
    c.noCollideUntil = this.now + RULES.splitNoCollideMs;
  }

  /** Cells eat other players' cells and ejected mass. Biggest cells act first. */
  private eatDynamic(): void {
    const order = this.cells.filter((c) => !c.removed).sort((a, b) => b.mass - a.mass);
    for (const a of order) {
      if (a.removed) continue;
      const ap = a.player;
      const aShield = ap.shieldUntil > this.now;
      const reach = a.r;
      this.dynGrid.forEachIn(a.x - reach, a.y - reach, a.x + reach, a.y + reach, (b) => {
        if (b === a || b.removed || a.removed) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (b.kind === EntityKind.Eject) {
          if (b.ownerId === ap.id && this.now - b.bornAt < RULES.ejectOwnerGraceMs) return;
          if (a.mass <= b.mass || d >= a.r - b.r * 0.3) return;
          a.setMass(a.mass + b.mass);
          a.version = this.tickCount;
          this.removeEject(b, a.id);
          if (b.ownerId !== ap.id) this.events.ejectsEaten.push({ ownerId: b.ownerId, eaterId: ap.id });
          return;
        }
        // other player's cell
        const bp = b.player;
        if (bp === ap) return;
        if (aShield || bp.shieldUntil > this.now) return;
        // a shockwave's push never feeds anyone: pushed coins neither eat nor are eaten for a moment
        if (a.pushedUntil > this.now || b.pushedUntil > this.now) return;
        if (!canEat(a.mass, b.mass) || !coversVictim(a.r, b.r, d)) return;
        const victimTotalBefore = bp.totalMass();
        const last = bp.cells.length === 1;
        const bx = b.x;
        const by = b.y;
        a.setMass(a.mass + b.mass);
        a.version = this.tickCount;
        ap.stats.cellsEaten++;
        this.removeCell(b, a.id);
        this.events.cellsEaten.push({ eater: ap, victim: bp, mass: b.mass, victimTotalBefore, last, x: bx, y: by });
        if (last) {
          ap.stats.playersEaten++;
          bp.alive = false;
          this.events.kills.push({ killer: ap, victim: bp, cause: 'eat' });
        }
      });
    }
  }

  /** Ejected mass that hits a virus feeds it; a full virus shoots a new one. */
  private feedViruses(): void {
    for (const e of this.ejects) {
      if (e.removed) continue;
      const reach = e.r + STATIC_MAX_R;
      this.staticGrid.forEachIn(e.x - reach, e.y - reach, e.x + reach, e.y + reach, (v) => {
        if (v.kind !== EntityKind.Virus || v.removed || e.removed) return;
        if (Math.hypot(v.x - e.x, v.y - e.y) >= v.r) return;
        const speed2 = e.vx * e.vx + e.vy * e.vy;
        v.feedAngle = speed2 > 1 ? Math.atan2(e.vy, e.vx) : Math.atan2(v.y - e.y, v.x - e.x);
        v.setMass(v.mass + e.mass);
        v.version = this.tickCount;
        this.removeEject(e, v.id);
        if (v.mass >= RULES.virusSplitMass) {
          v.setMass(RULES.virusMass);
          const nv = this.spawnVirus(v.x, v.y);
          if (nv) {
            nv.vx = Math.cos(v.feedAngle) * RULES.virusShootSpeed;
            nv.vy = Math.sin(v.feedAngle) * RULES.virusShootSpeed;
          }
        }
        return true;
      });
    }
  }

  private decayAndCap(dt: number): void {
    const rates = new Map<Player, number>();
    for (const c of this.cells) {
      if (c.removed) continue;
      if (c.mass > RULES.decayStartMass) {
        let rate = rates.get(c.player);
        if (rate === undefined) {
          rate = RULES.decayPerSec + RULES.decayPerSecPerMass * c.player.totalMass();
          rates.set(c.player, rate);
        }
        c.setMass(Math.max(RULES.decayStartMass, c.mass - (c.mass - RULES.decayStartMass * 0.5) * rate * dt));
        c.version = this.tickCount;
      }
      if (c.mass > RULES.maxCellMass && c.player.cells.length < RULES.maxCells) {
        // over the cap: auto-split toward the target
        const p = c.player;
        const half = c.mass / 2;
        const { dx, dy } = this.aimDir(p, c);
        c.setMass(half);
        const n = this.addCell(p, c.x + dx * 2, c.y + dy * 2, half);
        n.vx = dx * RULES.splitSpeed * 0.6;
        n.vy = dy * RULES.splitSpeed * 0.6;
        n.mergeAt = c.mergeAt = this.now + mergeDelayMs(half * 2);
        n.noCollideUntil = c.noCollideUntil = this.now + RULES.splitNoCollideMs;
      } else if (c.mass > RULES.maxCellMass) {
        c.setMass(RULES.maxCellMass);
      }
    }
  }

  /** Drops removed entities from the flat arrays and finalises deaths. */
  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!c.removed) this.cells[w++] = c;
    }
    this.cells.length = w;
    w = 0;
    for (let i = 0; i < this.ejects.length; i++) {
      const e = this.ejects[i];
      if (!e.removed) this.ejects[w++] = e;
    }
    this.ejects.length = w;
    for (const p of this.players.values()) {
      if (p.alive && p.cells.length === 0) {
        // died without a recorded killer (shouldn't normally happen)
        p.alive = false;
        this.events.kills.push({ killer: null, victim: p, cause: 'eat' });
      }
    }
  }

  private updateFlagsAndStats(): void {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      let flags = 0;
      if (p.shieldUntil > this.now) flags |= CellFlag.Shield;
      if (p.magnetUntil > this.now) flags |= CellFlag.Magnet;
      if (p.pumpUntil > this.now) flags |= CellFlag.Pump;
      if (p.shockFxUntil > this.now) flags |= CellFlag.Shock;
      if (p.afk) flags |= CellFlag.Afk;
      let total = 0;
      for (const c of p.cells) {
        total += c.mass;
        if (c.flags !== flags) {
          c.flags = flags;
          c.version = this.tickCount;
        }
      }
      if (total > p.stats.maxMass) p.stats.maxMass = total;
    }
  }

  private spawnStuff(): void {
    // coin rain event
    if (this.cfg.coinRain) {
      if (this.coinRainUntil > 0 && this.now >= this.coinRainUntil) {
        this.coinRainUntil = 0;
        this.events.coinRain = 'end';
      } else if (this.coinRainUntil === 0 && this.now >= this.nextCoinRainAt) {
        this.coinRainUntil = this.now + COIN_RAIN_MS;
        this.nextCoinRainAt = this.now + COIN_RAIN_EVERY_MS + randRange(this.rng, -30_000, 60_000);
        this.events.coinRain = 'start';
      }
    }
    const raining = this.coinRainUntil > this.now;
    const target = Math.round(this.cfg.foodTarget * (raining ? 1.35 : 1));
    const missing = target - this.foodCount;
    if (missing > 0) {
      // bigger worlds refill proportionally faster (the same refill per area)
      const scale = Math.max(1, this.cfg.foodTarget / RULES.foodRefillRefTarget);
      this.foodBudget += ((raining ? RULES.coinRainFoodPerSec : RULES.foodSpawnPerSec) * scale * this.lastDtMs) / 1000;
      const n = Math.min(missing, Math.floor(this.foodBudget));
      this.foodBudget -= n;
      for (let i = 0; i < n; i++) this.spawnFood();
    } else {
      this.foodBudget = 0;
    }

    if (this.viruses.length < this.cfg.virusTarget && this.now >= this.nextVirusAt) {
      this.spawnVirus();
      this.nextVirusAt = this.now + VIRUS_REGROW_MS;
    }

    // power-ups: expire old ones, airdrop new ones
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const pu = this.powerUps[i];
      if (pu.expiresAt <= this.now) {
        this.removeStatic(pu, 0);
        this.powerUps.splice(i, 1);
      }
    }
    if (this.cfg.powerUps && this.now >= this.nextAirdropAt) {
      this.nextAirdropAt = this.now + randRange(this.rng, 18_000, 36_000);
      if (this.powerUps.length < this.cfg.maxPowerUps) {
        const pu = this.spawnPowerUp();
        this.events.airdrops.push({ x: pu.x, y: pu.y, type: pu.type });
      }
    }
  }

  /**
   * Sheds a player's mass above `maxTotal`: `fraction` (0..1) of the excess goes, from every cell
   * in proportion (the shape stays). Used for the rookie league's bot mass cap.
   */
  shedMass(p: Player, maxTotal: number, fraction: number): void {
    const total = p.totalMass();
    if (!(total > maxTotal) || !(fraction > 0)) return;
    const k = (maxTotal + (total - maxTotal) * (1 - Math.min(1, fraction))) / total;
    for (const c of p.cells) {
      c.setMass(c.mass * k);
      c.version = this.tickCount;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Queries                                                          */
  /* ---------------------------------------------------------------- */

  /** Visits every entity that overlaps the rectangle. */
  forEachVisible(x0: number, y0: number, x1: number, y1: number, fn: (e: StaticEntity | DynamicEntity) => void): void {
    this.staticGrid.forEachIn(x0 - STATIC_MAX_R, y0 - STATIC_MAX_R, x1 + STATIC_MAX_R, y1 + STATIC_MAX_R, (e) => {
      if (!e.removed && e.x + e.r >= x0 && e.x - e.r <= x1 && e.y + e.r >= y0 && e.y - e.r <= y1) fn(e);
    });
    const pad = this.maxCellRadius;
    this.dynGrid.forEachIn(x0 - pad, y0 - pad, x1 + pad, y1 + pad, (e) => {
      if (!e.removed && e.x + e.r >= x0 && e.x - e.r <= x1 && e.y + e.r >= y0 && e.y - e.r <= y1) fn(e);
    });
  }

  /** Player ranking by total mass (descending). */
  ranking(): Player[] {
    return [...this.players.values()].filter((p) => p.alive && p.cells.length > 0).sort((a, b) => b.totalMass() - a.totalMass());
  }
}
