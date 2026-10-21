import { createHash } from 'node:crypto';
import type { IntegrityEvidence, IntegrityFlagKind, IntegrityThresholds, IntegrityTransfer } from '@slana/shared';
import { TURN_BINS, type IntegritySnapshot, type SessionSummary } from './types';

/**
 * Integrity detectors. Each one is a pure function of a telemetry snapshot and the thresholds:
 * same input, same output, no clock and no I/O. A detector returns candidate flags; the service
 * keeps those at or above `flagMinScore` and merges them with the admin's review state.
 */

export interface Candidate {
  kind: IntegrityFlagKind;
  /** Stable id from the kind and the subject. */
  id: string;
  score: number;
  wallets: string[];
  beneficiary: string | null;
  arenaId: number | null;
  summary: string;
  evidence: IntegrityEvidence;
}

const HOUR = 3_600_000;

export const flagId = (kind: IntegrityFlagKind, subject: string): string =>
  `${kind}:${createHash('sha256').update(subject).digest('hex').slice(0, 16)}`;

const short = (w: string) => (w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);
const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** P(X ≥ k) for X ~ Poisson(λ), computed in log space (tiny tails stay accurate). */
export function poissonTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (!(lambda > 0)) return 0;
  // Σ_{i ≥ k} e^-λ λ^i / i!: start at the k-th term and add until the terms vanish
  let logTerm = -lambda + k * Math.log(lambda) - logFactorial(k);
  let sum = 0;
  for (let i = k; i < k + 10_000; i++) {
    const term = Math.exp(logTerm);
    sum += term;
    if (i > lambda && term < sum * 1e-15) break;
    logTerm += Math.log(lambda) - Math.log(i + 1);
  }
  return Math.min(1, sum);
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** Shannon entropy (bits) of a histogram. */
export function entropyBits(hist: readonly number[]): number {
  let total = 0;
  for (const h of hist) total += h;
  if (total <= 0) return 0;
  let e = 0;
  for (const h of hist) if (h > 0) e -= (h / total) * Math.log2(h / total);
  return e;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const end = (s: SessionSummary, now: number) => s.endedAt ?? now;

/* ------------------------------------------------------------------ */
/* 1. Repeated value transfer between the same pair                    */
/* ------------------------------------------------------------------ */

/**
 * Wallet B took value from wallet A on more occasions (distinct victim and eater tickets) than
 * chance explains. Null model: on each occasion A lost value to a staker while B had a ticket in
 * that instance, B was the eater with probability max(1 / others, B's own eating rate against
 * every other victim), so a strong player who eats everyone is not mistaken for a partner. The observed count is compared with the Poisson tail of that
 * expectation, across rounds and instances. Net value (in entry fees) and repeat rounds are required.
 */
export function detectPairTransfers(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  // occasions: one per (victim ticket, eater ticket), at its first transfer
  interface Occ {
    at: number;
    roomId: string;
    round: number;
    arenaId: number;
    from: string;
    to: string;
    others: number;
    amount: number;
    fees: number;
    afk: boolean;
  }
  const occ = new Map<string, Occ>();
  for (const t of snap.transfers) {
    const k = `${t.fromKey}>${t.toKey}`;
    const o = occ.get(k);
    const fees = t.fee > 0 ? t.amount / t.fee : 0;
    if (o) {
      o.amount += t.amount;
      o.fees += fees;
      o.afk ||= t.afkEater;
    } else {
      occ.set(k, { at: t.at, roomId: t.roomId, round: t.round, arenaId: t.arenaId, from: t.from, to: t.to, others: Math.max(1, t.others), amount: t.amount, fees, afk: t.afkEater });
    }
  }
  if (occ.size === 0) return [];
  const byVictim = new Map<string, Occ[]>();
  const byPair = new Map<string, Occ[]>();
  for (const o of occ.values()) {
    if (o.from === o.to) continue;
    let v = byVictim.get(o.from);
    if (!v) byVictim.set(o.from, (v = []));
    v.push(o);
    const pk = `${o.from}>${o.to}`;
    let p = byPair.get(pk);
    if (!p) byPair.set(pk, (p = []));
    p.push(o);
  }
  // tickets per wallet per instance, to know whether B was there on A's other occasions
  const ticketsOf = new Map<string, SessionSummary[]>();
  for (const s of snap.sessions) {
    let l = ticketsOf.get(s.wallet);
    if (!l) ticketsOf.set(s.wallet, (l = []));
    l.push(s);
  }
  const present = (wallet: string, roomId: string, at: number) =>
    (ticketsOf.get(wallet) ?? []).some((s) => s.roomId === roomId && s.joinedAt <= at && at <= end(s, snap.now));

  const out: Candidate[] = [];
  for (const [pk, list] of byPair) {
    if (list.length < th.pairMinEvents) continue;
    const rounds = new Set(list.map((o) => `${o.arenaId}:${o.round}`));
    if (rounds.size < th.pairMinRounds) continue;
    const [a, b] = pk.split('>');
    const reverse = byPair.get(`${b}>${a}`) ?? [];
    const netFees = list.reduce((s, o) => s + o.fees, 0) - reverse.reduce((s, o) => s + o.fees, 0);
    if (netFees < th.pairMinNetFees) continue;
    // B's own eating rate against everyone else where B was present (a strong player eats a lot):
    // Laplace-smoothed, so a B with little history elsewhere gets a high rate (no flag)
    let seen = 0;
    let ate = 0;
    for (const o of occ.values()) {
      if (o.from === a || o.from === b) continue;
      if (o.to === b) {
        seen++;
        ate++;
      } else if (present(b, o.roomId, o.at)) seen++;
    }
    const rateB = (ate + 1) / (seen + 2);
    let lambda = 0;
    for (const o of byVictim.get(a) ?? []) if (o.to === b || present(b, o.roomId, o.at)) lambda += Math.max(1 / o.others, rateB);
    const p = poissonTail(list.length, lambda);
    if (p > th.pairMaxPValue) continue;
    const afk = list.filter((o) => o.afk).length;
    const net = list.reduce((s, o) => s + o.amount, 0) - reverse.reduce((s, o) => s + o.amount, 0);
    const arenas = [...new Set(list.map((o) => o.arenaId))].sort((x, y) => x - y);
    const lead = Math.log10(th.pairMaxPValue / Math.max(p, 1e-300));
    const score = clampScore(50 + 8 * lead + Math.min(15, 3 * netFees) + (afk > 0 ? 10 : 0));
    out.push({
      kind: 'pair_transfer',
      id: flagId('pair_transfer', pk),
      score,
      wallets: [b, a],
      beneficiary: b,
      arenaId: arenas.length === 1 ? arenas[0] : null,
      summary: `${short(b)} took value from ${short(a)} on ${list.length} occasions in ${rounds.size} rounds (chance ${p.toExponential(1)}), net ${round3(netFees)} entry fees.`,
      evidence: {
        occasions: list.length,
        rounds: rounds.size,
        expected: round3(lambda),
        eaterRateElsewhere: round3(rateB),
        pValue: Number(p.toExponential(3)),
        netValue: net,
        netFees: round3(netFees),
        reverseOccasions: reverse.length,
        afkEaterOccasions: afk,
        arenas,
        instances: [...new Set(list.map((o) => o.roomId))].sort(),
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Eject feeding                                                    */
/* ------------------------------------------------------------------ */

/** Most of wallet A's ejected blobs that someone else ate were eaten by wallet B. */
export function detectEjectFeeding(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const agg = new Map<string, { eaten: number; by: Map<string, { n: number; rounds: Set<string> }>; arenas: Set<number> }>();
  for (const s of snap.sessions) {
    const e = s.ejects;
    let total = e.eatenOther;
    for (const n of Object.values(e.eatenBy)) total += n;
    if (total === 0) continue;
    let a = agg.get(s.wallet);
    if (!a) agg.set(s.wallet, (a = { eaten: 0, by: new Map(), arenas: new Set() }));
    a.eaten += total;
    a.arenas.add(s.arenaId);
    for (const [w, n] of Object.entries(e.eatenBy)) {
      let b = a.by.get(w);
      if (!b) a.by.set(w, (b = { n: 0, rounds: new Set() }));
      b.n += n;
      b.rounds.add(`${s.arenaId}:${s.round}`);
    }
  }
  const out: Candidate[] = [];
  for (const [feeder, a] of agg) {
    if (a.eaten < th.ejectMinEaten) continue;
    for (const [eater, b] of a.by) {
      const share = b.n / a.eaten;
      if (share < th.ejectMinShare || b.rounds.size < 2 || eater === feeder) continue;
      const score = clampScore(Math.min(75, 40 + (40 * (share - th.ejectMinShare)) / Math.max(0.01, 1 - th.ejectMinShare) + Math.min(15, (5 * a.eaten) / th.ejectMinEaten)));
      out.push({
        kind: 'eject_feed',
        id: flagId('eject_feed', `${feeder}>${eater}`),
        score,
        wallets: [eater, feeder],
        beneficiary: eater,
        arenaId: a.arenas.size === 1 ? [...a.arenas][0] : null,
        summary: `${short(eater)} ate ${Math.round(share * 100)} % of the ${a.eaten} blobs ${short(feeder)} ejected that others picked up, over ${b.rounds.size} rounds.`,
        evidence: { blobsEatenByOthers: a.eaten, blobsEatenByBeneficiary: b.n, share: round3(share), rounds: b.rounds.size },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. Suicide feeding                                                  */
/* ------------------------------------------------------------------ */

/**
 * A much smaller staker kept moving toward the same bigger staker in its last seconds and was
 * eaten by it, on several tickets. A chased player runs away; a feeder walks into the mouth.
 */
export function detectSuicideFeeding(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const pairs = new Map<string, { deaths: SessionSummary[]; rounds: Set<string> }>();
  for (const s of snap.sessions) {
    const d = s.death;
    if (!d?.by || d.by === s.wallet || d.samples < 5 || d.approach < th.suicideMinApproach) continue;
    const k = `${s.wallet}>${d.by}`;
    let p = pairs.get(k);
    if (!p) pairs.set(k, (p = { deaths: [], rounds: new Set() }));
    p.deaths.push(s);
    p.rounds.add(`${s.arenaId}:${s.round}`);
  }
  const out: Candidate[] = [];
  for (const [k, p] of pairs) {
    if (p.deaths.length < th.suicideMinDeaths || p.rounds.size < Math.min(2, th.suicideMinDeaths)) continue;
    const [victim, eater] = k.split('>');
    const keys = new Set(p.deaths.map((s) => s.key));
    let fees = 0;
    for (const t of snap.transfers) if (t.to === eater && keys.has(t.fromKey) && t.fee > 0) fees += t.amount / t.fee;
    const meanApproach = p.deaths.reduce((s, d) => s + (d.death?.approach ?? 0), 0) / p.deaths.length;
    const score = clampScore(Math.min(95, 50 + 15 * (p.deaths.length - th.suicideMinDeaths) + Math.min(15, 3 * fees) + 10 * (meanApproach - th.suicideMinApproach)));
    const arenas = [...new Set(p.deaths.map((s) => s.arenaId))];
    out.push({
      kind: 'suicide_feed',
      id: flagId('suicide_feed', k),
      score,
      wallets: [eater, victim],
      beneficiary: eater,
      arenaId: arenas.length === 1 ? arenas[0] : null,
      summary: `${short(victim)} walked into the much bigger ${short(eater)} and was eaten ${p.deaths.length} times in ${p.rounds.size} rounds.`,
      evidence: { deaths: p.deaths.length, rounds: p.rounds.size, meanApproach: round3(meanApproach), valueFees: round3(fees), tickets: [...keys] },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. Shared IP or browser across wallets at the same time             */
/* ------------------------------------------------------------------ */

/** Different wallets with tickets in the same arena at the same time from one IP hash or one browser fingerprint hash. */
export function detectSharedDevice(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const groups = new Map<string, SessionSummary[]>();
  const add = (k: string, s: SessionSummary) => {
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(s);
  };
  for (const s of snap.sessions) {
    if (s.ipHash) add(`${s.arenaId}|ip|${s.ipHash}`, s);
    if (s.fpHash) add(`${s.arenaId}|fp|${s.fpHash}`, s);
  }
  // pair of wallets → what they shared
  const pairs = new Map<string, { ip: boolean; fp: boolean; sameRoom: boolean; overlapMs: number; arenas: Set<number> }>();
  for (const [k, list] of groups) {
    if (list.length < 2 || list.length > 400) continue; // a huge group is a proxy or a carrier NAT, not one person
    const kind = k.split('|')[1];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i];
        const y = list[j];
        if (x.wallet === y.wallet) continue;
        const overlap = Math.min(end(x, snap.now), end(y, snap.now)) - Math.max(x.joinedAt, y.joinedAt);
        if (overlap < th.sharedMinOverlapMs) continue;
        const pk = x.wallet < y.wallet ? `${x.wallet}|${y.wallet}` : `${y.wallet}|${x.wallet}`;
        let p = pairs.get(pk);
        if (!p) pairs.set(pk, (p = { ip: false, fp: false, sameRoom: false, overlapMs: 0, arenas: new Set() }));
        if (kind === 'ip' && x.ipHash === y.ipHash) p.ip = true;
        if (kind === 'fp' && x.fpHash && x.fpHash === y.fpHash) p.fp = true;
        p.sameRoom ||= x.roomId === y.roomId;
        p.overlapMs = Math.max(p.overlapMs, overlap);
        p.arenas.add(x.arenaId);
      }
    }
  }
  if (pairs.size === 0) return [];
  const moved = new Map<string, number>();
  for (const t of snap.transfers) {
    const pk = t.from < t.to ? `${t.from}|${t.to}` : `${t.to}|${t.from}`;
    if (pairs.has(pk)) moved.set(pk, (moved.get(pk) ?? 0) + (t.fee > 0 ? t.amount / t.fee : 0));
  }
  const out: Candidate[] = [];
  for (const [pk, p] of pairs) {
    const fees = moved.get(pk) ?? 0;
    let score = p.ip && p.fp ? th.sharedBothScore : p.fp ? th.sharedFpScore : th.sharedIpScore;
    if (p.fp && p.sameRoom) score += 10;
    if (fees > 0) score += p.fp ? 15 : 10;
    const [a, b] = pk.split('|');
    const what = p.ip && p.fp ? 'IP and browser' : p.fp ? 'browser' : 'IP';
    const arenas = [...p.arenas];
    out.push({
      kind: 'shared_device',
      id: flagId('shared_device', pk),
      score: clampScore(score),
      wallets: [a, b],
      beneficiary: null,
      arenaId: arenas.length === 1 ? arenas[0] : null,
      summary: `${short(a)} and ${short(b)} played the same arena at the same time from one ${what}${fees > 0 ? `, and value moved between them (${round3(fees)} entry fees)` : ''}.`,
      evidence: { sameIp: p.ip, sameBrowser: p.fp, sameInstance: p.sameRoom, overlapS: Math.round(p.overlapMs / 1000), valueBetweenFees: round3(fees), arenas },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. Bot-like input                                                   */
/* ------------------------------------------------------------------ */

/** Pooled input statistics of a wallet's tickets. */
export function poolInput(list: readonly SessionSummary[]): { n: number; mean: number; cv: number; hist: number[]; reactions: number[]; aims: number; intAims: number } {
  let aims = 0;
  let intAims = 0;
  let n = 0;
  let mean = 0;
  let m2 = 0;
  const hist = new Array<number>(TURN_BINS).fill(0);
  const reactions: number[] = [];
  for (const s of list) {
    const i = s.input;
    aims += i.aims ?? 0;
    intAims += i.intAims ?? 0;
    if (i.n > 0) {
      // Chan et al. parallel variance
      const nn = n + i.n;
      const d = i.meanMs - mean;
      mean += (d * i.n) / nn;
      m2 += i.m2 + (d * d * n * i.n) / nn;
      n = nn;
    }
    for (let b = 0; b < TURN_BINS && b < i.turnHist.length; b++) hist[b] += i.turnHist[b];
    for (const r of i.reactionMs) if (reactions.length < 400) reactions.push(r);
  }
  const sd = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
  return { n, mean, cv: mean > 0 ? sd / mean : 0, hist, reactions, aims, intAims };
}

/**
 * Input outside the human range, per wallet (tickets of the last 24 h before the snapshot time):
 * perfectly periodic messages, no mouse jitter (no variety in direction changes, or aims on exact
 * whole-number points), median reaction
 * to a new threat below human limits, or play in almost every hour of a day. Timing alone is
 * weak evidence (the web client sends on a fixed frame budget), so one timing signal never
 * reaches the default flag score by itself.
 */
export function detectBotInput(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const byWallet = new Map<string, SessionSummary[]>();
  for (const s of snap.sessions) {
    if (end(s, snap.now) < snap.now - 24 * HOUR) continue;
    let l = byWallet.get(s.wallet);
    if (!l) byWallet.set(s.wallet, (l = []));
    l.push(s);
  }
  const out: Candidate[] = [];
  for (const [wallet, list] of byWallet) {
    const pool = poolInput(list);
    const turnSamples = pool.hist.reduce((a, b) => a + b, 0);
    const entropy = entropyBits(pool.hist);
    const zeroShare = turnSamples > 0 ? pool.hist[0] / turnSamples : 0;
    const med = median(pool.reactions);
    const hours = new Set<number>();
    for (const s of list) {
      const from = Math.max(s.joinedAt, snap.now - 24 * HOUR);
      for (let h = Math.floor(from / HOUR); h <= Math.floor(end(s, snap.now) / HOUR); h++) hours.add(h);
    }
    const signals: string[] = [];
    let score = 0;
    const intShare = pool.aims > 0 ? pool.intAims / pool.aims : 0;
    if (pool.n >= th.botMinInputs && pool.cv <= th.botMaxIntervalCv) {
      signals.push('periodic');
      score += 25;
    }
    if ((turnSamples >= th.botMinInputs && entropy <= th.botMaxTurnEntropy) || (pool.aims >= th.botMinInputs && intShare >= th.botMinIntegerShare)) {
      signals.push('no_jitter');
      score += 35;
    }
    if (pool.reactions.length >= th.botMinReactionSamples && med < th.botMaxReactionMs) {
      signals.push('instant_reaction');
      score += 45;
    }
    if (hours.size >= th.botMaxActiveHours) {
      signals.push('round_the_clock');
      score += 40;
    }
    if (signals.length === 0) continue;
    if (signals.length >= 2) score += 10;
    out.push({
      kind: 'bot_input',
      id: flagId('bot_input', wallet),
      score: clampScore(score),
      wallets: [wallet],
      beneficiary: null,
      arenaId: null,
      summary: `${short(wallet)}: input looks automated (${signals.join(', ').replace(/_/g, ' ')}).`,
      evidence: {
        signals,
        inputs: pool.n,
        intervalMeanMs: Math.round(pool.mean * 10) / 10,
        intervalCv: round3(pool.cv),
        turnEntropyBits: round3(entropy),
        exactRepeatShare: round3(zeroShare),
        integerAimShare: round3(intShare),
        reactionSamples: pool.reactions.length,
        reactionMedianMs: Number.isNaN(med) ? null : Math.round(med),
        activeHours24h: hours.size,
        tickets: list.length,
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 6. Round-bell abuse                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tickets that join just before joins close and sit idle until the bell (a parked ticket that a
 * partner can eat, or that waits out the round), and tickets that gained value while idle (only a
 * player walking into an idle coin can feed it).
 */
export function detectBellAbuse(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const byWallet = new Map<string, { late: SessionSummary[]; fed: SessionSummary[]; feeds: number }>();
  for (const s of snap.sessions) {
    if (s.endedAt === null) continue;
    const span = Math.max(1, s.endedAt - s.joinedAt);
    const late = s.joinedAt >= s.joinsCloseAt - th.bellLateJoinMs && s.joinedAt < s.joinsCloseAt;
    const parked = late && s.endReason === 'round' && s.afkAtEnd && s.afkMs / span >= th.bellMinAfkShare;
    const fed = s.entryFee > 0 && s.receivedWhileAfk >= s.entryFee / 2;
    if (!parked && !fed) continue;
    let w = byWallet.get(s.wallet);
    if (!w) byWallet.set(s.wallet, (w = { late: [], fed: [], feeds: 0 }));
    if (parked) w.late.push(s);
    if (fed) {
      w.fed.push(s);
      w.feeds += s.receivedWhileAfk / s.entryFee;
    }
  }
  const out: Candidate[] = [];
  for (const [wallet, w] of byWallet) {
    const tickets = new Set([...w.late, ...w.fed].map((s) => s.key));
    if (tickets.size < th.bellMinSessions) continue;
    const score = clampScore(Math.min(90, 45 + 10 * (tickets.size - th.bellMinSessions) + (w.feeds >= 1 ? 15 : 0) + (w.fed.length >= 2 ? 10 : 0)));
    const arenas = [...new Set([...w.late, ...w.fed].map((s) => s.arenaId))];
    out.push({
      kind: 'bell_abuse',
      id: flagId('bell_abuse', wallet),
      score,
      wallets: [wallet],
      beneficiary: w.fed.length > 0 ? wallet : null,
      arenaId: arenas.length === 1 ? arenas[0] : null,
      summary: `${short(wallet)}: ${w.late.length} late joins left idle until the bell, ${w.fed.length} tickets fed while idle.`,
      evidence: { parkedTickets: w.late.length, fedWhileIdle: w.fed.length, valueWhileIdleFees: round3(w.feeds), tickets: [...tickets] },
    });
  }
  return out;
}

export const DETECTORS = [detectPairTransfers, detectEjectFeeding, detectSuicideFeeding, detectSharedDevice, detectBotInput, detectBellAbuse] as const;

/** Every detector, keeping candidates at or above `flagMinScore`. */
export function runDetectors(snap: IntegritySnapshot, th: IntegrityThresholds): Candidate[] {
  const out: Candidate[] = [];
  for (const d of DETECTORS) for (const c of d(snap, th)) if (c.score >= th.flagMinScore) out.push(c);
  return out;
}

/** Risk of a wallet: the highest candidate score that names it (as beneficiary when the flag has one). */
export function walletRisk(wallet: string, cands: readonly Candidate[]): { score: number; flags: string[] } {
  let score = 0;
  const flags: string[] = [];
  for (const c of cands) {
    const hit = c.beneficiary ? c.beneficiary === wallet : c.wallets.includes(wallet);
    if (!hit) continue;
    flags.push(c.id);
    if (c.score > score) score = c.score;
  }
  return { score, flags };
}

/** The part of a snapshot that can matter to one wallet's flags (its tickets, its counterparties, shared hashes). */
export function scopeSnapshot(snap: IntegritySnapshot, wallet: string): IntegritySnapshot {
  const mine = snap.sessions.filter((s) => s.wallet === wallet);
  const keys = new Set(mine.flatMap((s) => [s.ipHash, s.fpHash ?? ''].filter(Boolean)));
  const transfers = snap.transfers.filter((t) => t.from === wallet || t.to === wallet);
  const related = new Set<string>([wallet]);
  for (const t of transfers) related.add(t.from === wallet ? t.to : t.from);
  for (const s of mine) for (const w of Object.keys(s.ejects.eatenBy)) related.add(w);
  for (const s of snap.sessions) if (keys.has(s.ipHash) || (s.fpHash && keys.has(s.fpHash))) related.add(s.wallet);
  const sessions = snap.sessions.filter((s) => related.has(s.wallet));
  // the pair model's expectation needs the victims' other losses and every occasion where this wallet was present
  const victims = new Set(transfers.filter((t) => t.to === wallet).map((t) => t.from));
  const spans = new Map<string, [number, number][]>();
  for (const s of mine) {
    let l = spans.get(s.roomId);
    if (!l) spans.set(s.roomId, (l = []));
    l.push([s.joinedAt, end(s, snap.now)]);
  }
  const during = (t: IntegrityTransfer) => spans.get(t.roomId)?.some(([a, b]) => a <= t.at && t.at <= b) ?? false;
  const all = snap.transfers.filter((t) => t.from === wallet || t.to === wallet || victims.has(t.from) || during(t));
  return { now: snap.now, sessions, transfers: all };
}
