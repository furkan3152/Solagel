import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntegrityService } from '../src/integrity/service';
import { IntegrityStore } from '../src/integrity/store';
import { emptyInput, type SessionSummary } from '../src/integrity/types';
import { Journal } from '../src/stake/journal';

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 21, 12, 0, 0);

const summary = (key: string, endedAt: number): SessionSummary => ({
  key,
  wallet: 'w',
  arenaId: 1,
  roomId: 'arena-1-1',
  entryFee: 1,
  round: 1,
  roundStartsAt: 0,
  joinsCloseAt: 0,
  roundEndsAt: 0,
  joinedAt: endedAt - 1000,
  endedAt,
  endReason: 'round',
  payout: 1,
  ipHash: 'h',
  fpHash: null,
  afkMs: 0,
  afkAtEnd: false,
  receivedWhileAfk: 0,
  input: emptyInput(),
  ejects: { eatenBy: {}, eatenOther: 0 },
  death: null,
});

describe('integrity store', () => {
  it('appends immutable chunks, prunes by age and count, and reads the window back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-ist-'));
    const clock = { t: T - 40 * DAY };
    const store = new IntegrityStore(dir, { now: () => clock.t, retentionDays: 30, maxFiles: 5 });
    store.appendLog({ sessions: [summary('old', clock.t)], transfers: [] });
    clock.t = T;
    // the 40-day-old chunk is pruned on the next write
    store.appendLog({ sessions: [summary('a', T)], transfers: [] });
    let files = readdirSync(join(dir, 'log'));
    expect(files).toHaveLength(1);
    for (let i = 0; i < 7; i++) {
      clock.t += 1000;
      store.appendLog({ sessions: [summary(`n${i}`, clock.t)], transfers: [] });
    }
    files = readdirSync(join(dir, 'log'));
    expect(files).toHaveLength(5);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    const back = store.loadRecent(T - DAY, 100, 100);
    expect(back.sessions.map((s) => s.key)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6']);
    // empty chunks are not written
    store.appendLog({ sessions: [], transfers: [] });
    expect(readdirSync(join(dir, 'log'))).toHaveLength(5);
  });

  it('keeps one secret across restarts; quarantines an unreadable state file and starts safe (auto-hold off)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slana-ist-'));
    const a = new IntegrityStore(dir);
    const b = new IntegrityStore(dir);
    expect(a.secret.equals(b.secret)).toBe(true);
    const svcA = new IntegrityService({ store: a, journal: new Journal(null), kick: () => {} });
    const svcB = new IntegrityService({ store: b, journal: new Journal(null), kick: () => {} });
    expect(svcA.hashIp('1.2.3.4')).toBe(svcB.hashIp('1.2.3.4'));
    expect(svcA.hashIp('1.2.3.4')).not.toContain('1.2.3.4');
    expect(svcA.hashFp('not hex')).toBeNull();
    expect(svcA.hashFp('ab'.repeat(16))).toMatch(/^[0-9a-f]{20}$/);

    writeFileSync(join(dir, 'state.json'), '{nope');
    const logs: string[] = [];
    const c = new IntegrityStore(dir, { log: (m) => logs.push(m) });
    const st = c.loadState();
    expect(st.settings.autoHold).toBe(false);
    expect(st.bans).toEqual([]);
    expect(logs[0]).toContain('!!!');
    expect(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('the in-memory window is capped', () => {
    const journal = new Journal(null);
    const svc = new IntegrityService({ store: new IntegrityStore(null), journal, kick: () => {}, maxSessions: 50, maxTransfers: 100 });
    const room = { id: 'r', now: () => T, round: () => ({ n: 1, endsAt: T + 1000, joinsCloseAt: T }), opts: { stake: { arenaId: 1, buyIn: 1 } } };
    for (let i = 0; i < 200; i++) {
      svc.join(room, i, { ip: 'x', fp: null }, { player: `w${i}`, session: `s${i}`, sessionId: i, arenaId: 1, entryFee: 1 });
      svc.settle(room, i, null, { reason: 'death', payout: 0, killer: null, killerIsBot: true });
    }
    expect(svc.overview().counts.sessions).toBe(50);
    expect(svc.monitor.size).toBe(0);
  });
});
