/**
 * Headless bot benchmarks (CPU per tick, newcomer survival, virus deaths, stuck time, duels).
 *   pnpm -F @elymum/server exec tsx scripts/bench/bot-bench.ts <cpu|room|rookie|duel> [minutes] [seeds]
 *
 * BENCH_LEGACY=1 swaps every bot's brain for the pre-2026-11 one (`legacy-brain.ts`, frozen);
 * `duel` pits the current brain (team A) against the legacy one (team B), all hard bots.
 * BENCH_PRO=1 / BENCH_CAP=n: `rookie` runs the newcomer in a standard-mix room / with that bot
 * mass cap (`room` takes BENCH_CAP too). BENCH_OVERRIDE=key:value,... tweaks every personality.
 * BENCH_TRACE=1 prints newcomer deaths and stuck bots.
 */
import { EntityKind, RULES, TICK_MS, WORLD_PRESETS, canEat, viewSize } from '@elymum/shared';
import { BotManager, type Bot, type BotManagerOptions } from '../../src/bots/manager';
import { rollPersonality } from '../../src/bots/personality';
import type { Player } from '../../src/game/entities';
import { mulberry32 } from '../../src/game/rng';
import { World } from '../../src/game/world';
import { LegacyBrain } from './legacy-brain';

type BrainCtor = new (p: Bot['brain']['personality'], rng: () => number) => Bot['brain'];
const Legacy: BrainCtor | null = LegacyBrain as unknown as BrainCtor;

const mode = process.argv[2] ?? 'room';
const minutes = Number(process.argv[3] ?? 5);
const seeds = Number(process.argv[4] ?? 3);
const legacyAll = process.env.BENCH_LEGACY === '1';

function makeRoom(seed: number, preset: 'practice' | 'arena', opts: BotManagerOptions, team?: (bot: Bot, i: number) => void) {
  const world = new World({ ...WORLD_PRESETS[preset], powerUps: true, coinRain: true, seed });
  const rng = mulberry32(seed + 1);
  const bots = new BotManager(world, opts, rng);
  let n = 0;
  const orig = bots.spawnBot.bind(bots);
  bots.spawnBot = (mass, staked) => {
    const b = orig(mass, staked);
    if (legacyAll && Legacy) b.brain = new Legacy(b.brain.personality, rng);
    // BENCH_OVERRIDE=foodRouting:0,chaseMs:2000 tweaks every bot's personality
    for (const kv of (process.env.BENCH_OVERRIDE ?? '').split(',').filter(Boolean)) {
      const [k, v] = kv.split(':');
      (b.brain.personality as unknown as Record<string, number>)[k] = Number(v);
    }
    team?.(b, n++);
    return b;
  };
  return { world, bots };
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* ---------------- room: CPU + behaviour stats ---------------- */
function room(seed: number, preset: 'practice' | 'arena', opts: BotManagerOptions) {
  const { world, bots } = makeRoom(seed, preset, opts);
  const tickMs: number[] = [];
  const botMs: number[] = [];
  let kills = 0;
  let pops = 0;
  let popDeaths = 0;
  const poppedAt = new Map<number, number>();
  let botSamples = 0;
  let stuckSamples = 0;
  let wallSamples = 0;
  const lastPos = new Map<number, { x: number; y: number; t: number }>();
  const massSamples: number[] = [];
  let maxMass = 0;
  const ticks = Math.round((minutes * 60_000) / TICK_MS);
  const { width: W, height: H } = world.cfg;
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    const ev = world.tick(TICK_MS);
    for (const p of ev.pops) {
      pops++;
      poppedAt.set(p.player.id, world.now);
    }
    for (const k of ev.kills) {
      kills++;
      const pa = poppedAt.get(k.victim.id);
      if (pa !== undefined && world.now - pa < 8000) popDeaths++;
      poppedAt.delete(k.victim.id);
      bots.onDeath(k.victim.id, world.now);
      world.removePlayer(k.victim.id);
      if (k.killer) bots.onKill(k.killer.id);
    }
    const t1 = performance.now();
    bots.update(world.now, 0);
    const t2 = performance.now();
    // the first seconds are JIT warm-up and the initial spawn
    if (world.now > 10_000) {
      tickMs.push(t2 - t0);
      botMs.push(t2 - t1);
    }
    if (i % 30 === 0) {
      for (const b of bots.bots.values()) {
        const p = b.player;
        if (!p.alive || p.cells.length === 0) continue;
        const c = p.center();
        const m = p.totalMass();
        massSamples.push(m);
        maxMass = Math.max(maxMass, m);
        botSamples++;
        const r = p.biggestCell()!.r;
        if (Math.min(c.x, c.y, W - c.x, H - c.y) < r + 120) wallSamples++;
        const lp = lastPos.get(p.id);
        if (lp && world.now - lp.t >= 3000) {
          if (Math.hypot(c.x - lp.x, c.y - lp.y) < 80) {
            stuckSamples++;
            if (process.env.BENCH_TRACE) console.log(`  stuck ${p.name} m${m.toFixed(0)} cells${p.cells.length} at ${c.x.toFixed(0)},${c.y.toFixed(0)} danger ${b.brain.lastDanger.toFixed(2)} skill${b.brain.personality.skill}`);
          }
          lastPos.set(p.id, { x: c.x, y: c.y, t: world.now });
        } else if (!lp) lastPos.set(p.id, { x: c.x, y: c.y, t: world.now });
      }
    }
  }
  return {
    tickMean: mean(tickMs),
    tickP99: pct(tickMs, 0.99),
    botMean: mean(botMs),
    botP99: pct(botMs, 0.99),
    botMax: Math.max(...botMs),
    killsPerMin: kills / minutes,
    popsPerMin: pops / minutes,
    popDeathsPerMin: popDeaths / minutes,
    stuck: stuckSamples / Math.max(1, botSamples / 3),
    wall: wallSamples / Math.max(1, botSamples),
    massMedian: pct(massSamples, 0.5),
    massP90: pct(massSamples, 0.9),
    maxMass,
  };
}

/* ---------------- rookie: scripted newcomer survival ---------------- */
/** A human-like newcomer: reacts every 220 ms, runs straight away from what can eat it, else eats the nearest coin. */
function newcomerTarget(world: World, me: Player): { x: number; y: number } {
  const c = me.center();
  const m = me.totalMass();
  const v = viewSize(m, 16 / 9);
  const hw = v.w / 2;
  const hh = v.h / 2;
  let fx = 0;
  let fy = 0;
  let threat = false;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  world.forEachVisible(c.x - hw, c.y - hh, c.x + hw, c.y + hh, (e) => {
    if (e.kind === EntityKind.Cell) {
      if (e.player === me) return;
      if (!canEat(e.mass, m)) return;
      const d = Math.hypot(c.x - e.x, c.y - e.y) - e.r;
      if (d > 520) return;
      threat = true;
      const w = 1 / Math.max(30, d);
      fx += ((c.x - e.x) / Math.max(1, d + e.r)) * w;
      fy += ((c.y - e.y) / Math.max(1, d + e.r)) * w;
    } else if (e.kind === EntityKind.Food) {
      const d = Math.hypot(c.x - e.x, c.y - e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  });
  const { width: W, height: H } = world.cfg;
  if (threat) {
    // people do steer off walls
    const edge = 400;
    if (c.x < edge) fx += 0.004 * (1 - c.x / edge);
    if (c.x > W - edge) fx -= 0.004 * (1 - (W - c.x) / edge);
    if (c.y < edge) fy += 0.004 * (1 - c.y / edge);
    if (c.y > H - edge) fy -= 0.004 * (1 - (H - c.y) / edge);
    const n = Math.hypot(fx, fy) || 1;
    return { x: c.x + (fx / n) * 400, y: c.y + (fy / n) * 400 };
  }
  if (best) return best;
  return { x: W / 2, y: H / 2 };
}

function rookie(seed: number, trials: number) {
  const pro = process.env.BENCH_PRO === '1';
  const cap = process.env.BENCH_CAP ? Number(process.env.BENCH_CAP) : pro ? undefined : 300;
  const { world, bots } = makeRoom(seed, 'practice', { target: 12, min: 4, max: 12, mix: pro ? 'standard' : 'rookie', ...(cap ? { massCap: cap } : {}) });
  const step = (humanId: number | null) => {
    const ev = world.tick(TICK_MS);
    let died = false;
    for (const k of ev.kills) {
      if (k.victim.id === humanId) {
        died = true;
        const kb = k.killer ? bots.bots.get(k.killer.id) : undefined;
        const key = kb ? `skill${kb.brain.personality.skill}${k.killer!.cells.length > 1 ? '-split' : ''}` : 'other';
        killers.set(key, (killers.get(key) ?? 0) + 1);
        if (process.env.BENCH_TRACE) {
          const v = k.victim;
          const kc = k.killer?.center();
          console.log(`  death t+${((world.now - (v.stats.joinedAt ?? 0)) / 1000).toFixed(0)}s killer ${key} m${k.killer?.totalMass().toFixed(0)} cells${k.killer?.cells.length} style ${kb?.brain.personality.style} at ${kc?.x.toFixed(0)},${kc?.y.toFixed(0)}`);
        }
      }
      else bots.onDeath(k.victim.id, world.now);
      world.removePlayer(k.victim.id);
    }
    bots.update(world.now, humanId === null ? 0 : 1);
    return died;
  };
  for (let i = 0; i < 90_000 / TICK_MS; i++) step(null);
  const survival: number[] = [];
  const peak: number[] = [];
  for (let t = 0; t < trials; t++) {
    const p = world.addPlayer({ name: `new${t}`, skin: 0 });
    // the newcomer is a veteran for grace purposes only after its real join time
    const start = world.now;
    let alive = true;
    let next = 0;
    let top = 0;
    while (alive && world.now - start < 120_000) {
      if (world.now >= next) {
        const tg = newcomerTarget(world, p);
        world.setTarget(p.id, tg.x, tg.y);
        next = world.now + 220;
      }
      top = Math.max(top, p.totalMass());
      if (step(p.id)) alive = false;
    }
    if (alive) world.removePlayer(p.id);
    survival.push((world.now - start) / 1000);
    peak.push(top);
  }
  return { survival, peak };
}

/* ---------------- duel: current (A) vs legacy (B), all hard ---------------- */
function duel(seed: number) {
  if (!Legacy) throw new Error('duel needs scripts/bench/legacy-brain.ts');
  const team = new Map<number, 'A' | 'B'>();
  const { world, bots } = makeRoom(seed, 'practice', { target: 12, min: 12, max: 12, mix: { easy: 0, medium: 0, hard: 100 } }, (b, i) => {
    let a = 0;
    let bb = 0;
    for (const t of team.values()) t === 'A' ? a++ : bb++;
    void i;
    const side = a <= bb ? 'A' : 'B';
    team.set(b.player.id, side);
    if (side === 'B') b.brain = new Legacy!(rollPersonality(mulberry32(b.player.id * 7 + seed), { easy: 0, medium: 0, hard: 100 }), mulberry32(b.player.id + seed));
    else b.brain = new (b.brain.constructor as BrainCtor)(rollPersonality(mulberry32(b.player.id * 7 + seed), { easy: 0, medium: 0, hard: 100 }), mulberry32(b.player.id + seed));
  });
  const kills = { A: 0, B: 0 };
  const deaths = { A: 0, B: 0 };
  const massSum = { A: 0, B: 0 };
  let topA = 0;
  let samples = 0;
  const ticks = Math.round((minutes * 60_000) / TICK_MS);
  for (let i = 0; i < ticks; i++) {
    const ev = world.tick(TICK_MS);
    for (const k of ev.kills) {
      const v = team.get(k.victim.id);
      if (v) deaths[v]++;
      const kk = k.killer ? team.get(k.killer.id) : undefined;
      if (kk) kills[kk]++;
      team.delete(k.victim.id);
      bots.onDeath(k.victim.id, world.now);
      world.removePlayer(k.victim.id);
    }
    for (const pid of bots.retired) team.delete(pid);
    bots.update(world.now, 0);
    for (const pid of bots.retired) team.delete(pid);
    if (i % 30 === 0) {
      let best = -1;
      let bestTeam: 'A' | 'B' | null = null;
      for (const b of bots.bots.values()) {
        const t = team.get(b.player.id);
        if (!t) continue;
        const m = b.player.totalMass();
        massSum[t] += m;
        if (m > best) {
          best = m;
          bestTeam = t;
        }
      }
      samples++;
      if (bestTeam === 'A') topA++;
    }
  }
  return { kills, deaths, massA: massSum.A / samples / 6, massB: massSum.B / samples / 6, topShareA: topA / samples };
}

const killers = new Map<string, number>();
const f = (x: number, d = 2) => x.toFixed(d);
if (mode === 'cpu' || mode === 'room') {
  const rows: ReturnType<typeof room>[] = [];
  for (let s = 0; s < seeds; s++) rows.push(room(100 + s, 'practice', { target: 12, min: 4, max: 12, mix: 'standard', ...(process.env.BENCH_CAP ? { massCap: Number(process.env.BENCH_CAP) } : {}) }));
  const avg = (k: keyof (typeof rows)[0]) => mean(rows.map((r) => r[k]));
  console.log(`room x${seeds} seeds, ${minutes} min, 12 bots, standard mix${legacyAll ? ' (LEGACY brains)' : ''}`);
  console.log(`  tick ms mean ${f(avg('tickMean'), 3)} p99 ${f(avg('tickP99'), 3)} | bots.update ms mean ${f(avg('botMean'), 3)} p99 ${f(avg('botP99'), 3)} max ${f(avg('botMax'), 2)}`);
  console.log(`  kills/min ${f(avg('killsPerMin'), 1)} | virus pops/min ${f(avg('popsPerMin'), 2)} | deaths <8s after a pop /min ${f(avg('popDeathsPerMin'), 2)}`);
  console.log(`  stuck (moved <80u in 3s) ${f(avg('stuck') * 100, 1)}% | hugging a wall ${f(avg('wall') * 100, 1)}%`);
  console.log(`  bot mass median ${f(avg('massMedian'), 0)} p90 ${f(avg('massP90'), 0)} max ${f(avg('maxMass'), 0)}`);
} else if (mode === 'rookie') {
  const surv: number[] = [];
  const peak: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const r = rookie(200 + s, Math.max(1, Math.round(minutes)));
    surv.push(...r.survival);
    peak.push(...r.peak);
  }
  const lived = surv.filter((x) => x >= 120).length;
  console.log(`${process.env.BENCH_PRO === '1' ? 'pro' : 'rookie'} newcomer x${surv.length}${legacyAll ? ' (LEGACY brains)' : ''}: survival median ${f(pct(surv, 0.5), 1)}s p25 ${f(pct(surv, 0.25), 1)}s, lived 120s ${lived}/${surv.length}, peak mass median ${f(pct(peak, 0.5), 0)} | killed by ${[...killers].map(([k, v]) => `${k}:${v}`).join(' ')}`);
} else if (mode === 'duel') {
  const tot = { kA: 0, kB: 0, dA: 0, dB: 0, mA: 0, mB: 0, top: 0 };
  for (let s = 0; s < seeds; s++) {
    const r = duel(300 + s);
    tot.kA += r.kills.A;
    tot.kB += r.kills.B;
    tot.dA += r.deaths.A;
    tot.dB += r.deaths.B;
    tot.mA += r.massA / seeds;
    tot.mB += r.massB / seeds;
    tot.top += r.topShareA / seeds;
  }
  console.log(`duel x${seeds} seeds, ${minutes} min, 6 new (A) vs 6 legacy (B) hard bots`);
  console.log(`  kills A ${tot.kA} B ${tot.kB} | deaths A ${tot.dA} B ${tot.dB} | avg mass A ${f(tot.mA, 0)} B ${f(tot.mB, 0)} | A holds #1 ${f(tot.top * 100, 0)}% of the time`);
}
void RULES;
