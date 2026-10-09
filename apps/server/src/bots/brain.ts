import { EntityKind, RULES, canEat, clamp, massToRadius, speedForRadius, viewSize } from '@solagel/shared';
import type { Cell, Eject, Food, Player, PowerUp, Virus } from '../game/entities';
import type { Rng } from '../game/rng';
import type { World } from '../game/world';
import type { Personality } from './personality';
import { ContextMap, angleDiff, angleTo } from './steering';

export interface BotDecision {
  target: { x: number; y: number };
  split: boolean;
  eject: boolean;
}

/** Approximate flight distance of a freshly split half (boost + own speed). */
const SPLIT_REACH = RULES.splitSpeed / -Math.log(RULES.splitDecayPerSec);

interface Seen {
  x: number;
  y: number;
  t: number;
}

/**
 * One bot's decision maker. Every `thinkMs` it builds interest/danger maps
 * over 24 directions from what it can see and steers toward the best one;
 * it also decides on split attacks and (for hard bots) virus shots.
 */
export class BotBrain {
  private prevAngle: number | null = null;
  private nextThinkAt = 0;
  private seen = new Map<number, Seen>();
  private wander: number;
  private splitCooldownUntil = 0;
  private shootUntil = 0;
  private shootTarget: { x: number; y: number } | null = null;
  private readonly map = new ContextMap();
  /** Exposed for tests / debugging. */
  lastDanger = 0;

  constructor(
    readonly personality: Personality,
    private readonly rng: Rng,
  ) {
    this.wander = rng() * Math.PI * 2;
  }

  shouldThink(now: number): boolean {
    return now >= this.nextThinkAt;
  }

  private velocity(c: Cell, now: number): { x: number; y: number } {
    const s = this.seen.get(c.id);
    if (!s || now - s.t <= 0 || now - s.t > 1500) return { x: 0, y: 0 };
    const dt = (now - s.t) / 1000;
    return { x: (c.x - s.x) / dt, y: (c.y - s.y) / dt };
  }

  think(world: World, me: Player, now: number): BotDecision | null {
    const P = this.personality;
    this.nextThinkAt = now + P.thinkMs * (0.85 + this.rng() * 0.3);
    if (me.cells.length === 0) return null;

    const center = me.center();
    const total = me.totalMass();
    const big = me.biggestCell()!;
    let smallest = big;
    for (const c of me.cells) if (c.mass < smallest.mass) smallest = c;

    const view = viewSize(total, 16 / 9);
    const range = (view.w / 2) * P.perception;
    const { width: W, height: H } = world.cfg;

    // hard bots keep shooting a virus for a moment once they commit
    if (this.shootTarget && now < this.shootUntil && total > RULES.ejectMinMass + 10) {
      return { target: this.shootTarget, split: false, eject: true };
    }
    this.shootTarget = null;

    const threats: Cell[] = [];
    const prey: Cell[] = [];
    const others: Cell[] = [];
    const viruses: Virus[] = [];
    const foods: (Food | Eject)[] = [];
    const powerUps: PowerUp[] = [];
    world.forEachVisible(center.x - range, center.y - range, center.x + range, center.y + range, (e) => {
      switch (e.kind) {
        case EntityKind.Cell:
          if (e.player === me) return;
          others.push(e);
          if (canEat(e.mass, smallest.mass)) threats.push(e);
          if (canEat(big.mass, e.mass) && e.player.shieldUntil <= now) prey.push(e);
          return;
        case EntityKind.Food:
          foods.push(e);
          return;
        case EntityKind.Eject:
          if (e.ownerId !== me.id) foods.push(e);
          return;
        case EntityKind.Virus:
          viruses.push(e);
          return;
        case EntityKind.PowerUp:
          powerUps.push(e);
          return;
      }
    });

    const map = this.map;
    map.reset();
    const shielded = me.shieldUntil > now;

    /* ---------- danger: threats ---------- */
    let dangerLevel = 0;
    let chaser: Cell | null = null;
    const distracted = this.rng() < P.distraction;
    if (!distracted && !shielded) {
      for (const t of threats) {
        const tv = this.velocity(t, now);
        const tx = t.x + tv.x * 0.25;
        const ty = t.y + tv.y * 0.25;
        for (const c of me.cells) {
          if (!canEat(t.mass, c.mass)) continue;
          const splitKill = t.mass / 2 >= c.mass * RULES.eatRatio && t.player.cells.length < RULES.maxCells;
          const d = Math.hypot(c.x - tx, c.y - ty);
          const reach = t.r + (splitKill ? SPLIT_REACH + t.r * 0.2 : 0) + 25;
          const edge = d - reach - c.r * 0.2;
          const zone = 330 * P.caution + c.r;
          if (edge > zone) continue;
          const proximity = clamp(1 - edge / zone, 0, 1.6);
          const atRisk = c.mass / total;
          const w = P.caution * proximity * proximity * (0.45 + atRisk) * (splitKill ? 1.25 : 1);
          map.addDanger(angleTo(c.x, c.y, tx, ty), w * 2.4, 1);
          if (proximity > dangerLevel) {
            dangerLevel = proximity;
            chaser = t;
          }
        }
      }
    }
    this.lastDanger = dangerLevel;

    /* ---------- danger: walls ---------- */
    const look = big.r + 240;
    map.addWalls(center.x, center.y, look, W, H, Math.min(big.r * 0.6, 200), 1.6);

    /* ---------- viruses ---------- */
    const canPop = big.mass > RULES.virusMass * RULES.virusPopRatio && me.cells.length < RULES.maxCells;
    for (const v of viruses) {
      const d = Math.hypot(v.x - big.x, v.y - big.y);
      if (canPop) {
        if (!P.virusAware && this.rng() < 0.6) continue;
        const edge = d - v.r - big.r;
        if (edge < 180) map.addDanger(angleTo(big.x, big.y, v.x, v.y), 0.9 * (1 - Math.max(0, edge) / 180) + 0.15, 2);
      } else if (P.virusAware && dangerLevel > 0.3 && chaser && chaser.mass > v.mass * RULES.virusPopRatio) {
        // small and chased by something that would pop: hide behind the virus
        map.addInterest(angleTo(center.x, center.y, v.x, v.y), (0.9 * dangerLevel) / (1 + d / 450), 2);
      }
    }

    /* ---------- interest: food ---------- */
    for (const f of foods) {
      const d = Math.max(0, Math.hypot(f.x - center.x, f.y - center.y) - big.r * 0.5);
      const value = f.kind === EntityKind.Eject ? f.mass * 1.2 : f.mass;
      const w = (P.greed * value * 40) / Math.pow(d + 70, 1.15);
      map.addInterest(angleTo(center.x, center.y, f.x, f.y), w, 2);
    }

    /* ---------- interest: prey ---------- */
    let bestPrey: Cell | null = null;
    let bestPreyScore = 0;
    if (!shielded) {
      for (const q of prey) {
        const d = Math.hypot(q.x - big.x, q.y - big.y);
        let w = (P.aggression * q.mass * 6) / Math.pow(d + 80, 1.05);
        for (const t of threats) if (Math.hypot(t.x - q.x, t.y - q.y) < t.r + 320) w *= 0.4;
        if (canPop && P.virusAware) {
          for (const v of viruses) if (Math.hypot(v.x - q.x, v.y - q.y) < v.r + q.r + 20) w *= 0.3;
        }
        if (w > bestPreyScore) {
          bestPreyScore = w;
          bestPrey = q;
        }
        let tx = q.x;
        let ty = q.y;
        if (P.leadsTargets) {
          const qv = this.velocity(q, now);
          const eta = Math.min(0.8, d / Math.max(60, speedForRadius(big.r)));
          tx += qv.x * eta;
          ty += qv.y * eta;
        }
        map.addInterest(angleTo(center.x, center.y, tx, ty), w, 3);
      }
    }

    /* ---------- interest: power-ups ---------- */
    for (const pu of powerUps) {
      const d = Math.hypot(pu.x - center.x, pu.y - center.y);
      const urgent = dangerLevel > 0.3 ? 1.8 : 1;
      map.addInterest(angleTo(center.x, center.y, pu.x, pu.y), (urgent * 300) / (d + 120), 2);
    }

    /* ---------- wander so idle bots explore ---------- */
    this.wander += (this.rng() - 0.5) * 0.5;
    map.addInterest(this.wander, 0.015, 1);

    let angle = map.choose(this.prevAngle, 1.0);
    const noise = P.aimNoise * (dangerLevel > 0.8 ? 0.5 : 1);
    angle += (this.rng() * 2 - 1) * noise;
    this.prevAngle = angle;

    // refresh velocity memory
    const nextSeen = new Map<number, Seen>();
    for (const c of others) nextSeen.set(c.id, { x: c.x, y: c.y, t: now });
    this.seen = nextSeen;

    /* ---------- how far ahead to aim ---------- */
    let dist = big.r + 320;
    if (me.cells.length > 1 && dangerLevel < 0.2) {
      let lastMerge = 0;
      for (const c of me.cells) lastMerge = Math.max(lastMerge, c.mergeAt);
      const preyClose = bestPrey !== null && Math.hypot(bestPrey.x - big.x, bestPrey.y - big.y) < big.r + 250;
      if (now >= lastMerge - 1500 && !preyClose) dist = big.r * 0.5 + 40;
    }
    let target = { x: center.x + Math.cos(angle) * dist, y: center.y + Math.sin(angle) * dist };

    /* ---------- split attack ---------- */
    let split = false;
    const maxCellsForSplit = P.skill === 2 ? 4 : 2;
    if (bestPrey && !shielded && now >= this.splitCooldownUntil && me.cells.length <= maxCellsForSplit && P.splitBravery > 0) {
      const half = big.mass / 2;
      const q = bestPrey;
      if (canEat(half, q.mass) && q.player.shieldUntil <= now) {
        const hr = massToRadius(half);
        const d = Math.hypot(q.x - big.x, q.y - big.y);
        const reach = SPLIT_REACH * 0.85 + big.r * 0.25;
        if (d - hr * 0.6 < reach && d > big.r * 0.5) {
          let safe = true;
          for (const o of others) {
            if (o.player === q.player) continue;
            if (canEat(o.mass, half) && Math.hypot(o.x - q.x, o.y - q.y) < o.r + 650) {
              safe = false;
              break;
            }
          }
          if (canPop) {
            for (const v of viruses) if (Math.hypot(v.x - q.x, v.y - q.y) < v.r + hr) safe = false;
          }
          if (safe && this.rng() < P.splitBravery * 0.65) {
            const qv = P.leadsTargets ? this.velocity(q, now) : { x: 0, y: 0 };
            const lx = q.x + qv.x * 0.22;
            const ly = q.y + qv.y * 0.22;
            const a = angleTo(big.x, big.y, lx, ly) + (this.rng() * 2 - 1) * P.aimNoise * 0.3;
            target = { x: big.x + Math.cos(a) * (d + 220), y: big.y + Math.sin(a) * (d + 220) };
            this.prevAngle = a;
            split = true;
            this.splitCooldownUntil = now + 2500 + this.rng() * 2000;
          }
        }
      }
    }

    /* ---------- virus shot (hard bots) ---------- */
    let eject = false;
    if (!split && P.virusShooter && chaser && dangerLevel > 0.25 && dangerLevel < 0.9 && total > 150) {
      if (chaser.mass > RULES.virusMass * RULES.virusPopRatio * 1.5) {
        const aT = angleTo(big.x, big.y, chaser.x, chaser.y);
        const dT = Math.hypot(chaser.x - big.x, chaser.y - big.y);
        for (const v of viruses) {
          const dV = Math.hypot(v.x - big.x, v.y - big.y);
          if (dV > dT || dV > big.r + 380 || dV < big.r + v.r + 120) continue;
          if (Math.abs(angleDiff(angleTo(big.x, big.y, v.x, v.y), aT)) > 0.28) continue;
          this.shootTarget = { x: v.x, y: v.y };
          this.shootUntil = now + 900;
          target = this.shootTarget;
          eject = true;
          break;
        }
      }
    }

    return { target, split, eject };
  }
}
