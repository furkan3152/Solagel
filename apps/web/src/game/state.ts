import {
  EMOTE_DURATION_MS,
  EntityKind,
  HAS_PLAYER,
  HAS_VARIANT,
  PlayerFlag,
  avatarIdEquals,
  avatarIdFromBytes,
  decodeUtf8,
  readSnapshot,
  type PlayerInfo,
  type ServerMessage,
  type SnapshotData,
  type SnapshotSink,
} from '@elymum/shared';
import type { Expression } from '@elymum/art';
import { JellyBody } from '../render/jelly';

/** Movement between two snapshots is eased over this window (classic agar feel). */
const LERP_MS = 120;
const DIE_MS = 160;
/** Loot is sucked into the eater a little slower, so the pickup reads. */
const LOOT_DIE_MS = 240;

export type ValueMessage = Extract<ServerMessage, { t: 'value' }>;

/** A floating "+X" ink number queued by a `value` message (world coordinates). */
export interface ValueFloat {
  x: number;
  y: number;
  delta: number;
  reason: ValueMessage['reason'];
  at: number;
}

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
  | { type: 'powerup'; eaterId: number; x: number; y: number; mine: boolean }
  | { type: 'loot'; eaterId: number; x: number; y: number; variant: number; mine: boolean };

/** My cells' totals (`myStats`): one object, rewritten on every call. */
export interface MyStats {
  x: number;
  y: number;
  mass: number;
  count: number;
  maxR: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Client-side mirror of the visible world with interpolation. A `SnapshotSink`: binary snapshots
 * are applied record by record (`applyBinary`), with no garbage per record.
 */
export class ClientWorld implements SnapshotSink {
  readonly entities = new Map<number, CEntity>();
  readonly players = new Map<number, CPlayer>();
  myPid: number | null = null;
  serverView = { x: 0, y: 0, h: 1200, at: 0 };
  width = 6800;
  height = 6800;
  lastSnapshotAt = 0;
  /** Arena rooms: my in-game value (raw token units), null outside arenas. */
  value: number | null = null;
  private eatQueue: EatEvent[] = [];
  private floatQueue: ValueFloat[] = [];
  /** The drained queues' arrays, handed back on the next drain (two arrays swap: no garbage per frame). */
  private eatSpare: EatEvent[] = [];
  private floatSpare: ValueFloat[] = [];
  private readonly stats: MyStats = { x: 0, y: 0, mass: 0, count: 0, maxR: 0, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } };
  private readonly exprCells: CEntity[] = [];
  /** Each player's name bytes as last decoded (a name is decoded again only when its bytes change). */
  private readonly nameBytes = new Map<number, Uint8Array>();
  private applyAt = 0;

  reset(): void {
    this.entities.clear();
    this.players.clear();
    this.myPid = null;
    this.value = null;
    this.eatQueue = [];
    this.floatQueue = [];
    this.nameBytes.clear();
  }

  /**
   * Arena `value` message: keeps the value and queues a floating number that
   * rises from the top of my biggest cell (nothing to float without a cell or
   * without a change).
   */
  applyValue(m: ValueMessage, now: number): void {
    this.value = m.value;
    if (m.delta === 0) return;
    let best: CEntity | null = null;
    for (const c of this.myCells()) if (!best || c.r > best.r) best = c;
    if (!best) return;
    this.floatQueue.push({ x: best.x, y: best.y - best.r * 0.9, delta: m.delta, reason: m.reason, at: now });
  }

  drainFloats(): ValueFloat[] {
    const q = this.floatQueue;
    this.floatQueue = this.floatSpare;
    this.floatQueue.length = 0;
    this.floatSpare = q;
    return q;
  }

  /** Applies a decoded snapshot (tests, and snapshots held back during the bell's freeze). */
  apply(s: SnapshotData, now: number): void {
    this.applyAt = now;
    this.snapshotBegin(s.tick, s.view.x, s.view.y, s.view.h);
    for (const p of s.players) this.setPlayer(p.id, p.skin, p.flags, p.name, p.isBot ? undefined : p.avatar);
    for (const u of s.upserts) {
      const has = (u.playerId !== undefined || u.flags !== undefined ? HAS_PLAYER : 0) | (u.variant !== undefined ? HAS_VARIANT : 0);
      this.upsert(u.id, u.kind, u.x, u.y, u.r, has, u.playerId, u.flags, u.variant);
    }
    for (const rm of s.removals) this.snapshotRemoval(rm.id, rm.eaterId);
  }

  /** Applies a binary snapshot straight from the wire (no intermediate records). */
  applyBinary(buf: ArrayBuffer, now: number): void {
    this.applyAt = now;
    readSnapshot(buf, this);
  }

  snapshotBegin(_tick: number, x: number, y: number, h: number): void {
    const now = this.applyAt;
    this.lastSnapshotAt = now;
    const v = this.serverView;
    v.x = x;
    v.y = y;
    v.h = h;
    v.at = now;
  }

  snapshotPlayer(id: number, skin: number, flags: number, bytes: Uint8Array, at: number, len: number, avatarAt = -1): void {
    // the name is decoded only when its bytes change (a snapshot carries every visible player 30 times a second)
    let known = this.nameBytes.get(id);
    const p = this.players.get(id);
    let same = !!p && !!known && known.length === len;
    for (let i = 0; same && i < len; i++) if (known![i] !== bytes[at + i]) same = false;
    if (!same) {
      known = bytes.slice(at, at + len);
      this.nameBytes.set(id, known);
    }
    // the avatar id (bots never wear one) is turned into a string only when it changes
    let avatar: string | undefined;
    if (avatarAt >= 0 && (flags & PlayerFlag.Bot) === 0) avatar = p && avatarIdEquals(p.avatar, bytes, avatarAt) ? p.avatar : avatarIdFromBytes(bytes, avatarAt);
    this.setPlayer(id, skin, flags, same ? p!.name : decodeUtf8(bytes, at, len), avatar);
  }

  private setPlayer(id: number, skin: number, flags: number, name: string, avatar?: string): void {
    const existing = this.players.get(id);
    if (existing) {
      existing.skin = skin;
      existing.flags = flags;
      existing.name = name;
      existing.isBot = (flags & PlayerFlag.Bot) !== 0;
      if ((flags & PlayerFlag.Holder) !== 0) existing.holder = true;
      else if (existing.holder) delete existing.holder;
      if (avatar && !existing.isBot) existing.avatar = avatar;
      else if (existing.avatar) delete existing.avatar;
    } else {
      const p: CPlayer = { id, skin, flags, name, isBot: (flags & PlayerFlag.Bot) !== 0, emote: null };
      if ((flags & PlayerFlag.Holder) !== 0) p.holder = true;
      if (avatar && !p.isBot) p.avatar = avatar;
      this.players.set(id, p);
    }
  }

  snapshotUpsert(id: number, kind: EntityKind, x: number, y: number, r: number, has: number, playerId: number, flags: number, variant: number): void {
    this.upsert(id, kind, x, y, r, has, playerId, flags, variant);
  }

  private upsert(id: number, kind: EntityKind, x: number, y: number, r: number, has: number, playerId: number | undefined, flags: number | undefined, variant: number | undefined): void {
    const now = this.applyAt;
    const e = this.entities.get(id);
    if (!e || e.dying) {
      this.entities.set(id, {
        id,
        kind,
        x,
        y,
        r,
        ox: x,
        oy: y,
        or: r,
        nx: x,
        ny: y,
        nr: r,
        t0: now,
        playerId: playerId ?? 0,
        flags: flags ?? 0,
        variant: variant ?? 0,
        born: now,
        dying: 0,
        eater: 0,
        dieX: 0,
        dieY: 0,
        dieR: 0,
        jelly: kind === EntityKind.Cell ? new JellyBody() : null,
        vx: 0,
        vy: 0,
        seed: ((id * 2654435761) % 1000) / 1000,
        expression: 'happy',
      });
      return;
    }
    e.ox = e.x;
    e.oy = e.y;
    e.or = e.r;
    e.nx = x;
    e.ny = y;
    e.nr = r;
    e.t0 = now;
    if (has & HAS_PLAYER) {
      if (flags !== undefined) e.flags = flags;
      if (playerId !== undefined) e.playerId = playerId;
    }
    if (has & HAS_VARIANT && variant !== undefined) e.variant = variant;
  }

  snapshotRemoval(id: number, eaterId: number): void {
    const e = this.entities.get(id);
    if (!e || e.dying) return;
    e.dying = this.applyAt;
    e.eater = eaterId;
    e.dieX = e.x;
    e.dieY = e.y;
    e.dieR = e.r;
    if (eaterId) this.queueEat(e, eaterId);
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
      case EntityKind.Loot:
        this.eatQueue.push({ type: 'loot', eaterId, x: e.x, y: e.y, variant: e.variant, mine });
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

  /** The eats since the last drain; the array is reused by the drain after next (read it right away). */
  drainEats(): EatEvent[] {
    const q = this.eatQueue;
    this.eatQueue = this.eatSpare;
    this.eatQueue.length = 0;
    this.eatSpare = q;
    return q;
  }

  /** Advances interpolation and removal animations. */
  update(now: number, dt: number): void {
    // bound forEach callbacks: a Map iterator makes a result object per entity per frame
    this.stepNow = now;
    this.stepDt = dt;
    this.entities.forEach(this.step);
    this.players.forEach(this.expireEmote);
  }

  private stepNow = 0;
  private stepDt = 0;
  private readonly expireEmote = (p: CPlayer): void => {
    if (p.emote && this.stepNow - p.emote.at > EMOTE_DURATION_MS) p.emote = null;
  };

  private readonly step = (e: CEntity): void => {
    const now = this.stepNow;
    const dt = this.stepDt;
    {
      if (e.dying) {
        const p = Math.min(1, (now - e.dying) / (e.kind === EntityKind.Loot ? LOOT_DIE_MS : DIE_MS));
        const eater = e.eater ? this.entities.get(e.eater) : undefined;
        if (eater && !eater.dying) {
          // ease-in: the piece hesitates, then gets gulped
          const k = e.kind === EntityKind.Loot ? p * p : p;
          e.x = e.dieX + (eater.x - e.dieX) * k;
          e.y = e.dieY + (eater.y - e.dieY) * k;
        }
        e.r = e.dieR * (1 - p);
        if (p >= 1) this.entities.delete(e.id);
        return;
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
  };

  myCells(): CEntity[] {
    const out: CEntity[] = [];
    if (this.myPid === null) return out;
    for (const e of this.entities.values()) if (e.kind === EntityKind.Cell && e.playerId === this.myPid && !e.dying) out.push(e);
    return out;
  }

  /**
   * Mass-weighted centre and totals of my cells, or null without any. The returned object is
   * reused (rewritten by the next call: read it right away; the frame asks a few times).
   */
  myStats(): MyStats | null {
    if (this.myPid === null) return null;
    const a = this.acc;
    a.m = a.x = a.y = a.maxR = a.count = 0;
    const out = this.stats;
    const bbox = out.bbox;
    bbox.x0 = Infinity;
    bbox.y0 = Infinity;
    bbox.x1 = -Infinity;
    bbox.y1 = -Infinity;
    this.entities.forEach(this.addMine);
    if (a.count === 0) return null;
    out.x = a.x / a.m;
    out.y = a.y / a.m;
    out.mass = a.m;
    out.count = a.count;
    out.maxR = a.maxR;
    return out;
  }

  /** `myStats` running sums (fields, not locals: the forEach callback adds into them). */
  private readonly acc = { m: 0, x: 0, y: 0, maxR: 0, count: 0 };
  private readonly addMine = (c: CEntity): void => {
    if (c.kind !== EntityKind.Cell || c.playerId !== this.myPid || c.dying) return;
    const a = this.acc;
    const bbox = this.stats.bbox;
    const mass = (c.nr * c.nr) / 100;
    a.count++;
    a.m += mass;
    a.x += c.x * mass;
    a.y += c.y * mass;
    a.maxR = Math.max(a.maxR, c.r);
    bbox.x0 = Math.min(bbox.x0, c.x - c.r);
    bbox.y0 = Math.min(bbox.y0, c.y - c.r);
    bbox.x1 = Math.max(bbox.x1, c.x + c.r);
    bbox.y1 = Math.max(bbox.y1, c.y + c.r);
  };

  isBot(pid: number): boolean {
    return ((this.players.get(pid)?.flags ?? 0) & PlayerFlag.Bot) !== 0;
  }

  /** Updates per-cell expressions: scared near threats, hungry near prey. */
  computeExpressions(now: number): void {
    // live cells are exprCells[0 … n) (the array never shrinks: no regrowth every pass)
    const cells = this.exprCells;
    let n = 0;
    for (const e of this.entities.values()) if (e.kind === EntityKind.Cell && !e.dying) cells[n++] = e;
    for (let i = 0; i < n; i++) {
      const a = cells[i];
      let expr: Expression = 'happy';
      let bestThreat = Infinity;
      let bestPrey = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = cells[j];
        if (b.playerId === a.playerId) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy) - a.r - b.r;
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
