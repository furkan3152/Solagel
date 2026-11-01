import { EntityKind, RULES, canEat, clamp, massToRadius, speedForRadius, viewSize } from '@elymum/shared';
import type { Cell, Eject, Player, PowerUp, Virus } from '../game/entities';
import type { Rng } from '../game/rng';
import type { World } from '../game/world';
import type { Personality } from './personality';
import { ContextMap, angleDiff, angleTo } from './steering';

export interface BotDecision {
  target: { x: number; y: number };
  split: boolean;
  eject: boolean;
}

/** Approximate flight distance of a freshly split half (boost only). */
export const SPLIT_REACH = RULES.splitSpeed / -Math.log(RULES.splitDecayPerSec);
/** Bots politely steer around humans who joined less than this long ago (and never split-attack them). */
export const NEWBIE_GRACE_MS = 25_000;
/** Coins this close (beyond the bot's radius) are weighed one by one; farther ones through the food field. */
const NEAR_FOOD = 330;
/**
 * A double split: the second split goes out this long after the first, from the half already in
 * flight, which carries the quarter about `DOUBLE_REACH` split flights far.
 */
const DOUBLE_SPLIT_DELAY_MS = 170;
const DOUBLE_REACH = 1.38;
/** Food-field bucket size (world units) and refresh interval (one rebuild per room, shared by its bots). */
const FIELD_CELL = 400;
const FIELD_REFRESH_MS = 600;
const MAX_CELL_R = massToRadius(RULES.maxCellMass);
/**
 * A bot at the room's mass cap gains nothing from eating: it grazes and hunts at this share of its
 * usual drive (it must not turn into a pure hunter either: the rookie league stays friendly).
 */
const AT_CAP_DRIVE = 0.35;
/** Memory of other cells (for velocities) is pruned of entries unseen this long. */
const FORGET_MS = 3000;

/**
 * Coin density of a room in coarse buckets, rebuilt at most every `FIELD_REFRESH_MS` and shared
 * by every bot of that world: bots head for rich fields instead of wandering.
 */
class FoodField {
  readonly cols: number;
  readonly rows: number;
  readonly mass: Float32Array;
  builtAt = -Infinity;
  private readonly addFood = (e: { kind: EntityKind; mass: number; x: number; y: number; removed: boolean }): void => {
    if (e.kind !== EntityKind.Food || e.removed) return;
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(e.x / FIELD_CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(e.y / FIELD_CELL)));
    this.mass[r * this.cols + c] += e.mass;
  };

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / FIELD_CELL));
    this.rows = Math.max(1, Math.ceil(height / FIELD_CELL));
    this.mass = new Float32Array(this.cols * this.rows);
  }

  refresh(world: World): void {
    const now = world.now;
    if (now - this.builtAt < FIELD_REFRESH_MS && now >= this.builtAt) return;
    this.builtAt = now;
    this.mass.fill(0);
    world.staticGrid.forEachIn(0, 0, this.width, this.height, this.addFood);
  }
}

/** The caller gets its own copy (callers may queue decisions); the scratch one is reused inside. */
const emit = (d: BotDecision): BotDecision => ({ target: { x: d.target.x, y: d.target.y }, split: d.split, eject: d.eject });

const fields = new WeakMap<World, FoodField>();
function foodField(world: World): FoodField {
  let f = fields.get(world);
  if (!f) {
    f = new FoodField(world.cfg.width, world.cfg.height);
    fields.set(world, f);
  }
  f.refresh(world);
  return f;
}

/** What a bot remembers of another cell between two thoughts. */
interface Seen {
  x: number;
  y: number;
  t: number;
  /** Velocity estimated at the last thought. */
  vx: number;
  vy: number;
}

/**
 * One bot's decision maker. Every `thinkMs` (staggered, never every tick) it reads what it can
 * see through the world's spatial grids and steers with interest/danger maps over 24 directions:
 *
 * - threats are judged with prediction: observed velocity, the split lunge (and, for good bots,
 *   the double split) of anything big enough to split-kill one of its cells, noticed only after a
 *   reaction delay;
 * - fleeing keeps off walls and corners and, when small, hides behind thorn bushes from chasers
 *   that would pop on them;
 * - hunting weighs catchability (a faster coin running away is not worth the chase), split-kills
 *   a target within reach when the landing is safe, and good bots double-split;
 * - while split it is more careful (the pieces are smaller) and regroups before merging;
 * - bait (coins next to a bush, blobs fed by something that can eat it) is mostly ignored;
 * - coins are routed through a shared density field so idle bots head for rich areas.
 *
 * Bots and humans are the same to it, except that humans who just joined are spared. Mistakes
 * and delays are per difficulty (see `personality.ts`). Scratch lists, the steering maps and the
 * grid callbacks are reused: a thought allocates only its small result (and first sightings).
 */
export class BotBrain {
  private prevAngle: number | null = null;
  private nextThinkAt: number;
  private readonly seen = new Map<number, Seen>();
  /** Player id → when the bot first noticed that player as a threat, and last saw it (reaction delay). */
  private readonly noticed = new Map<number, { first: number; last: number }>();
  /** A double split in progress: the second split goes out at `followUpAt`, aimed at `followUp`. */
  private followUpAt = 0;
  private readonly followUp = { x: 0, y: 0 };
  private lastPrune = 0;
  private wander: number;
  private splitCooldownUntil = 0;
  /** The prey being chased (player id) and since when; a chase that drags on is given up. */
  private chaseId = -1;
  private chaseSince = 0;
  private giveUpId = -1;
  private giveUpUntil = 0;
  private shootUntil = 0;
  private readonly shootTarget = { x: 0, y: 0 };
  private shooting = false;
  private readonly map = new ContextMap();
  private readonly decision: BotDecision = { target: { x: 0, y: 0 }, split: false, eject: false };
  // scratch lists, reused every thought
  private readonly others: Cell[] = [];
  private readonly threats: Cell[] = [];
  private readonly prey: Cell[] = [];
  private readonly newbies: Cell[] = [];
  private readonly viruses: Virus[] = [];
  private readonly ejects: Eject[] = [];
  private readonly powerUps: PowerUp[] = [];
  // context of the current gather pass (read by the prebound grid callbacks)
  private me: Player | null = null;
  private cx = 0;
  private cy = 0;
  private nearR = 0;
  private range = 0;
  private greedNow = 1;
  private readonly visitDynamic = (e: { kind: EntityKind }): void => {
    if (e.kind === EntityKind.Cell) {
      const c = e as Cell;
      // in sight: the cell's edge is inside the bot's view square
      if (!c.removed && c.player !== this.me && Math.abs(c.x - this.cx) - c.r < this.range && Math.abs(c.y - this.cy) - c.r < this.range) this.others.push(c);
    } else if (e.kind === EntityKind.Eject) {
      const j = e as Eject;
      if (!j.removed && j.ownerId !== this.me!.id) this.ejects.push(j);
    }
  };
  private readonly visitFood = (e: { kind: EntityKind; x: number; y: number; mass: number; removed: boolean }): void => {
    if (e.kind !== EntityKind.Food || e.removed) return;
    const dx = e.x - this.cx;
    const dy = e.y - this.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > this.nearR) return;
    const w = (this.greedNow * e.mass * 40) / Math.pow(d + 70, 1.15);
    this.map.addBinned(Math.atan2(dy, dx), w);
  };
  /** Where this bot was a moment ago (stuck detection). */
  private anchorX = NaN;
  private anchorY = NaN;
  private anchorAt = 0;
  private unstickUntil = 0;
  /** Most mass the room lets a bot keep (set by the manager; Infinity: no cap). */
  massCap = Infinity;
  /** Exposed for tests / debugging. */
  lastDanger = 0;

  constructor(
    readonly personality: Personality,
    private readonly rng: Rng,
    now = 0,
  ) {
    this.wander = rng() * Math.PI * 2;
    // stagger the first thought so a room's bots never all think on the same tick
    this.nextThinkAt = now + rng() * personality.thinkMs;
  }

  shouldThink(now: number): boolean {
    return now >= this.nextThinkAt;
  }

  /** Remembers `c` and returns its velocity estimate into `out`. */
  private track(c: Cell, now: number): Seen {
    let s = this.seen.get(c.id);
    if (!s) {
      s = { x: c.x, y: c.y, t: now, vx: 0, vy: 0 };
      this.seen.set(c.id, s);
      return s;
    }
    const dt = (now - s.t) / 1000;
    if (dt > 0.02 && dt < 1.5) {
      // light smoothing so one jolt (a push between own cells) does not read as a charge
      const vx = (c.x - s.x) / dt;
      const vy = (c.y - s.y) / dt;
      s.vx = s.vx * 0.35 + vx * 0.65;
      s.vy = s.vy * 0.35 + vy * 0.65;
    } else if (dt >= 1.5) {
      s.vx = 0;
      s.vy = 0;
    }
    s.x = c.x;
    s.y = c.y;
    s.t = now;
    return s;
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 2000) return;
    this.lastPrune = now;
    for (const [id, s] of this.seen) if (now - s.t > FORGET_MS) this.seen.delete(id);
    for (const [id, n] of this.noticed) if (now - n.last > 10_000) this.noticed.delete(id);
  }

  think(world: World, me: Player, now: number): BotDecision | null {
    const P = this.personality;
    if (me.cells.length === 0) {
      this.nextThinkAt = now + P.thinkMs;
      return null;
    }
    const rng = this.rng;

    // centre, mass, biggest and smallest cell (no allocation: Player.center() makes an object)
    let total = 0;
    let sx = 0;
    let sy = 0;
    let big = me.cells[0];
    let smallest = big;
    for (const c of me.cells) {
      total += c.mass;
      sx += c.x * c.mass;
      sy += c.y * c.mass;
      if (c.mass > big.mass) big = c;
      if (c.mass < smallest.mass) smallest = c;
    }
    const cx = sx / total;
    const cy = sy / total;
    const nCells = me.cells.length;
    const split = nCells > 1;
    const { width: W, height: H } = world.cfg;
    const d = this.decision;
    d.split = false;
    d.eject = false;

    // the second half of a double split (the first half is in flight by now)
    if (this.followUpAt > 0) {
      const due = now >= this.followUpAt;
      if (due) this.followUpAt = 0;
      if (due && nCells < RULES.maxCells && big.mass >= RULES.splitMinMass) {
        d.target.x = this.followUp.x;
        d.target.y = this.followUp.y;
        d.split = true;
        this.nextThinkAt = now + P.thinkMs * 0.5;
        return emit(d);
      }
      if (!due) {
        this.nextThinkAt = this.followUpAt;
        d.target.x = this.followUp.x;
        d.target.y = this.followUp.y;
        return emit(d);
      }
    }

    // hard bots keep shooting a virus for a moment once they commit
    if (this.shooting && now < this.shootUntil && total > RULES.ejectMinMass + 10) {
      this.nextThinkAt = now + P.thinkMs * 0.6;
      d.target.x = this.shootTarget.x;
      d.target.y = this.shootTarget.y;
      d.eject = true;
      return emit(d);
    }
    this.shooting = false;

    const view = viewSize(total, 16 / 9);
    const range = (view.w / 2) * P.perception;
    const shielded = me.shieldUntil > now;
    const atCap = total >= this.massCap * 0.95;
    const mistake = rng() < P.mistakeRate;

    /* ---------- gather (spatial grids; coins only nearby) ---------- */
    const others = this.others;
    const threats = this.threats;
    const prey = this.prey;
    const newbies = this.newbies;
    const viruses = this.viruses;
    const ejects = this.ejects;
    const powerUps = this.powerUps;
    others.length = threats.length = prey.length = newbies.length = viruses.length = ejects.length = powerUps.length = 0;
    this.me = me;
    this.cx = cx;
    this.cy = cy;
    this.range = range;
    // padded by the largest possible cell radius: a whale's edge can be in view while its centre is not
    const pad = MAX_CELL_R;
    world.dynGrid.forEachIn(cx - range - pad, cy - range - pad, cx + range + pad, cy + range + pad, this.visitDynamic);
    for (const v of world.viruses) if (!v.removed && Math.abs(v.x - cx) < range + v.r && Math.abs(v.y - cy) < range + v.r) viruses.push(v);
    for (const pu of world.powerUps) if (!pu.removed && Math.abs(pu.x - cx) < range && Math.abs(pu.y - cy) < range) powerUps.push(pu);

    for (const o of others) {
      this.track(o, now);
      if (canEat(o.mass, smallest.mass)) threats.push(o);
      if (canEat(big.mass, o.mass)) {
        if (!o.player.isBot && now - o.player.stats.joinedAt < NEWBIE_GRACE_MS) newbies.push(o);
        else if (o.player.shieldUntil <= now) prey.push(o);
      }
    }
    this.prune(now);

    const map = this.map;
    map.reset();

    /* ---------- danger: threats, with prediction and the split lunge ---------- */
    let dangerLevel = 0;
    let chaser: Cell | null = null;
    // the "straight away from it all" direction, weighted like the danger
    let awayX = 0;
    let awayY = 0;
    const distracted = rng() < P.distraction;
    // split pieces are smaller and cannot run as one: be more careful (good bots know it)
    const caution = P.caution * (split && P.skill > 0 ? 1.25 : 1);
    if (!distracted && !shielded) {
      for (const t of threats) {
        let n = this.noticed.get(t.player.id);
        if (!n) {
          n = { first: now, last: now };
          this.noticed.set(t.player.id, n);
        } else if (now - n.last > 4000) n.first = now; // out of sight a while: noticed afresh
        n.last = now;
        // only reacts after the reaction delay
        if (now - n.first < P.reactionMs) continue;
        const s = this.seen.get(t.id)!;
        // boost velocity (a lunging half) is visible motion too
        const vx = s.vx + t.vx;
        const vy = s.vy + t.vy;
        const tx = t.x + vx * P.predictS;
        const ty = t.y + vy * P.predictS;
        const tCells = t.player.cells.length;
        for (const c of me.cells) {
          if (!canEat(t.mass, c.mass)) continue;
          const splitKill = t.mass / 2 >= c.mass * RULES.eatRatio && tCells < RULES.maxCells;
          const doubleKill = P.skill === 2 && t.mass / 4 >= c.mass * RULES.eatRatio && tCells <= RULES.maxCells - 3;
          const dx = c.x - tx;
          const dy = c.y - ty;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let reach = t.r + 25;
          if (doubleKill) reach += SPLIT_REACH * DOUBLE_REACH + t.r * 0.1;
          else if (splitKill) reach += SPLIT_REACH + t.r * 0.2;
          // closing speed toward this cell adds to the threat's reach
          const ux = dist > 1 ? dx / dist : 0;
          const uy = dist > 1 ? dy / dist : 0;
          const closing = Math.max(0, vx * ux + vy * uy);
          const lead = closing * (splitKill ? 0.6 : 0.3) * (0.5 + P.predictS);
          const edge = dist - reach - c.r * 0.2 - lead;
          const zone = 330 * caution + c.r;
          if (edge > zone) continue;
          const proximity = clamp(1 - edge / zone, 0, 1.6);
          const atRisk = c.mass / total;
          const w = caution * proximity * proximity * (0.45 + atRisk) * (splitKill ? 1.25 : 1);
          map.addDanger(Math.atan2(ty - c.y, tx - c.x), w * 2.4, 1);
          awayX += ux * w;
          awayY += uy * w;
          if (proximity > dangerLevel) {
            dangerLevel = proximity;
            chaser = t;
          }
        }
      }
    }
    this.lastDanger = dangerLevel;

    /* ---------- newcomers: steer around fresh human spawns ---------- */
    for (const n of newbies) {
      for (const c of me.cells) {
        if (!canEat(c.mass, n.mass)) continue;
        const gap = Math.hypot(n.x - c.x, n.y - c.y) - c.r - n.r;
        if (gap < 260) map.addDanger(angleTo(c.x, c.y, n.x, n.y), 1.1 * (1 - Math.max(0, gap) / 260) + 0.1, 2);
      }
    }

    /* ---------- walls and corners (much more so while fleeing) ---------- */
    const flee = dangerLevel > 0.25 ? Math.min(1, dangerLevel) : 0;
    const look = big.r + 240 + 420 * flee * P.wallSense;
    map.addWalls(cx, cy, look, W, H, Math.min(big.r * 0.6, 200), 1.6 * (1 + flee * P.wallSense));
    if (flee > 0) {
      // run straight away (the danger map alone leaves every safe heading equal)
      map.addInterest(Math.atan2(awayY, awayX), 0.35 * flee, 2);
      // open space beats a corner: pull toward the middle the closer the walls are
      const wallGap = Math.min(cx, cy, W - cx, H - cy);
      const cramped = clamp(1 - (wallGap - big.r) / 900, 0, 1);
      if (cramped > 0) map.addInterest(angleTo(cx, cy, W / 2, H / 2), 0.5 * flee * cramped * P.wallSense, 1);
      // against a wall: slide along it toward the far corner (the long way out), never into the near one
      if (P.skill > 0 && wallGap < big.r + 450) {
        const vertical = Math.min(cx, W - cx) <= Math.min(cy, H - cy); // the nearest wall is left/right
        const a = vertical ? (cy > H / 2 ? -Math.PI / 2 : Math.PI / 2) : cx > W / 2 ? Math.PI : 0;
        map.addInterest(a, 0.6 * flee * P.wallSense, 2);
      }
    }

    /* ---------- thorn bushes: avoid when big, hide behind when small and chased ---------- */
    const canPop = nCells < RULES.maxCells && big.mass > RULES.virusMass * RULES.virusPopRatio;
    for (const v of viruses) {
      const popsMe = big.mass > v.mass * RULES.virusPopRatio && nCells < RULES.maxCells;
      if (popsMe) {
        // careless bots walk into bushes now and then (a capped bot gains nothing from the pop)
        if (!P.virusAware && !atCap && rng() < 0.6) continue;
        // every big-enough own cell must keep off it
        for (const c of me.cells) {
          if (c.mass <= v.mass * RULES.virusPopRatio) continue;
          const edge = Math.hypot(v.x - c.x, v.y - c.y) - v.r - c.r;
          if (edge < 180) map.addDanger(angleTo(c.x, c.y, v.x, v.y), 0.9 * (1 - Math.max(0, edge) / 180) + 0.15, 2);
        }
      } else if (P.virusAware && flee > 0 && chaser && chaser.mass > v.mass * RULES.virusPopRatio) {
        // hide on the far side of the bush, but only one we reach before the chaser does
        const dMe = Math.hypot(v.x - cx, v.y - cy);
        const dCh = Math.hypot(v.x - chaser.x, v.y - chaser.y);
        if (dMe > dCh + 60 || dMe > 900) continue;
        const k = (v.r * 0.6) / Math.max(1, dCh);
        const hx = v.x + (v.x - chaser.x) * k;
        const hy = v.y + (v.y - chaser.y) * k;
        map.addInterest(angleTo(cx, cy, hx, hy), (1.1 * flee) / (1 + dMe / 450), 2);
      }
    }

    /* ---------- coins: one by one nearby, a density field beyond ---------- */
    // capped bots gain nothing from coins
    const greed = P.greed * (atCap ? AT_CAP_DRIVE : 1);
    this.greedNow = greed;
    this.cx = cx;
    this.cy = cy;
    const nearR = big.r + NEAR_FOOD;
    this.nearR = nearR;
    world.staticGrid.forEachIn(cx - nearR, cy - nearR, cx + nearR, cy + nearR, this.visitFood);
    if (P.foodRouting > 0 && greed > 0) {
      const field = foodField(world);
      const fr = Math.min(range * 1.25, 3400);
      const c0 = Math.max(0, Math.floor((cx - fr) / FIELD_CELL));
      const c1 = Math.min(field.cols - 1, Math.floor((cx + fr) / FIELD_CELL));
      const r0 = Math.max(0, Math.floor((cy - fr) / FIELD_CELL));
      const r1 = Math.min(field.rows - 1, Math.floor((cy + fr) / FIELD_CELL));
      const k = greed * P.foodRouting * 40;
      for (let r = r0; r <= r1; r++) {
        const fy = (r + 0.5) * FIELD_CELL;
        for (let c = c0; c <= c1; c++) {
          const m = field.mass[r * field.cols + c];
          if (m <= 0) continue;
          const fx = (c + 0.5) * FIELD_CELL;
          const dx = fx - cx;
          const dy = fy - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= nearR || dist > fr) continue;
          let w = (k * m) / Math.pow(dist + 150, 1.22);
          // coins along the border are a trap to graze (one way out): less tempting
          if (r === 0 || c === 0 || r === field.rows - 1 || c === field.cols - 1) w *= 0.55;
          // a field guarded by something that eats us is not a field
          for (const t of threats) if (Math.abs(t.x - fx) < t.r + 350 && Math.abs(t.y - fy) < t.r + 350) w *= 0.15;
          map.addBinned(Math.atan2(dy, dx), w);
        }
      }
    }

    /* ---------- ejected blobs: food, unless it is bait ---------- */
    for (const j of ejects) {
      const dist = Math.max(0, Math.hypot(j.x - cx, j.y - cy) - big.r * 0.5);
      let w = (greed * j.mass * 40 * 1.1) / Math.pow(dist + 70, 1.15);
      if (P.virusAware && canPop) {
        // a blob next to a bush is the classic bait
        for (const v of viruses) if (Math.hypot(v.x - j.x, v.y - j.y) < v.r + big.r + 60) w *= 0.1;
      }
      // a blob fed by something that can eat us leads into its mouth
      for (const t of threats) {
        if (t.player.id === j.ownerId || Math.hypot(t.x - j.x, t.y - j.y) < t.r + 260) {
          w *= P.skill === 0 ? 0.5 : 0.05;
          break;
        }
      }
      map.addBinned(angleTo(cx, cy, j.x, j.y), w);
    }
    map.flushBinned();

    /* ---------- prey ---------- */
    let bestPrey: Cell | null = null;
    let bestPreyScore = 0;
    const mySpeed = speedForRadius(big.r);
    if (!shielded) {
      const aggression = P.aggression * (atCap ? AT_CAP_DRIVE : 1);
      for (const q of prey) {
        const dist = Math.hypot(q.x - big.x, q.y - big.y);
        let w = (aggression * q.mass * 6) / Math.pow(dist + 80, 1.05);
        // a chase that went nowhere: leave that one alone for a while (unless it is right here)
        if (q.player.id === this.giveUpId && now < this.giveUpUntil && dist > big.r + 120) w *= 0.08;
        for (const t of threats) if (Math.hypot(t.x - q.x, t.y - q.y) < t.r + 320) w *= 0.4;
        if (canPop && P.virusAware) {
          for (const v of viruses) if (Math.hypot(v.x - q.x, v.y - q.y) < v.r + q.r + 20) w *= 0.3;
        }
        const s = this.seen.get(q.id);
        if (P.skill > 0 && s) {
          // a faster coin running away out of split reach is not worth the chase…
          const away = dist > 1 ? (s.vx * (q.x - big.x) + s.vy * (q.y - big.y)) / dist : 0;
          if (away > mySpeed * 0.9 && dist > SPLIT_REACH * 1.3) w *= 0.35;
          // …but one pinned against a wall is (good players know)
          if (P.skill === 2 && Math.min(q.x, q.y, W - q.x, H - q.y) < q.r + 220) w *= 1.4;
        }
        if (w > bestPreyScore) {
          bestPreyScore = w;
          bestPrey = q;
        }
        let tx = q.x;
        let ty = q.y;
        if (P.leadsTargets && s) {
          const eta = Math.min(0.8, dist / Math.max(60, mySpeed));
          tx += s.vx * eta;
          ty += s.vy * eta;
        }
        map.addInterest(angleTo(cx, cy, tx, ty), w, 3);
      }
    }

    // chase fatigue: people give up a chase that takes too long
    if (!bestPrey) this.chaseId = -1;
    else if (bestPrey.player.id !== this.chaseId) {
      this.chaseId = bestPrey.player.id;
      this.chaseSince = now;
    } else if (now - this.chaseSince > P.chaseMs) {
      this.giveUpId = this.chaseId;
      this.giveUpUntil = now + 5000 + rng() * 5000;
      this.chaseId = -1;
    }

    /* ---------- power-ups ---------- */
    for (const pu of powerUps) {
      const dist = Math.hypot(pu.x - cx, pu.y - cy);
      const urgent = dangerLevel > 0.3 ? 1.8 : 1;
      map.addInterest(angleTo(cx, cy, pu.x, pu.y), (urgent * 300) / (dist + 120), 2);
    }

    /* ---------- wander, and get unstuck ---------- */
    this.wander += (rng() - 0.5) * 0.5;
    if (!(now - this.anchorAt < 2500)) {
      const moved = Math.hypot(cx - this.anchorX, cy - this.anchorY);
      if (moved < 50 && dangerLevel < 0.2 && !bestPrey) {
        // stuck (a corner, a wall of bushes, nothing in sight): pick a fresh way out
        this.wander = angleTo(cx, cy, W / 2 + (rng() - 0.5) * W * 0.6, H / 2 + (rng() - 0.5) * H * 0.6);
        this.unstickUntil = now + 1500;
      }
      this.anchorX = cx;
      this.anchorY = cy;
      this.anchorAt = now;
    }
    map.addInterest(this.wander, now < this.unstickUntil ? 0.6 : 0.015, 1);

    // commit to a way out while fleeing (dithering between two exits is how coins get caught)
    let angle = map.choose(this.prevAngle, 1.0, 0.12 + 0.25 * flee);
    const noise = P.aimNoise * (dangerLevel > 0.8 ? 0.5 : 1) * (mistake ? 3 : 1);
    angle += (rng() * 2 - 1) * noise;
    this.prevAngle = angle;

    /* ---------- how far ahead to aim (regroup before merging) ---------- */
    let aim = big.r + 320;
    if (split && dangerLevel < 0.2) {
      let lastMerge = 0;
      for (const c of me.cells) lastMerge = Math.max(lastMerge, c.mergeAt);
      const preyClose = bestPrey !== null && Math.hypot(bestPrey.x - big.x, bestPrey.y - big.y) < big.r + 250;
      if (now >= lastMerge - 1500 && !preyClose) aim = big.r * 0.5 + 40;
    }
    d.target.x = cx + Math.cos(angle) * aim;
    d.target.y = cy + Math.sin(angle) * aim;

    /* ---------- split attack (single or double) ---------- */
    const maxCellsForSplit = P.skill === 2 ? 4 : 2;
    if (bestPrey && !shielded && now >= this.splitCooldownUntil && nCells <= maxCellsForSplit && P.splitBravery > 0) {
      const splits = this.splitPlan(bestPrey, big, me, now, mistake, dangerLevel);
      if (splits > 0 && rng() < P.splitBravery * 0.65) {
        const q = bestPrey;
        const s = P.leadsTargets ? this.seen.get(q.id) : undefined;
        const lead = splits === 2 ? 0.32 : 0.22;
        const lx = q.x + (s ? s.vx * lead : 0);
        const ly = q.y + (s ? s.vy * lead : 0);
        const dist = Math.hypot(lx - big.x, ly - big.y);
        const a = angleTo(big.x, big.y, lx, ly) + (rng() * 2 - 1) * P.aimNoise * 0.3;
        d.target.x = big.x + Math.cos(a) * (dist + 220);
        d.target.y = big.y + Math.sin(a) * (dist + 220);
        this.prevAngle = a;
        d.split = true;
        if (splits === 2) {
          this.followUpAt = now + DOUBLE_SPLIT_DELAY_MS;
          this.followUp.x = d.target.x;
          this.followUp.y = d.target.y;
          this.nextThinkAt = this.followUpAt;
        }
        this.splitCooldownUntil = now + 2500 + rng() * 2000;
      }
    }

    /* ---------- virus shot (hard bots) ---------- */
    if (!d.split && P.virusShooter && chaser && dangerLevel > 0.25 && dangerLevel < 0.9 && total > 150) {
      if (chaser.mass > RULES.virusMass * RULES.virusPopRatio * 1.5) {
        const aT = angleTo(big.x, big.y, chaser.x, chaser.y);
        const dT = Math.hypot(chaser.x - big.x, chaser.y - big.y);
        for (const v of viruses) {
          const dV = Math.hypot(v.x - big.x, v.y - big.y);
          if (dV > dT || dV > big.r + 380 || dV < big.r + v.r + 120) continue;
          if (Math.abs(angleDiff(angleTo(big.x, big.y, v.x, v.y), aT)) > 0.28) continue;
          this.shooting = true;
          this.shootTarget.x = v.x;
          this.shootTarget.y = v.y;
          this.shootUntil = now + 900;
          d.target.x = v.x;
          d.target.y = v.y;
          d.eject = true;
          break;
        }
      }
    }

    // think a little sooner while in danger (good bots), never every tick
    const busy = P.skill > 0 && dangerLevel > 0.5 ? 0.7 : 1;
    if (this.followUpAt === 0) this.nextThinkAt = now + P.thinkMs * busy * (0.85 + rng() * 0.3);
    this.me = null;
    return emit(d);
  }

  /**
   * How many splits (0, 1 or 2) land on `q` safely. A split is planned on where the prey will be
   * when the half arrives; it is off when something else could eat a half near the landing spot
   * or near the half left behind, or when a bush sits on the prey (for a half that would pop).
   */
  private splitPlan(q: Cell, big: Cell, me: Player, now: number, mistake: boolean, dangerLevel: number): number {
    const P = this.personality;
    if (!q.player.isBot && now - q.player.stats.joinedAt < NEWBIE_GRACE_MS) return 0;
    if (q.player.shieldUntil > now) return 0;
    const half = big.mass / 2;
    // the prey keeps eating coins on the way: keep a small margin
    if (!canEat(half, q.mass * 1.03)) return 0;
    const s = P.leadsTargets ? this.seen.get(q.id) : undefined;
    const flight = 0.3;
    const qx = q.x + (s ? s.vx * flight : 0);
    const qy = q.y + (s ? s.vy * flight : 0);
    const dist = Math.hypot(qx - big.x, qy - big.y);
    const hr = massToRadius(half);
    // a careless bot misjudges its reach now and then
    const misjudge = mistake ? 1.25 + this.rng() * 0.25 : 1;
    const reach1 = (SPLIT_REACH * 0.85 + big.r * 0.25) * misjudge;
    let splits = 0;
    if (dist - hr * 0.6 < reach1 && dist > big.r * 0.5) splits = 1;
    else if (P.doubleSplit && me.cells.length === 1 && canEat(half / 2, q.mass * 1.03)) {
      const qr = massToRadius(half / 2);
      if (dist - qr * 0.6 < SPLIT_REACH * DOUBLE_REACH * 0.92 && dist > big.r) splits = 2;
    }
    if (splits === 0) return 0;
    if (mistake) return splits; // the slip: no safety check this time
    if (dangerLevel > 0.5) return 0;
    const piece = splits === 2 ? half / 2 : half;
    const pieceR = massToRadius(piece);
    for (const o of this.others) {
      if (o.player === q.player) continue;
      if (!canEat(o.mass, piece)) continue;
      const oReach = o.r + (canEat(o.mass / 2, piece) ? SPLIT_REACH : 0) + 250;
      if (Math.hypot(o.x - qx, o.y - qy) < oReach || Math.hypot(o.x - big.x, o.y - big.y) < oReach) return 0;
    }
    if (piece > RULES.virusMass * RULES.virusPopRatio) {
      for (const v of this.viruses) {
        // anywhere along the flight line, close to the landing spot
        if (Math.hypot(v.x - qx, v.y - qy) < v.r + pieceR + 30) return 0;
        const t = clamp(((v.x - big.x) * (qx - big.x) + (v.y - big.y) * (qy - big.y)) / Math.max(1, dist * dist), 0, 1);
        if (Math.hypot(big.x + (qx - big.x) * t - v.x, big.y + (qy - big.y) * t - v.y) < v.r + pieceR * 0.8) return 0;
      }
    }
    return splits;
  }
}
