import { describe, expect, it } from 'vitest';
import { ArenaLedger, type ArenaEntry } from '../src/stake/ledger';

const entry = (pid: number, value: number): ArenaEntry => ({
  pid,
  player: `wallet${pid}`,
  session: `session${pid}`,
  sessionId: pid,
  arenaId: 1,
  entryFee: value,
  value,
  openedAt: 0,
});

describe('arena ledger', () => {
  it('spill takes proportional value and everything on last cell', () => {
    const ledger = new ArenaLedger();
    ledger.join(entry(1, 100_000_000));
    expect(ledger.spill(1, 25, 100, false)).toBe(25_000_000);
    expect(ledger.value(1)).toBe(75_000_000);
    expect(ledger.spill(1, 1, 3, false)).toBe(25_000_000);
    expect(ledger.value(1)).toBe(50_000_000);
    expect(ledger.spill(1, 10, 75, true)).toBe(50_000_000);
    expect(ledger.value(1)).toBe(0);
    expect(ledger.total()).toBe(0);
    // unknown players spill nothing
    expect(ledger.spill(99, 1, 1, true)).toBe(0);
  });

  it('credit adds loot value', () => {
    const ledger = new ArenaLedger();
    ledger.join(entry(1, 10));
    expect(ledger.credit(1, 7)).toBe(true);
    expect(ledger.value(1)).toBe(17);
    expect(ledger.total()).toBe(17);
    // unknown players and invalid amounts are rejected
    expect(ledger.credit(2, 5)).toBe(false);
    expect(ledger.credit(1, -3)).toBe(false);
    expect(ledger.credit(1, 1.5)).toBe(false);
    expect(ledger.value(1)).toBe(17);
  });
});
