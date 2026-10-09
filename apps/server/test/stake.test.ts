import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

  it('a corrupted file is moved aside instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solagel-journal-'));
    const path = join(dir, 'journal.json');
    writeFileSync(path, '{"version":1,"pending":[{"key"'); // truncated write
    const logs: string[] = [];
    const j = new Journal(path, (m) => logs.push(m));
    expect(j.pending).toHaveLength(0);
    expect(logs[0]).toMatch(/unreadable/);
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir).some((f) => f.includes('corrupt'))).toBe(true);
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
