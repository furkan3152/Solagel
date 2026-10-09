import { EntityKind, PlayerFlag, type PlayerInfo, type SnapshotData } from '@solagel/shared';
import type { Expression } from '../render/faces';
import { JellyBody } from '../render/jelly';

/** Movement between two snapshots is eased over this window (classic agar feel). */
const LERP_MS = 120;
const DIE_MS = 160;

export interface CEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  r: number;
  ox: number;
  oy: number;
  or: number;
  nx: number;
  ny: number;
  nr: number;
  t0: number;
  playerId: number;
  flags: number;
  variant: number;
  born: number;
  /** >0 while playing the removal animation. */
  dying: number;
  eater: number;
  dieX: number;
  dieY: number;
  dieR: number;
  jelly: JellyBody | null;
  /** Smoothed velocity in units/s (drives eyes + jelly squash). */
  vx: number;
  vy: number;
  seed: number;
  expression: Expression;
}

export interface CPlayer extends PlayerInfo {
  emote: { id: number; at: number } | null;
}

export type EatEvent =
  | { type: 'food'; eaterId: number; x: number; y: number; variant: number; mine: boolean }
  | { type: 'eject'; eaterId: number; x: number; y: number; mine: boolean }
  | { type: 'cell'; eaterId: number; x: number; y: number; r: number; victimPid: number; eaterPid: number; mine: boolean; me: boolean }
  | { type: 'virus'; eaterId: number; x: number; y: number; mine: boolean }
  | { type: 'powerup'; eaterId: number; x: number; y: number; mine: boolean };

/** Client-side mirror of the visible world with interpolation. */
export class ClientWorld {
  readonly entities = new Map<number, CEntity>();
  readonly players = new Map<number, CPlayer>();
  myPid: number | null = null;
  serverView = { x: 0, y: 0, h: 1200, at: 0 };
  width = 5600;
  height = 5600;
  lastSnapshotAt = 0;
  private eatQueue: EatEvent[] = [];

  reset(): void {
    this.entities.clear();
    this.players.clear();
    this.myPid = null;
    this.eatQueue = [];
  }

  apply(s: SnapshotData, now: number): void {
    this.lastSnapshotAt = now;
    this.serverView = { ...s.view, at: now };
    for (const p of s.players) {
      const existing = this.players.get(p.id);
      this.players.set(p.id, { ...p, emote: existing?.emote ?? null });
    }
    for (const u of s.upserts) {
      const e = this.entities.get(u.id);
      if (!e || e.dying) {
        this.entities.set(u.id, {
          id: u.id,
          kind: u.kind,
          x: u.x,
          y: u.y,
          r: u.r,
          ox: u.x,
          oy: u.y,
          or: u.r,
          nx: u.x,
          ny: u.y,
          nr: u.r,
          t0: now,
          playerId: u.playerId ?? 0,
          flags: u.flags ?? 0,
          variant: u.variant ?? 0,
          born: now,
          dying: 0,
          eater: 0,
          dieX: 0,
          dieY: 0,
          dieR: 0,
          jelly: u.kind === EntityKind.Cell ? new JellyBody() : null,
          vx: 0,
          vy: 0,
          seed: (u.id * 2654435761) % 1000 / 1000,
          expression: 'happy',
        });
        continue;
      }
      e.ox = e.x;
      e.oy = e.y;
      e.or = e.r;
      e.nx = u.x;
      e.ny = u.y;
      e.nr = u.r;
      e.t0 = now;
      if (u.flags !== undefined) e.flags = u.flags;
      if (u.playerId !== undefined) e.playerId = u.playerId;
      if (u.variant !== undefined) e.variant = u.variant;
    }
    for (const rm of s.removals) {
      const e = this.entities.get(rm.id);
      if (!e || e.dying) continue;
      e.dying = now;
      e.eater = rm.eaterId;
      e.dieX = e.x;
      e.dieY = e.y;
      e.dieR = e.r;
      if (rm.eaterId) this.queueEat(e, rm.eaterId);
    }
  }

  private queueEat(e: CEntity, eaterId: number): void {
    const eater = this.entities.get(eaterId);
    const mine = !!eater && eater.kind === EntityKind.Cell && eater.playerId === this.myPid;
    switch (e.kind) {
      case EntityKind.Food:
        this.eatQueue.push({ type: 'food', eaterId, x: e.x, y: e.y, variant: e.variant, mine });
        break;
      case EntityKind.Eject:
        this.eatQueue.push({ type: 'eject', eaterId, x: e.x, y: e.y, mine });
        break;
      case EntityKind.Virus:
        if (eater?.kind === EntityKind.Cell) this.eatQueue.push({ type: 'virus', eaterId, x: e.x, y: e.y, mine });
        break;
      case EntityKind.PowerUp:
        this.eatQueue.push({ type: 'powerup', eaterId, x: e.x, y: e.y, mine });
        break;
      case EntityKind.Cell:
        if (eater && eater.playerId !== e.playerId) {
          this.eatQueue.push({
            type: 'cell',
            eaterId,
            x: e.x,
            y: e.y,
            r: e.r,
            victimPid: e.playerId,
            eaterPid: eater.playerId,
            mine,
            me: e.playerId === this.myPid,
          });
        }
        break;
    }
  }

  drainEats(): EatEvent[] {
    const q = this.eatQueue;
    this.eatQueue = [];
    return q;
  }

  /** Advances interpolation and removal animations. */
  update(now: number, dt: number): void {
    for (const e of this.entities.values()) {
      if (e.dying) {
        const p = Math.min(1, (now - e.dying) / DIE_MS);
        const eater = e.eater ? this.entities.get(e.eater) : undefined;
        if (eater && !eater.dying) {
          e.x = e.dieX + (eater.x - e.dieX) * p;
          e.y = e.dieY + (eater.y - e.dieY) * p;
        }
        e.r = e.dieR * (1 - p);
        if (p >= 1) this.entities.delete(e.id);
        continue;
      }
      const t = Math.min(1, (now - e.t0) / LERP_MS);
      const px = e.x;
      const py = e.y;
      e.x = e.ox + (e.nx - e.ox) * t;
      e.y = e.oy + (e.ny - e.oy) * t;
      e.r = e.or + (e.nr - e.or) * t;
      if (e.kind === EntityKind.Cell && dt > 0) {
        const k = 1 - Math.exp(-dt * 8);
        e.vx += ((e.x - px) / dt - e.vx) * k;
        e.vy += ((e.y - py) / dt - e.vy) * k;
      }
    }
    // emotes expire
    for (const p of this.players.values()) if (p.emote && now - p.emote.at > 2600) p.emote = null;
  }

  myCells(): CEntity[] {
    const out: CEntity[] = [];
    if (this.myPid === null) return out;
    for (const e of this.entities.values()) if (e.kind === EntityKind.Cell && e.playerId === this.myPid && !e.dying) out.push(e);
    return out;
  }

  /** Mass-weighted centre and totals of my cells. */
  myStats(): { x: number; y: number; mass: number; count: number; maxR: number; bbox: { x0: number; y0: number; x1: number; y1: number } } | null {
    const cells = this.myCells();
    if (cells.length === 0) return null;
    let m = 0;
    let x = 0;
    let y = 0;
    let maxR = 0;
    const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const c of cells) {
      const mass = (c.nr * c.nr) / 100;
      m += mass;
      x += c.x * mass;
      y += c.y * mass;
      maxR = Math.max(maxR, c.r);
      bbox.x0 = Math.min(bbox.x0, c.x - c.r);
      bbox.y0 = Math.min(bbox.y0, c.y - c.r);
      bbox.x1 = Math.max(bbox.x1, c.x + c.r);
      bbox.y1 = Math.max(bbox.y1, c.y + c.r);
    }
    return { x: x / m, y: y / m, mass: m, count: cells.length, maxR, bbox };
  }

  isBot(pid: number): boolean {
    return ((this.players.get(pid)?.flags ?? 0) & PlayerFlag.Bot) !== 0;
  }

  /** Updates per-cell expressions: scared near threats, hungry near prey. */
  computeExpressions(now: number): void {
    const cells: CEntity[] = [];
    for (const e of this.entities.values()) if (e.kind === EntityKind.Cell && !e.dying) cells.push(e);
    const n = cells.length;
    for (let i = 0; i < n; i++) {
      const a = cells[i];
      let expr: Expression = 'happy';
      let bestThreat = Infinity;
      let bestPrey = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = cells[j];
        if (b.playerId === a.playerId) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
        if (b.r > a.r * 1.118 && d < Math.max(a.r, b.r) * 1.6) bestThreat = Math.min(bestThreat, d);
        else if (a.r > b.r * 1.118 && d < a.r * 1.8) bestPrey = Math.min(bestPrey, d);
      }
      if (bestThreat < Infinity) expr = 'scared';
      else if (bestPrey < Infinity) expr = 'hungry';
      else if ((now / 1000 + a.seed * 9) % 14 < 1.2) expr = 'proud';
      a.expression = expr;
    }
  }
}
