import { describe, expect, it } from 'vitest';
import { BPS, MAX_UINT128 } from '../src/constants';
import { computeFee, fromLedger, ledgerDecimals, ledgerUnitScale, mulBps, splitPayout, toBigInt, toLedger } from '../src/math';

describe('computeFee / splitPayout (ElymumArena.computeFee)', () => {
  it('takes the fee on profit only, rounded down', () => {
    expect(computeFee(1_500n, 1_000n, 500)).toBe(25n);
    expect(computeFee(1_000n, 1_000n, 500)).toBe(0n);
    expect(computeFee(400n, 1_000n, 500)).toBe(0n);
    expect(computeFee(1_019n, 1_000n, 500)).toBe(0n); // 19 * 5 % = 0.95 → 0
    expect(computeFee(1_020n, 1_000n, 500)).toBe(1n);
    expect(computeFee(2_000n, 1_000n, 0)).toBe(0n);
    expect(computeFee(2_000n, 1_000n, 1_000)).toBe(100n);
  });

  it('splits payout = fee + player', () => {
    for (const [p, e, bps] of [
      [0n, 10n, 500],
      [12_345_678n, 1_000n, 500],
      [10n ** 24n, 10n ** 21n, 777],
      [MAX_UINT128, 0n, 1_000],
    ] as const) {
      const s = splitPayout(p, e, bps);
      expect(s.fee + s.player).toBe(p);
      expect(s.fee).toBe(((p > e ? p - e : 0n) * BigInt(bps)) / BigInt(BPS));
    }
  });

  it('accepts numbers and refuses what the contract could not take', () => {
    expect(computeFee(1500, 1000, 500)).toBe(25n);
    expect(() => computeFee(-1n, 0n, 500)).toThrow(RangeError);
    expect(() => computeFee(MAX_UINT128 + 1n, 0n, 500)).toThrow(RangeError);
    expect(() => computeFee(1n, 0n, 70_000)).toThrow(RangeError);
    expect(() => computeFee(1.5, 0, 500)).toThrow(RangeError);
  });

  it('mulBps and toBigInt', () => {
    expect(mulBps(10_000n, 250)).toBe(250n);
    expect(toBigInt(5)).toBe(5n);
    expect(() => toBigInt(0.1)).toThrow(RangeError);
  });
});

describe('ledger units', () => {
  it('scales an 18-decimal token down to 6 decimals', () => {
    expect(ledgerUnitScale(18)).toBe(10n ** 12n);
    expect(ledgerUnitScale(6)).toBe(1n);
    expect(ledgerUnitScale(0)).toBe(1n);
    expect(ledgerDecimals(18)).toBe(6);
    expect(ledgerDecimals(2)).toBe(2);
    expect(() => ledgerUnitScale(-1)).toThrow(RangeError);
  });

  it('round-trips the default entry fees of an 18-decimal token', () => {
    const base = 250_000n * 10n ** 18n;
    const l = toLedger(base, 18);
    expect(l).toBe(250_000_000_000);
    expect(Number.isSafeInteger(l)).toBe(true);
    expect(fromLedger(l, 18)).toBe(base);
  });

  it('refuses inexact amounts unless asked to round', () => {
    const base = 10n ** 12n + 1n;
    expect(() => toLedger(base, 18)).toThrow(RangeError);
    expect(toLedger(base, 18, 'floor')).toBe(1);
    expect(toLedger(base, 18, 'ceil')).toBe(2);
  });

  it('refuses unsafe and negative values', () => {
    expect(() => toLedger(-1n, 18)).toThrow(RangeError);
    expect(() => toLedger(2n ** 53n * 10n ** 12n, 18)).toThrow(RangeError);
    expect(() => fromLedger(2 ** 53, 18)).toThrow(RangeError);
    expect(() => fromLedger(-1, 18)).toThrow(RangeError);
    expect(() => fromLedger(1.5, 18)).toThrow(RangeError);
    expect(fromLedger(7n, 6)).toBe(7n);
  });
});
