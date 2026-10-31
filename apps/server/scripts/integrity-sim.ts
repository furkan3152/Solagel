/**
 * Integrity simulation: a paid arena instance with honest stakers (bot brains behind an emulated
 * web client: frame-budgeted target messages, mouse smoothing and jitter, human reaction delay,
 * network latency), optionally plus scripted cheaters, over several short rounds.
 *
 *   pnpm -F @elymum/server integrity-sim [minutes=6] [seed=1]
 *
 * Prints the flags the detectors raise at the default thresholds and the room tick time with and
 * without the integrity telemetry (same seed, same game). The test suite runs the same harness.
 */
import { pathToFileURL } from 'node:url';
import { ClientOp, PlayerFlag, TICK_MS, roundAt, type ClientInput, type IntegrityFlag } from '@elymum/shared';
import { BotBrain } from '../src/bots/brain';
import { rollPersonality } from '../src/bots/personality';
import { NullChain } from '../src/chain/types';
import type { Player } from '../src/game/entities';
import { mulberry32, type Rng } from '../src/game/rng';
import { IntegrityService } from '../src/integrity/service';
import { IntegrityStore } from '../src/integrity/store';
import { Leaderboards } from '../src/leaderboards';
import { Conn } from '../src/net/conn';
import { Room } from '../src/rooms/room';
import { Journal } from '../src/stake/journal';

export interface SimOptions {
  minutes?: number;
  seed?: number;
  /** Honest stakers (default 12). */
  honest?: number;
  /** Scripted bots: perfectly periodic input aimed at exact points (default 0). */
  scripted?: number;
  /** Attach the integrity telemetry (default true). */
  integrity?: boolean;
  /** Round length (default 60 s, joins close 15 s before the bell). */
  round?: { roundMs: number; closeMs: number };
}

export interface SimResult {
  flags: IntegrityFlag[];
  integrity: IntegrityService | null;
  journal: Journal;
  ticks: number;
  /** Mean µs per room tick (inputs included), and the 99th percentile. */
  tickUs: number;
  tickP99Us: number;
  tickets: number;
  rounds: number;
  transfers: number;
}

const FEE = 1_000_000;

function fakeConn(wallet: string, ip: string): Conn {
  const ws = { readyState: 1, bufferedAmount: 0, send() {} };
  const conn = new Conn(ws as never, ip);
  conn.wallet = wallet;
  return conn;
}

/** A gaussian-ish sample (sum of uniforms). */
const noise = (rng: Rng) => rng() + rng() + rng() - 1.5;

interface Pending {
  at: number;
  input: ClientInput;
}

interface Client {
  wallet: string;
  conn: Conn;
  scripted: boolean;
  brain: BotBrain;
  /** Base one-way latency (ms) and its jitter. */
  latency: number;
  jitter: number;
  /** Human reaction delay before a decision reaches the mouse (ms). */
  reaction: number;
  mouse: { x: number; y: number } | null;
  goal: { x: number; y: number } | null;
  /** Decisions waiting for the human to react. */
  decisions: { at: number; target: { x: number; y: number }; split: boolean; eject: boolean }[];
  lastSent: number;
  lastSentAim: { x: number; y: number };
  outbox: Pending[];
  sessions: number;
  nextScriptAt: number;
}

export function runIntegritySim(o: SimOptions = {}): SimResult {
  const minutes = o.minutes ?? 6;
  const rng = mulberry32(o.seed ?? 1);
  const ROUND = o.round ?? { roundMs: 60_000, closeMs: 15_000 };
  let clock = roundAt(1_791_000_000_000, ROUND.roundMs, ROUND.closeMs).startsAt + 3_000;
  let mono = 1_000_000;
  const journal = new Journal(null);
  const integrity =
    o.integrity === false ? null : new IntegrityService({ store: new IntegrityStore(null), journal, kick: () => {}, now: () => clock, mono: () => mono });
  const room = new Room(
    { id: 'arena-1-1', mode: 'arena', name: 'Arena', maxPlayers: 50, instance: 1, bots: { target: 20, min: 6, max: 10 }, stake: { arenaId: 1, buyIn: FEE }, seed: (o.seed ?? 1) * 7919 },
    { chain: new NullChain(), journal, leaderboards: new Leaderboards(null), log: () => {}, now: () => clock, round: ROUND, integrity: integrity ?? undefined },
  );
  const world = room.world;

  let sessionSeq = 0;
  let tickets = 0;
  const clients: Client[] = [];
  const mk = (i: number, scripted: boolean): Client => ({
    wallet: `${scripted ? 'Script' : 'Honest'}Wallet${i}`,
    conn: fakeConn(`${scripted ? 'Script' : 'Honest'}Wallet${i}`, `10.${scripted ? 9 : 1}.${i >> 8}.${i & 255}`),
    scripted,
    brain: new BotBrain(rollPersonality(rng, 'standard'), rng),
    latency: 15 + rng() * 90,
    jitter: 2 + rng() * 10,
    reaction: 190 + rng() * 140,
    mouse: null,
    goal: null,
    decisions: [],
    lastSent: -1e9,
    lastSentAim: { x: NaN, y: NaN },
    outbox: [],
    sessions: 0,
    nextScriptAt: 0,
  });
  for (let i = 0; i < (o.honest ?? 12); i++) clients.push(mk(i, false));
  for (let i = 0; i < (o.scripted ?? 0); i++) clients.push(mk(i, true));
  for (const c of clients) {
    c.conn.fp = (c.scripted ? 'b' : 'a').repeat(8) + (clients.indexOf(c) + 1).toString(16).padStart(24, '0');
  }

  const join = (c: Client) => {
    const n = ++sessionSeq;
    tickets++;
    c.sessions++;
    room.join(c.conn, {
      name: c.wallet.slice(0, 12),
      skin: 1,
      flags: PlayerFlag.Staker,
      stake: { player: c.wallet, session: `Session${n}`, sessionId: n, arenaId: 1, entryFee: FEE, value: FEE, openedAt: Math.floor(clock / 1000) },
    });
    c.mouse = null;
    c.goal = null;
    c.decisions = [];
    c.outbox = [];
  };
  for (const c of clients) join(c);

  const send = (c: Client, input: ClientInput, at: number) => {
    const arrive = at + Math.max(1, c.latency + noise(rng) * c.jitter);
    c.outbox.push({ at: arrive, input });
  };

  const ticks = Math.round((minutes * 60_000) / TICK_MS);
  const samples: number[] = [];
  let rounds = 0;
  let lastRound = roundAt(clock, ROUND.roundMs, ROUND.closeMs).n;
  for (let t = 0; t < ticks; t++) {
    const tickStart = mono;
    // client side: two 60 Hz frames per server tick
    for (const c of clients) {
      const p: Player | null = c.conn.player && c.conn.player.alive ? c.conn.player : null;
      if (!p) continue;
      const center = p.center();
      if (c.scripted) {
        // a script: one message every 50.000 ms exactly, aimed at an exact point (the nearest smaller coin's centre, or a circle)
        while (c.nextScriptAt <= tickStart + TICK_MS) {
          if (c.nextScriptAt >= tickStart) {
            // nothing to chase: circle around (the aim still changes with every message)
            const th = c.nextScriptAt / 900;
            let best: { x: number; y: number } = { x: Math.round(center.x + Math.cos(th) * 400), y: Math.round(center.y + Math.sin(th) * 400) };
            let bd = Infinity;
            for (const q of world.players.values()) {
              if (q === p || !q.alive || q.totalMass() * 1.3 > p.totalMass()) continue;
              const qc = q.center();
              const d = Math.hypot(qc.x - center.x, qc.y - center.y);
              if (d < bd && d < 1500) {
                bd = d;
                best = { x: Math.round(qc.x), y: Math.round(qc.y) };
              }
            }
            c.outbox.push({ at: c.nextScriptAt + 1, input: { op: ClientOp.Target, x: best.x, y: best.y } });
          }
          c.nextScriptAt = Math.max(c.nextScriptAt + 50, tickStart - 50);
        }
        continue;
      }
      // the brain stands in for the human's intent; the human reacts after a delay
      const now = world.now;
      if (c.brain.shouldThink(now)) {
        const d = c.brain.think(world, p, now);
        if (d) c.decisions.push({ at: tickStart + c.reaction + noise(rng) * 40, target: d.target, split: d.split, eject: d.eject });
      }
      for (let f = 0; f < 2; f++) {
        const ft = tickStart + f * (TICK_MS / 2) + noise(rng) * 1.5;
        while (c.decisions.length > 0 && c.decisions[0].at <= ft) {
          const d = c.decisions.shift()!;
          c.goal = d.target;
          if (d.split) send(c, { op: ClientOp.Split }, ft);
          if (d.eject) send(c, { op: ClientOp.Eject }, ft);
        }
        const goal = c.goal ?? center;
        // the mouse sits at an offset from the coin on screen: it eases toward the goal with hand jitter
        const off = c.mouse ?? { x: goal.x - center.x, y: goal.y - center.y };
        const want = { x: goal.x - center.x, y: goal.y - center.y };
        off.x += (want.x - off.x) * 0.25 + noise(rng) * 2.2;
        off.y += (want.y - off.y) * 0.25 + noise(rng) * 2.2;
        c.mouse = off;
        // the camera trails the coin a little, so the aim in world coordinates wobbles too
        const aim = { x: center.x + off.x + noise(rng) * 0.6, y: center.y + off.y + noise(rng) * 0.6 };
        const moved = Math.hypot(aim.x - c.lastSentAim.x, aim.y - c.lastSentAim.y) > 1.5;
        if (ft - c.lastSent < 33 || (!moved && ft - c.lastSent < 250)) continue;
        c.lastSent = ft;
        c.lastSentAim = aim;
        send(c, { op: ClientOp.Target, x: aim.x, y: aim.y }, ft);
      }
    }
    // server side: deliver every message that arrives during this tick, in arrival order
    const t0 = performance.now();
    const due: { at: number; c: Client; input: ClientInput }[] = [];
    for (const c of clients) {
      if (c.outbox.length === 0) continue;
      const keep: Pending[] = [];
      for (const m of c.outbox) {
        if (m.at < tickStart + TICK_MS) due.push({ at: m.at, c, input: m.input });
        else keep.push(m);
      }
      c.outbox = keep;
    }
    due.sort((a, b) => a.at - b.at);
    for (const d of due) {
      mono = Math.max(mono, d.at);
      room.input(d.c.conn, d.input);
    }
    mono = tickStart + TICK_MS;
    clock += TICK_MS;
    room.tick(TICK_MS);
    samples.push((performance.now() - t0) * 1000);

    const r = roundAt(clock, ROUND.roundMs, ROUND.closeMs);
    if (r.n !== lastRound) {
      rounds++;
      lastRound = r.n;
    }
    // eaten stakers buy back in while joins are open (a few seconds later); a rare disconnect and return
    for (const c of clients) {
      const alive = c.conn.player?.alive === true;
      if (!alive && clock < r.joinsCloseAt && rng() < 0.02) join(c);
      else if (alive && !c.scripted && rng() < 0.00005) room.leave(c.conn, 'disconnect');
      else if (!alive && c.conn.room === null && room.findStakeByWallet(c.wallet) && rng() < 0.01) {
        const e = room.findStakeByWallet(c.wallet)!;
        room.reattach(c.conn, e.pid);
      }
    }
    // the chain settles in the background
    for (const item of [...journal.pending]) if (!(item.kind === 'settle' && item.held)) journal.remove(item.key);
  }
  room.shutdown();
  const flags = integrity ? (integrity.scan(), integrity.listFlags()) : [];
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    flags,
    integrity,
    journal,
    ticks,
    tickUs: samples.reduce((a, b) => a + b, 0) / samples.length,
    tickP99Us: sorted[Math.floor(sorted.length * 0.99)],
    tickets,
    rounds,
    transfers: integrity?.snapshot().transfers.length ?? 0,
  };
}

function main(): void {
  const minutes = Number(process.argv[2] ?? 6);
  const seed = Number(process.argv[3] ?? 1);
  const base = { minutes, seed, honest: 30 };
  // warm-up so the JIT settles before either measurement
  runIntegritySim({ ...base, minutes: 1, integrity: false });
  const off = runIntegritySim({ ...base, integrity: false });
  const on = runIntegritySim({ ...base, integrity: true });
  const off2 = runIntegritySim({ ...base, integrity: false });
  const on2 = runIntegritySim({ ...base, integrity: true });
  const offUs = (off.tickUs + off2.tickUs) / 2;
  const onUs = (on.tickUs + on2.tickUs) / 2;
  console.log(`${minutes} min, ${base.honest} honest stakers, ${on.rounds} round ends, ${on.tickets} tickets, ${on.transfers} value transfers`);
  console.log(`tick without integrity: ${offUs.toFixed(1)} µs mean (p99 ${Math.max(off.tickP99Us, off2.tickP99Us).toFixed(0)} µs)`);
  console.log(`tick with integrity:    ${onUs.toFixed(1)} µs mean (p99 ${Math.max(on.tickP99Us, on2.tickP99Us).toFixed(0)} µs)  → ${(((onUs - offUs) / offUs) * 100).toFixed(1)} %`);
  console.log(`flags at default thresholds (honest players): ${on.flags.length}`);
  for (const f of on.flags) console.log(`  ${f.kind} ${f.score}: ${f.summary}`);
  const t0 = performance.now();
  on.integrity!.scan();
  console.log(`full detector scan: ${(performance.now() - t0).toFixed(1)} ms`);
  const cheat = runIntegritySim({ minutes, seed, honest: 12, scripted: 2 });
  console.log(`with 2 scripted bots: ${cheat.flags.length} flag(s)`);
  for (const f of cheat.flags) console.log(`  ${f.kind} ${f.score}: ${f.summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
