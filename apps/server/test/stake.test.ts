import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/game/rng';
import { Journal, type LiveStake, type SettlementItem } from '../src/stake/journal';
import { StakeLedger } from '../src/stake/ledger';

const entry = (pid: number, value: number) => ({
  pid,
  player: `wallet${pid}`,
  session: `session${pid}`,
  sessionId: pid,
  arenaId: 1,
  buyIn: value,
  value,
  openedAt: 0,
  kills: 0,
});

describe('stake ledger', () => {
  it('random partial and total eats conserve total value', () => {
    const rng = mulberry32(7);
    const ledger = new StakeLedger();
    const masses = new Map<number, number>();
    for (let pid = 1; pid <= 12; pid++) {
      ledger.join(entry(pid, 10_000_000 + Math.floor(rng() * 1_000_000)));
      masses.set(pid, 20 + rng() * 500);
    }
    const total = ledger.total();
    for (let i = 0; i < 1000; i++) {
      const pids = ledger.all().map((e) => e.pid);
      if (pids.length < 2) break;
      const from = pids[Math.floor(rng() * pids.length)];
      let to = pids[Math.floor(rng() * pids.length)];
      if (to === from) to = pids[(pids.indexOf(from) + 1) % pids.length];
      const victimMass = masses.get(from)!;
      const last = rng() < 0.08;
      const eaten = last ? victimMass : victimMass * rng() * 0.6;
      ledger.transfer(from, to, eaten, victimMass, last);
      masses.set(to, masses.get(to)! + eaten);
      if (last) {
        const gone = ledger.leave(from)!;
        expect(gone.value).toBe(0);
        masses.delete(from);
      } else {
        masses.set(from, victimMass - eaten);
      }
      expect(ledger.total()).toBe(total);
      for (const e of ledger.all()) expect(Number.isSafeInteger(e.value) && e.value >= 0).toBe(true);
    }
  });

  it('last cell transfers everything; proportional otherwise', () => {
    const ledger = new StakeLedger();
    ledger.join(entry(1, 100_000_000));
    ledger.join(entry(2, 100_000_000));
    expect(ledger.transfer(1, 2, 25, 100, false)).toBe(25_000_000);
    expect(ledger.value(1)).toBe(75_000_000);
    expect(ledger.transfer(1, 2, 10, 75, true)).toBe(75_000_000);
    expect(ledger.value(1)).toBe(0);
    expect(ledger.value(2)).toBe(200_000_000);
  });

  it('rejects unsafe totals and duplicate financial tickets', () => {
    const ledger = new StakeLedger();
    ledger.join(entry(1, Number.MAX_SAFE_INTEGER));
    expect(() => ledger.join(entry(2, 1))).toThrow(/safe accounting/);
    expect(() => ledger.join({ ...entry(2, 0), session: 'session1' })).toThrow(/already staked/);
    expect(ledger.total()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('invalid simulation masses cannot poison the balance ledger with NaN', () => {
    const ledger = new StakeLedger();
    ledger.join(entry(1, 100));
    ledger.join(entry(2, 100));
    expect(ledger.transfer(1, 2, NaN, 100, false)).toBe(0);
    expect(ledger.transfer(1, 2, 100, Infinity, true)).toBe(0);
    expect(ledger.total()).toBe(200);
  });

  it('ignores unknown players and self transfers', () => {
    const ledger = new StakeLedger();
    ledger.join(entry(1, 5));
    expect(ledger.transfer(1, 99, 1, 1, true)).toBe(0);
    expect(ledger.transfer(1, 1, 1, 1, true)).toBe(0);
    expect(ledger.value(1)).toBe(5);
  });
});

const item = (key: string, payout: number): SettlementItem => ({
  kind: 'settle',
  key,
  player: 'w',
  arenaId: 1,
  session: key,
  payout,
  score: 10,
  kills: 1,
  xp: 5,
  reason: 'cashout',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 0,
});

const live = (session: string, value: number): LiveStake => ({
  roomId: 'stake-1',
  session,
  sessionId: 7,
  player: `w-${session}`,
  arenaId: 1,
  value,
  score: 100,
  kills: 2,
});

describe('settlement journal', () => {
  it('journal recovery settles live players at their last value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const j1 = new Journal(path);
    j1.commit({ enqueue: [item('s-cashed', 150)], roomId: 'stake-1', live: [live('s-a', 70), live('s-b', 80)] });

    // "crash" → new process loads the same file
    const j2 = new Journal(path);
    expect(j2.pending.map((p) => p.key)).toEqual(['s-cashed']);
    expect(j2.live()).toHaveLength(2);
    expect(j2.recoverLive(123)).toBe(2);
    expect(j2.live()).toHaveLength(0);
    const recovered = j2.pending.filter((p) => p.reason === 'crash');
    expect(recovered.map((p) => [p.session, p.payout])).toEqual([
      ['s-a', 70],
      ['s-b', 80],
    ]);
    // total owed is unchanged by the crash
    expect(j2.pending.reduce((s, p) => s + (p.payout ?? 0), 0)).toBe(300);

    const j3 = new Journal(path);
    expect(j3.pending).toHaveLength(3);
    j3.remove('s-a');
    expect(new Journal(path).pending).toHaveLength(2);
  });

  it('does not duplicate pending items with the same key', () => {
    const j = new Journal(null);
    j.enqueue(item('k', 1));
    j.enqueue(item('k', 1));
    expect(j.pending).toHaveLength(1);
  });

  it('refuses startup on a corrupt financial journal and preserves it for recovery', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const broken = '{"version":1,"pending":[{"key"';
    writeFileSync(path, broken);
    const logs: string[] = [];
    expect(() => new Journal(path, (m) => logs.push(m))).toThrow(/refusing to start/);
    expect(logs[0]).toMatch(/unreadable/);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(broken);
  });

  it('rejects invalid balances and competing claims without changing the last good snapshot', () => {
    const j = new Journal(null);
    j.commit({ roomId: 'stake-1', live: [live('s', 100)] });
    expect(() => j.enqueue(item('s', 100))).toThrow(/duplicate financial claim/);
    expect(() => j.enqueue(item('bad', -1))).toThrow(/invalid journal balance/);
    expect(j.pending).toHaveLength(0);
    expect(j.live()[0].value).toBe(100);
  });

  it('does not publish an in-memory commit when persistence fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    j.enqueue(item('first', 10));
    mkdirSync(`${path}.tmp`);
    expect(() => j.enqueue(item('second', 20))).toThrow();
    expect(j.healthy).toBe(false);
    expect(() => j.remove('first')).toThrow(/financial activity is halted/);
    expect(j.pending.map((p) => p.key)).toEqual(['first']);
    expect(new Journal(path).pending.map((p) => p.key)).toEqual(['first']);
  });

  it('persists broadcast signatures so lost confirmations survive a process restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    j.enqueue(item('s', 10));
    j.submitted('s', 'signature-before-send');
    expect(new Journal(path).pending[0].submittedSignature).toBe('signature-before-send');
  });

  it('archives confirmed receipts atomically and isolates them by wallet and session incarnation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    j.enqueue({ ...item('reused-session', 10), sessionId: 7 });
    j.complete('reused-session', 'sig-old', 100);
    j.enqueue({ ...item('reused-session', 15), sessionId: 8 });
    j.complete('reused-session', 'sig-new', 200);
    const recovered = new Journal(path);
    expect(recovered.pending).toHaveLength(0);
    expect(recovered.receiptsFor('w')).toMatchObject([
      { signature: 'sig-old', sessionId: 7, arenaId: 1, payout: 10 },
      { signature: 'sig-new', sessionId: 8, arenaId: 1, payout: 15 },
    ]);
    expect(recovered.receiptsFor('another-wallet')).toEqual([]);
  });

  it('retries with backoff', () => {
    const j = new Journal(null);
    j.enqueue(item('k', 1));
    j.retryLater('k', 'rpc down', 1000);
    expect(j.pending[0].attempts).toBe(1);
    expect(j.pending[0].nextAttemptAt).toBe(1000 + 4000);
    expect(j.pending[0].lastError).toBe('rpc down');
  });

  it('writes atomically (file is valid JSON after every commit)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    const j = new Journal(path);
    for (let i = 0; i < 50; i++) {
      j.commit({ enqueue: [item(`k${i}`, i)], roomId: 'stake-1', live: [live(`l${i}`, i)] });
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(parsed.pending).toHaveLength(i + 1);
      expect(parsed.live).toHaveLength(1);
    }
  });
});
