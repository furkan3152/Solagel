import { INTEGRITY_THRESHOLDS_DEFAULT as TH, type IntegrityTransfer } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import {
  detectBellAbuse,
  detectBotInput,
  detectEjectFeeding,
  detectPairTransfers,
  detectSharedDevice,
  detectSuicideFeeding,
  entropyBits,
  poissonTail,
  runDetectors,
  scopeSnapshot,
  walletRisk,
} from '../src/integrity/detectors';
import { TURN_BINS, emptyInput, turnBin, type IntegritySnapshot, type SessionSummary } from '../src/integrity/types';

const FEE = 1000;
const ROUND = 300_000;
const T0 = 1_791_000_000_000 - (1_791_000_000_000 % ROUND);
const NOW = T0 + 40 * ROUND;

let seq = 0;
/** A finished ticket in round `r` (whole round unless overridden). */
function sess(wallet: string, r: number, over: Partial<SessionSummary> = {}): SessionSummary {
  const n = ++seq;
  const start = T0 + r * ROUND;
  return {
    key: `S${n}#${n}`,
    wallet,
    arenaId: 1,
    roomId: 'arena-1-1',
    entryFee: FEE,
    round: r,
    roundStartsAt: start,
    joinsCloseAt: start + ROUND - 60_000,
    roundEndsAt: start + ROUND,
    joinedAt: start + 1000,
    endedAt: start + ROUND,
    endReason: 'round',
    payout: FEE,
    ipHash: `ip-${wallet}`,
    fpHash: `fp-${wallet}`,
    afkMs: 0,
    afkAtEnd: false,
    receivedWhileAfk: 0,
    input: emptyInput(),
    ejects: { eatenBy: {}, eatenOther: 0 },
    death: null,
    ...over,
  };
}

function tr(from: SessionSummary, to: SessionSummary, amount: number, at: number, others = 10, afkEater = false): IntegrityTransfer {
  return { at, arenaId: from.arenaId, roomId: from.roomId, round: from.round, from: from.wallet, to: to.wallet, amount, fee: FEE, fromKey: from.key, toKey: to.key, others, afkEater };
}

const snap = (sessions: SessionSummary[], transfers: IntegrityTransfer[] = []): IntegritySnapshot => ({ now: NOW, sessions, transfers });

/**
 * A busy arena: in each of `rounds` rounds, `crowd` wallets plus the named ones play, and every
 * crowd wallet loses one ticket to another crowd wallet (so the named eater was present on many
 * occasions where somebody else was the eater).
 */
function arena(rounds: number[], named: string[], crowd = 10): { sessions: SessionSummary[]; transfers: IntegrityTransfer[]; ticket: (w: string, r: number) => SessionSummary } {
  const sessions: SessionSummary[] = [];
  const transfers: IntegrityTransfer[] = [];
  const byKey = new Map<string, SessionSummary>();
  const ticket = (w: string, r: number) => byKey.get(`${w}@${r}`)!;
  for (const r of rounds) {
    for (const w of [...named, ...Array.from({ length: crowd }, (_, i) => `crowd${i}`)]) {
      const s = sess(w, r);
      sessions.push(s);
      byKey.set(`${w}@${r}`, s);
    }
    for (let i = 0; i < crowd; i++) {
      const v = ticket(`crowd${i}`, r);
      // a different eater every round, so no crowd pair repeats
      const e = ticket(`crowd${(i + 1 + (r % (crowd - 1))) % crowd}`, r);
      transfers.push(tr(v, e, FEE, v.joinedAt + 10_000 + i * 1000, crowd + named.length - 1));
    }
  }
  return { sessions, transfers, ticket };
}

describe('helpers', () => {
  it('poisson tail and entropy', () => {
    expect(poissonTail(0, 2)).toBe(1);
    expect(poissonTail(1, 0.5)).toBeCloseTo(1 - Math.exp(-0.5), 12);
    expect(poissonTail(3, 1)).toBeCloseTo(1 - Math.exp(-1) * (1 + 1 + 0.5), 12);
    // a tiny tail stays accurate (no 1 - 1 cancellation)
    expect(poissonTail(20, 0.5)).toBeGreaterThan(0);
    expect(poissonTail(20, 0.5)).toBeLessThan(1e-20);
    expect(entropyBits([10, 0, 0])).toBe(0);
    expect(entropyBits([5, 5])).toBeCloseTo(1, 12);
    expect(turnBin(0)).toBe(0);
    expect(turnBin(0.01)).toBe(1);
    expect(turnBin(179)).toBe(TURN_BINS - 1);
  });
});

describe('pair transfer detector', () => {
  it('flags a wallet that keeps taking value from the same victim across rounds', () => {
    const a = arena([1, 2, 3, 4, 5, 6], ['victim', 'farmer']);
    const extra: IntegrityTransfer[] = [];
    for (const r of [1, 2, 3, 4, 5, 6]) extra.push(tr(a.ticket('victim', r), a.ticket('farmer', r), FEE, T0 + r * ROUND + 50_000, 11));
    const out = detectPairTransfers(snap(a.sessions, [...a.transfers, ...extra]), TH);
    expect(out).toHaveLength(1);
    const f = out[0];
    expect(f.beneficiary).toBe('farmer');
    expect(f.wallets).toEqual(['farmer', 'victim']);
    expect(f.evidence.occasions).toBe(6);
    expect(f.evidence.rounds).toBe(6);
    expect(f.evidence.netFees).toBe(6);
    expect(Number(f.evidence.pValue)).toBeLessThan(TH.pairMaxPValue);
    expect(f.score).toBeGreaterThanOrEqual(TH.flagMinScore);
  });

  it('an idle (AFK) eater raises the score', () => {
    const a = arena([1, 2, 3, 4, 5, 6], ['victim', 'farmer']);
    const mk = (afk: boolean) => [1, 2, 3, 4, 5, 6].map((r) => tr(a.ticket('victim', r), a.ticket('farmer', r), FEE, T0 + r * ROUND + 50_000, 11, afk));
    const awake = detectPairTransfers(snap(a.sessions, [...a.transfers, ...mk(false)]), TH)[0];
    const idle = detectPairTransfers(snap(a.sessions, [...a.transfers, ...mk(true)]), TH)[0];
    expect(idle.score).toBeGreaterThan(awake.score);
    expect(idle.evidence.afkEaterOccasions).toBe(6);
  });

  it('does not flag a strong player who eats everyone', () => {
    const a = arena([1, 2, 3, 4, 5, 6], ['victim', 'shark']);
    const transfers = [...a.transfers];
    for (const r of [1, 2, 3, 4, 5, 6]) {
      transfers.push(tr(a.ticket('victim', r), a.ticket('shark', r), FEE, T0 + r * ROUND + 50_000, 11));
      // the shark also eats most of the crowd
      for (let i = 0; i < 8; i++) transfers.push(tr(a.ticket(`crowd${i}`, r), a.ticket('shark', r), FEE, T0 + r * ROUND + 60_000 + i * 100, 11));
    }
    expect(detectPairTransfers(snap(a.sessions, transfers), TH)).toEqual([]);
  });

  it('needs enough occasions, rounds and net value', () => {
    const a = arena([1, 2, 3, 4, 5, 6], ['victim', 'farmer']);
    const few = [1, 2, 3].map((r) => tr(a.ticket('victim', r), a.ticket('farmer', r), FEE, T0 + r * ROUND + 50_000, 11));
    expect(detectPairTransfers(snap(a.sessions, [...a.transfers, ...few]), TH)).toEqual([]);
    // many occasions in one round only
    const oneRound = [0, 1, 2, 3, 4, 5].map((i) => {
      const v = sess('victim', 1, { key: `V${i}#${i}` });
      return tr(v, a.ticket('farmer', 1), FEE, T0 + ROUND + 50_000 + i, 11);
    });
    expect(detectPairTransfers(snap(a.sessions, [...a.transfers, ...oneRound]), TH)).toEqual([]);
    // value moves both ways: no net flow
    const both = [1, 2, 3, 4, 5, 6].flatMap((r) => [
      tr(a.ticket('victim', r), a.ticket('farmer', r), FEE, T0 + r * ROUND + 50_000, 11),
      tr(a.ticket('farmer', r), a.ticket('victim', r), FEE, T0 + r * ROUND + 70_000, 11),
    ]);
    expect(detectPairTransfers(snap(a.sessions, [...a.transfers, ...both]), TH)).toEqual([]);
  });
});

describe('eject feeding detector', () => {
  it('flags a wallet whose ejected mass is mostly eaten by one other wallet', () => {
    const s = [1, 2, 3].map((r) => sess('feeder', r, { ejects: { eatenBy: { partner: 18, other: 1 }, eatenOther: 1 } }));
    const out = detectEjectFeeding(snap(s), TH);
    expect(out).toHaveLength(1);
    expect(out[0].beneficiary).toBe('partner');
    expect(out[0].evidence.share).toBeCloseTo(0.9, 3);
    expect(out[0].score).toBeGreaterThanOrEqual(TH.flagMinScore);
  });

  it('does not flag spread-out or few ejects', () => {
    const spread = [1, 2, 3].map((r) => sess('feeder', r, { ejects: { eatenBy: { a: 7, b: 7, c: 6 }, eatenOther: 10 } }));
    expect(detectEjectFeeding(snap(spread), TH)).toEqual([]);
    const few = [1, 2].map((r) => sess('feeder', r, { ejects: { eatenBy: { partner: 10 }, eatenOther: 0 } }));
    expect(detectEjectFeeding(snap(few), TH)).toEqual([]);
    // one round only
    const once = [sess('feeder', 1, { ejects: { eatenBy: { partner: 80 }, eatenOther: 0 } })];
    expect(detectEjectFeeding(snap(once), TH)).toEqual([]);
  });
});

describe('suicide feeding detector', () => {
  it('flags a small player walking into the same big player round after round', () => {
    const victims = [1, 2, 3].map((r) => sess('feeder', r, { endReason: 'death', payout: 0, death: { by: 'whale', byBot: false, approach: 0.9, samples: 12 } }));
    const whales = [1, 2, 3].map((r) => sess('whale', r));
    const transfers = victims.map((v, i) => tr(v, whales[i], FEE, v.joinedAt + 5000));
    const out = detectSuicideFeeding(snap([...victims, ...whales], transfers), TH);
    expect(out).toHaveLength(1);
    expect(out[0].beneficiary).toBe('whale');
    expect(out[0].evidence.deaths).toBe(3);
    expect(out[0].evidence.valueFees).toBe(3);
  });

  it('does not flag a player who was chased down (fleeing) or eaten by different players', () => {
    const fled = [1, 2, 3].map((r) => sess('runner', r, { endReason: 'death', death: { by: 'whale', byBot: false, approach: 0.1, samples: 12 } }));
    expect(detectSuicideFeeding(snap(fled), TH)).toEqual([]);
    const various = [1, 2, 3].map((r) => sess('unlucky', r, { endReason: 'death', death: { by: `eater${r}`, byBot: false, approach: 0.9, samples: 12 } }));
    expect(detectSuicideFeeding(snap(various), TH)).toEqual([]);
    const thin = [1, 2, 3].map((r) => sess('glimpse', r, { endReason: 'death', death: { by: 'whale', byBot: false, approach: 1, samples: 2 } }));
    expect(detectSuicideFeeding(snap(thin), TH)).toEqual([]);
  });
});

describe('shared device detector', () => {
  it('flags two wallets in one arena at the same time from one browser', () => {
    const a = sess('alice', 1, { ipHash: 'ip1', fpHash: 'fpX' });
    const b = sess('bob', 1, { ipHash: 'ip1', fpHash: 'fpX' });
    const out = runDetectors(snap([a, b]), TH);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('shared_device');
    expect(out[0].score).toBe(TH.sharedBothScore + 10);
    expect(out[0].evidence).toMatchObject({ sameIp: true, sameBrowser: true, sameInstance: true });
  });

  it('a shared IP alone stays below the flag score, unless value moved between the wallets', () => {
    const a = sess('alice', 1, { ipHash: 'ip1' });
    const b = sess('bob', 1, { ipHash: 'ip1' });
    const cand = detectSharedDevice(snap([a, b]), TH);
    expect(cand).toHaveLength(1);
    expect(cand[0].score).toBeLessThan(TH.flagMinScore);
    expect(runDetectors(snap([a, b]), TH)).toEqual([]);
    const moved = runDetectors(snap([a, b], [tr(a, b, FEE, a.joinedAt + 1000)]), TH).filter((c) => c.kind === 'shared_device');
    expect(moved).toHaveLength(1);
    expect(moved[0].score).toBeGreaterThanOrEqual(TH.flagMinScore);
  });

  it('does not flag wallets that never overlapped, other arenas, or one wallet twice', () => {
    const a = sess('alice', 1, { ipHash: 'ip1', fpHash: 'fpX' });
    const later = sess('bob', 2, { ipHash: 'ip1', fpHash: 'fpX' });
    expect(detectSharedDevice(snap([a, later]), TH)).toEqual([]);
    const other = sess('bob', 1, { ipHash: 'ip1', fpHash: 'fpX', arenaId: 2, roomId: 'arena-2-1' });
    expect(detectSharedDevice(snap([a, other]), TH)).toEqual([]);
    expect(detectSharedDevice(snap([a, sess('alice', 1, { ipHash: 'ip1', fpHash: 'fpX' })]), TH)).toEqual([]);
  });
});

describe('bot input detector', () => {
  const human = () => {
    const i = emptyInput();
    i.aims = 3000;
    i.n = 3000;
    i.meanMs = 41;
    i.m2 = (41 * 0.25) ** 2 * 2999; // cv 0.25
    i.turnHist = [0, 40, 150, 400, 1000, 750, 650, 500, 260, 120, 40, 20, 10];
    i.reactionMs = Array.from({ length: 30 }, (_, k) => 220 + k * 10);
    return i;
  };
  const script = () => {
    const i = emptyInput();
    i.aims = 3000;
    i.intAims = 3000;
    i.n = 3000;
    i.meanMs = 50;
    i.m2 = 0;
    i.turnHist = [2000, 900, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return i;
  };

  it('flags periodic, jitter-free input', () => {
    const out = detectBotInput(snap([sess('bot', 39, { input: script() })]), TH);
    expect(out).toHaveLength(1);
    expect(out[0].evidence.signals).toEqual(['periodic', 'no_jitter']);
    expect(out[0].score).toBeGreaterThanOrEqual(TH.flagMinScore);
  });

  it('flags reactions faster than a human', () => {
    const i = human();
    i.reactionMs = Array.from({ length: 30 }, () => 45);
    const out = detectBotInput(snap([sess('reflex', 39, { input: i })]), TH);
    expect(out[0].evidence.signals).toEqual(['instant_reaction']);
    expect(out[0].score).toBeGreaterThanOrEqual(TH.flagMinScore);
  });

  it('flags round-the-clock play', () => {
    const s = Array.from({ length: 23 }, (_, h) => sess('grinder', 0, { joinedAt: NOW - (h + 1) * 3_600_000, endedAt: NOW - h * 3_600_000 - 60_000, input: human() }));
    const out = detectBotInput(snap(s), TH);
    expect(out[0].evidence.signals).toEqual(['round_the_clock']);
  });

  it('does not flag human input, short sessions, or timing alone', () => {
    expect(detectBotInput(snap([sess('human', 39, { input: human() })]), TH)).toEqual([]);
    const short = script();
    short.n = short.aims = short.intAims = 300;
    expect(detectBotInput(snap([sess('newcomer', 39, { input: short })]), TH)).toEqual([]);
    // the web client's own frame budget makes timing regular: timing alone never reaches the flag score
    const regular = human();
    regular.m2 = 0;
    const out = runDetectors(snap([sess('wired', 39, { input: regular })]), TH);
    expect(out).toEqual([]);
  });
});

describe('round-bell abuse detector', () => {
  const parked = (w: string, r: number) => {
    const s = sess(w, r);
    return { ...s, joinedAt: s.joinsCloseAt - 5000, afkMs: 60_000, afkAtEnd: true };
  };
  it('flags tickets parked just before the join close and left idle until the bell', () => {
    const out = detectBellAbuse(snap([1, 2, 3].map((r) => parked('parker', r))), TH);
    expect(out).toHaveLength(1);
    expect(out[0].evidence.parkedTickets).toBe(3);
  });

  it('flags an idle ticket that keeps getting fed', () => {
    const fed = [1, 2, 3].map((r) => sess('sink', r, { receivedWhileAfk: FEE, afkMs: 100_000 }));
    const out = detectBellAbuse(snap(fed), TH);
    expect(out[0].beneficiary).toBe('sink');
    expect(out[0].score).toBeGreaterThanOrEqual(70);
  });

  it('does not flag late joiners who play, or a single idle ticket', () => {
    const active = [1, 2, 3].map((r) => ({ ...parked('active', r), afkMs: 0, afkAtEnd: false }));
    expect(detectBellAbuse(snap(active), TH)).toEqual([]);
    expect(detectBellAbuse(snap([parked('once', 1)]), TH)).toEqual([]);
  });
});

describe('scoring', () => {
  it('runDetectors keeps candidates at the flag score; walletRisk names the beneficiary', () => {
    const a = sess('alice', 1, { ipHash: 'ip1', fpHash: 'fpX' });
    const b = sess('bob', 1, { ipHash: 'ip1', fpHash: 'fpX' });
    const s = [1, 2, 3].map((r) => sess('feeder', r, { ejects: { eatenBy: { partner: 18 }, eatenOther: 1 } }));
    const cands = runDetectors(snap([a, b, ...s]), TH);
    expect(cands.map((c) => c.kind).sort()).toEqual(['eject_feed', 'shared_device']);
    expect(walletRisk('partner', cands).score).toBeGreaterThan(0);
    // the feeder is named but is not the beneficiary
    expect(walletRisk('feeder', cands).score).toBe(0);
    expect(walletRisk('alice', cands).score).toBe(TH.sharedBothScore + 10);
    expect(walletRisk('nobody', cands)).toEqual({ score: 0, flags: [] });
  });

  it('a scoped snapshot finds the same flags for its wallet as the full one', () => {
    const a = arena([1, 2, 3, 4, 5, 6], ['victim', 'farmer']);
    const extra = [1, 2, 3, 4, 5, 6].map((r) => tr(a.ticket('victim', r), a.ticket('farmer', r), FEE, T0 + r * ROUND + 50_000, 11));
    const full = snap(a.sessions, [...a.transfers, ...extra]);
    const all = runDetectors(full, TH).filter((c) => c.beneficiary === 'farmer');
    const scoped = runDetectors(scopeSnapshot(full, 'farmer'), TH).filter((c) => c.beneficiary === 'farmer');
    expect(scoped).toEqual(all);
    expect(scoped.length).toBe(1);
  });

  it('detectors are pure: same input, same output', () => {
    const a = arena([1, 2, 3], ['x', 'y']);
    const s = snap(a.sessions, a.transfers);
    expect(runDetectors(s, TH)).toEqual(runDetectors(s, TH));
  });
});
