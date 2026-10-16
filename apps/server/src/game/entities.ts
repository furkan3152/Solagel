import { EntityKind, PowerUpType, RULES, massToRadius } from '@slana/shared';
import type { Gridded } from './grid';

export abstract class Entity implements Gridded {
  abstract readonly kind: EntityKind;
  x: number;
  y: number;
  r: number;
  mass: number;
  /** Tick number of the last visible change (position, radius, flags). */
  version: number;
  removed = false;
  gk = -1;

  constructor(
    readonly id: number,
    x: number,
    y: number,
    mass: number,
    r: number,
    tick: number,
  ) {
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.r = r;
    this.version = tick;
  }
}

export class Cell extends Entity {
  readonly kind = EntityKind.Cell;
  /** Boost velocity (split / virus pop launch), decays every tick. */
  vx = 0;
  vy = 0;
  /** Simulation time after which this cell may merge with siblings. */
  mergeAt: number;
  /** Own-cell collisions are skipped until this time. */
  noCollideUntil = 0;
  flags = 0;

  constructor(
    id: number,
    readonly player: Player,
    x: number,
    y: number,
    mass: number,
    tick: number,
    now: number,
  ) {
    super(id, x, y, mass, massToRadius(mass), tick);
    this.mergeAt = now;
  }

  setMass(mass: number): void {
    this.mass = mass;
    this.r = massToRadius(mass);
  }
}

export class Food extends Entity {
  readonly kind = EntityKind.Food;
  constructor(
    id: number,
    x: number,
    y: number,
    mass: number,
    r: number,
    readonly variant: number,
    tick: number,
  ) {
    super(id, x, y, mass, r, tick);
  }
}

export class Eject extends Entity {
  readonly kind = EntityKind.Eject;
  vx: number;
  vy: number;
  constructor(
    id: number,
    x: number,
    y: number,
    mass: number,
    vx: number,
    vy: number,
    readonly ownerId: number,
    readonly skin: number,
    readonly bornAt: number,
    tick: number,
  ) {
    super(id, x, y, mass, massToRadius(mass), tick);
    this.vx = vx;
    this.vy = vy;
  }
}

export class Virus extends Entity {
  readonly kind = EntityKind.Virus;
  vx = 0;
  vy = 0;
  /** Direction of the most recent feed: new viruses are shot this way. */
  feedAngle = 0;
  constructor(id: number, x: number, y: number, mass: number, tick: number) {
    super(id, x, y, mass, massToRadius(mass), tick);
  }

  setMass(mass: number): void {
    this.mass = mass;
    this.r = massToRadius(mass);
  }
}

export class PowerUp extends Entity {
  readonly kind = EntityKind.PowerUp;
  constructor(
    id: number,
    x: number,
    y: number,
    readonly type: PowerUpType,
    readonly bornAt: number,
    readonly expiresAt: number,
    tick: number,
  ) {
    super(id, x, y, 0, 42, tick);
  }
}

/**
 * Arena tokens spilled when a bot eats a staker. Only humans can pick it up;
 * it bursts out, slows down by friction and then lies on the floor forever.
 */
export class Loot extends Entity {
  readonly kind = EntityKind.Loot;
  constructor(
    id: number,
    x: number,
    y: number,
    /** Raw token units (a positive safe integer). */
    readonly value: number,
    public vx: number,
    public vy: number,
    tick: number,
  ) {
    super(id, x, y, 0, RULES.lootRadius, tick);
  }
}

export type StaticEntity = Food | Virus | PowerUp | Loot;
export type DynamicEntity = Cell | Eject;
export type AnyEntity = StaticEntity | DynamicEntity;

export interface PlayerStats {
  joinedAt: number;
  maxMass: number;
  foodEaten: number;
  cellsEaten: number;
  playersEaten: number;
  bestRank: number;
}

export class Player {
  cells: Cell[] = [];
  targetX: number;
  targetY: number;
  /** Queued split presses (processed at the start of the next tick). */
  splitQueued = 0;
  ejectQueued = false;
  lastEjectAt = -Infinity;
  alive = true;

  magnetUntil = 0;
  pumpUntil = 0;
  shieldUntil = 0;
  /** Stake rooms: disconnected and waiting for a reconnect. */
  afk = false;

  stats: PlayerStats;

  constructor(
    readonly id: number,
    public name: string,
    public skin: number,
    public flags: number,
    readonly isBot: boolean,
    now: number,
    x: number,
    y: number,
  ) {
    this.targetX = x;
    this.targetY = y;
    this.stats = { joinedAt: now, maxMass: 0, foodEaten: 0, cellsEaten: 0, playersEaten: 0, bestRank: Infinity };
  }

  totalMass(): number {
    let m = 0;
    for (const c of this.cells) m += c.mass;
    return m;
  }

  /** Mass-weighted centre of all cells (falls back to the target when dead). */
  center(): { x: number; y: number } {
    let m = 0;
    let x = 0;
    let y = 0;
    for (const c of this.cells) {
      m += c.mass;
      x += c.x * c.mass;
      y += c.y * c.mass;
    }
    return m > 0 ? { x: x / m, y: y / m } : { x: this.targetX, y: this.targetY };
  }

  biggestCell(): Cell | undefined {
    let best: Cell | undefined;
    for (const c of this.cells) if (!best || c.mass > best.mass) best = c;
    return best;
  }
}
