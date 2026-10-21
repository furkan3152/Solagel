import { ClientOp, type ClientInput, type IntegrityTransfer } from '@slana/shared';
import type { Player } from '../game/entities';
import { MAX_REACTION_SAMPLES, emptyInput, turnBin, type SessionSummary } from './types';

/** Gaps between target messages longer than this are pauses, not timing samples. */
const MAX_GAP_MS = 2000;
/** A threat is a player at least this many times bigger whose edge is within `THREAT_GAP` of ours. */
const THREAT_RATIO = 1.3;
const THREAT_GAP = 250;
/** A reaction must come within this long of the threat appearing. */
const REACTION_WINDOW_MS = 1500;
/** Suicide feeding: a "much bigger" staker (mass ratio) within this edge gap is watched. */
const FEED_RATIO = 2;
const FEED_GAP = 900;
/** Approach samples kept per ticket (the last few seconds before a death). */
const APPROACH_KEEP = 16;
const APPROACH_WINDOW_MS = 3000;
/** Wallets kept in a ticket's eject `eatenBy` map. */
const EJECT_EATERS_MAX = 8;

interface Approach {
  t: number;
  wallet: string;
  toward: boolean;
}

/** Mutable per-ticket accumulators (one per staker in an arena instance). */
class Tracker {
  readonly s: SessionSummary;
  lastInputAt = -1;
  lastAimX = NaN;
  lastAimY = NaN;
  lastAngle = NaN;
  headingX = 0;
  headingY = 0;
  afkSince: number | null = null;
  /** The threat currently close (player id) and a pending stimulus waiting for a turn away. */
  threatPid = -1;
  stimulus: { t: number; x: number; y: number } | null = null;
  readonly approach: Approach[] = [];

  constructor(s: SessionSummary) {
    this.s = s;
  }
}

export interface MonitorRoom {
  readonly id: string;
  now(): number;
  round(now?: number): { n: number; endsAt: number; joinsCloseAt: number } | undefined;
  readonly opts: { stake?: { arenaId: number; buyIn: number } };
}

export interface JoinInfo {
  wallet: string;
  session: string;
  sessionId: number;
  arenaId: number;
  entryFee: number;
  ipHash: string;
  fpHash: string | null;
}

export interface MonitorOptions {
  /** Monotonic clock for input timing (ms); defaults to `performance.now`. */
  mono?: () => number;
  /** Receives every finished ticket. */
  onSession: (s: SessionSummary) => void;
  /** Receives every staker-to-staker value transfer. */
  onTransfer: (t: IntegrityTransfer) => void;
}

/**
 * Per-ticket telemetry of the arena instances. Every hook is O(1) (or O(players) for the sampled
 * threat check every few ticks) and allocates nothing per input; memory is bounded by the live
 * tickets (the service keeps the finished ones in a capped window).
 */
export class IntegrityMonitor {
  private readonly rooms = new Map<string, Map<number, Tracker>>();
  private readonly mono: () => number;
  /** Reused buffers of the threat sampler. */
  private bufX = new Float64Array(64);
  private bufY = new Float64Array(64);
  private bufM = new Float64Array(64);
  private bufR = new Float64Array(64);

  constructor(private readonly opts: MonitorOptions) {
    this.mono = opts.mono ?? (() => performance.now());
  }

  private tracker(roomId: string, pid: number): Tracker | undefined {
    return this.rooms.get(roomId)?.get(pid);
  }

  /** A staker joined an arena instance with a ticket. */
  onJoin(room: MonitorRoom, pid: number, j: JoinInfo): void {
    const now = room.now();
    const r = room.round(now);
    const roundMs = r ? r.endsAt : now;
    let m = this.rooms.get(room.id);
    if (!m) this.rooms.set(room.id, (m = new Map()));
    m.set(
      pid,
      new Tracker({
        key: `${j.session}#${j.sessionId}`,
        wallet: j.wallet,
        arenaId: j.arenaId,
        roomId: room.id,
        entryFee: j.entryFee,
        round: r?.n ?? 0,
        // round n runs [n·len, (n+1)·len), so its length is endsAt / (n + 1)
        roundStartsAt: r && r.n >= 0 ? r.endsAt - r.endsAt / (r.n + 1) : now,
        joinsCloseAt: r?.joinsCloseAt ?? roundMs,
        roundEndsAt: roundMs,
        joinedAt: now,
        endedAt: null,
        endReason: null,
        payout: null,
        ipHash: j.ipHash,
        fpHash: j.fpHash,
        afkMs: 0,
        afkAtEnd: false,
        receivedWhileAfk: 0,
        input: emptyInput(),
        ejects: { eatenBy: {}, eatenOther: 0 },
        death: null,
      }),
    );
  }

  /** A staker's input message (target, split or eject). Hot path: O(1), no allocation. */
  onInput(roomId: string, p: Player, input: ClientInput): void {
    const tr = this.tracker(roomId, p.id);
    if (!tr) return;
    const st = tr.s.input;
    if (input.op === ClientOp.Split) {
      st.splits++;
      return;
    }
    if (input.op === ClientOp.Eject) {
      st.ejects++;
      return;
    }
    if (input.op !== ClientOp.Target) return;
    // an unchanged aim is a keep-alive, not a mouse movement
    if (Math.abs(input.x - tr.lastAimX) + Math.abs(input.y - tr.lastAimY) <= 1.5) return;
    tr.lastAimX = input.x;
    tr.lastAimY = input.y;
    st.aims++;
    if (Number.isInteger(input.x) && Number.isInteger(input.y)) st.intAims++;
    const t = this.mono();
    if (tr.lastInputAt >= 0) {
      const dt = t - tr.lastInputAt;
      if (dt >= 0 && dt <= MAX_GAP_MS) {
        st.n++;
        const d = dt - st.meanMs;
        st.meanMs += d / st.n;
        st.m2 += d * (dt - st.meanMs);
      }
    }
    tr.lastInputAt = t;
    // direction relative to the coin's centre (mass-weighted; at most 16 cells)
    let m = 0;
    let cx = 0;
    let cy = 0;
    for (const c of p.cells) {
      m += c.mass;
      cx += c.x * c.mass;
      cy += c.y * c.mass;
    }
    if (m <= 0) return;
    cx /= m;
    cy /= m;
    const hx = input.x - cx;
    const hy = input.y - cy;
    if (hx * hx + hy * hy < 1) return;
    const a = Math.atan2(hy, hx);
    if (!Number.isNaN(tr.lastAngle)) {
      let turn = Math.abs(a - tr.lastAngle);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      st.turnHist[turnBin((turn * 180) / Math.PI)]++;
    }
    tr.lastAngle = a;
    tr.headingX = hx;
    tr.headingY = hy;
    const s = tr.stimulus;
    if (s) {
      if (t - s.t > REACTION_WINDOW_MS) tr.stimulus = null;
      else {
        const tx = s.x - cx;
        const ty = s.y - cy;
        const len = Math.hypot(hx, hy) * Math.hypot(tx, ty);
        if (len > 0 && (hx * tx + hy * ty) / len < -0.2) {
          if (st.reactionMs.length < MAX_REACTION_SAMPLES) st.reactionMs.push(Math.round(t - s.t));
          tr.stimulus = null;
        }
      }
    }
  }

  /** A staker went idle (disconnected, cells left in the arena) or came back. */
  onAfk(roomId: string, pid: number, afk: boolean, wallNow: number): void {
    const tr = this.tracker(roomId, pid);
    if (!tr) return;
    if (afk) {
      if (tr.afkSince === null) tr.afkSince = wallNow;
      tr.stimulus = null;
      tr.lastInputAt = -1;
    } else if (tr.afkSince !== null) {
      tr.s.afkMs += Math.max(0, wallNow - tr.afkSince);
      tr.afkSince = null;
    }
  }

  /** Value moved from one staker to another (one eaten cell). `others`: stakers in the instance besides the victim. */
  onTransfer(room: MonitorRoom, victimPid: number, eaterPid: number, amount: number, others: number, afkEater: boolean): void {
    if (amount <= 0) return;
    const v = this.tracker(room.id, victimPid);
    const e = this.tracker(room.id, eaterPid);
    if (!v || !e) return;
    if (afkEater) e.s.receivedWhileAfk += amount;
    this.opts.onTransfer({
      at: room.now(),
      arenaId: v.s.arenaId,
      roomId: room.id,
      round: v.s.round,
      from: v.s.wallet,
      to: e.s.wallet,
      amount,
      fee: room.opts.stake?.buyIn ?? v.s.entryFee,
      fromKey: v.s.key,
      toKey: e.s.key,
      others,
      afkEater,
    });
  }

  /** A player ate an ejected blob. Counted for the thrower when the thrower is a tracked staker. */
  onEjectEaten(roomId: string, ownerPid: number, eaterPid: number): void {
    const owner = this.tracker(roomId, ownerPid);
    if (!owner || ownerPid === eaterPid) return;
    const ej = owner.s.ejects;
    const eater = this.tracker(roomId, eaterPid);
    if (eater && eater.s.wallet !== owner.s.wallet) {
      const w = eater.s.wallet;
      if (w in ej.eatenBy || Object.keys(ej.eatenBy).length < EJECT_EATERS_MAX) ej.eatenBy[w] = (ej.eatenBy[w] ?? 0) + 1;
      else ej.eatenOther++;
    } else ej.eatenOther++;
  }

  /**
   * Sampled every few ticks: for each tracked staker, the nearest threat (reaction latency) and the
   * nearest much bigger staker it is moving toward (suicide feeding). O(stakers × players).
   */
  sample(roomId: string, players: Iterable<Player>, wallNow: number): void {
    const m = this.rooms.get(roomId);
    if (!m || m.size === 0) return;
    // one pass over every player: centre, mass, radius
    const list: Player[] = [];
    for (const p of players) if (p.alive && p.cells.length > 0) list.push(p);
    if (list.length > this.bufX.length) {
      const n = list.length * 2;
      this.bufX = new Float64Array(n);
      this.bufY = new Float64Array(n);
      this.bufM = new Float64Array(n);
      this.bufR = new Float64Array(n);
    }
    for (let i = 0; i < list.length; i++) {
      let mass = 0;
      let x = 0;
      let y = 0;
      let r = 0;
      for (const c of list[i].cells) {
        mass += c.mass;
        x += c.x * c.mass;
        y += c.y * c.mass;
        if (c.r > r) r = c.r;
      }
      this.bufX[i] = mass > 0 ? x / mass : 0;
      this.bufY[i] = mass > 0 ? y / mass : 0;
      this.bufM[i] = mass;
      this.bufR[i] = r;
    }
    const t = this.mono();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const tr = m.get(p.id);
      if (!tr || p.afk) continue;
      const ax = this.bufX[i];
      const ay = this.bufY[i];
      const am = this.bufM[i];
      const ar = this.bufR[i];
      let threat = -1;
      let threatGap = Infinity;
      let feed = -1;
      let feedGap = Infinity;
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const bm = this.bufM[j];
        if (bm < am * THREAT_RATIO) continue;
        const gap = Math.hypot(this.bufX[j] - ax, this.bufY[j] - ay) - this.bufR[j] - ar;
        if (gap < THREAT_GAP && gap < threatGap) {
          threat = j;
          threatGap = gap;
        }
        if (bm >= am * FEED_RATIO && gap < FEED_GAP && gap < feedGap && m.has(list[j].id)) {
          feed = j;
          feedGap = gap;
        }
      }
      // reaction: a threat that was not there at the last sample, while we were moving toward it
      const threatPid = threat >= 0 ? list[threat].id : -1;
      if (threatPid !== tr.threatPid) {
        tr.threatPid = threatPid;
        tr.stimulus = null;
        if (threat >= 0 && this.toward(tr, this.bufX[threat] - ax, this.bufY[threat] - ay, 0.3)) {
          tr.stimulus = { t, x: this.bufX[threat], y: this.bufY[threat] };
        }
      }
      if (feed >= 0) {
        const other = m.get(list[feed].id)!;
        const ap = tr.approach;
        if (ap.length >= APPROACH_KEEP) ap.shift();
        ap.push({ t: wallNow, wallet: other.s.wallet, toward: this.toward(tr, this.bufX[feed] - ax, this.bufY[feed] - ay, 0.7) });
      }
    }
  }

  private toward(tr: Tracker, dx: number, dy: number, minCos: number): boolean {
    const len = Math.hypot(tr.headingX, tr.headingY) * Math.hypot(dx, dy);
    return len > 0 && (tr.headingX * dx + tr.headingY * dy) / len > minCos;
  }

  /**
   * The ticket ended (death, bell, kick, age limit): returns its finished summary (also handed to
   * `onSession`). `killer`: the staker's eater when it died (any player; bots count as no wallet).
   */
  onEnd(room: MonitorRoom, pid: number, end: { reason: string; payout: number; killer: Player | null; killerIsBot: boolean }): SessionSummary | null {
    const m = this.rooms.get(room.id);
    const tr = m?.get(pid);
    if (!m || !tr) return null;
    m.delete(pid);
    if (m.size === 0) this.rooms.delete(room.id);
    const now = room.now();
    const s = tr.s;
    s.endedAt = now;
    s.endReason = end.reason;
    s.payout = end.payout;
    s.afkAtEnd = tr.afkSince !== null;
    if (tr.afkSince !== null) s.afkMs += Math.max(0, now - tr.afkSince);
    if (end.reason === 'death') {
      const by = end.killer && !end.killerIsBot ? (m.get(end.killer.id)?.s.wallet ?? null) : null;
      const recent = tr.approach.filter((a) => now - a.t <= APPROACH_WINDOW_MS);
      const toward = by ? recent.filter((a) => a.wallet === by && a.toward).length : 0;
      s.death = { by, byBot: end.killerIsBot, approach: recent.length > 0 ? toward / recent.length : 0, samples: recent.length };
    }
    this.opts.onSession(s);
    return s;
  }

  /** Summaries of the tickets still in play (copies, for the detectors). */
  live(): SessionSummary[] {
    const out: SessionSummary[] = [];
    for (const m of this.rooms.values()) for (const tr of m.values()) out.push({ ...tr.s, afkMs: tr.s.afkMs, input: { ...tr.s.input, turnHist: [...tr.s.input.turnHist], reactionMs: [...tr.s.input.reactionMs] } });
    return out;
  }

  /** Tickets tracked right now. */
  get size(): number {
    let n = 0;
    for (const m of this.rooms.values()) n += m.size;
    return n;
  }
}
