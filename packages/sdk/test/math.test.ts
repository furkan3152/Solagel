import BN from 'bn.js';
import { describe, expect, it } from 'vitest';
import { levelFromXp, mulBps, splitPayout } from '../src';

describe('splitPayout mirrors settle_session', () => {
  it('fee on profit only, 100 % of it to the fee wallet', () => {
    expect(splitPayout(100n, 100n, 500)).toEqual({ fee: 0n, player: 100n }); // break-even
    expect(splitPayout(50n, 100n, 500)).toEqual({ fee: 0n, player: 50n }); // loss: no fee
    expect(splitPayout(0n, 100n, 1_000)).toEqual({ fee: 0n, player: 0n });
    expect(splitPayout(1_000n, 100n, 500)).toEqual({ fee: 45n, player: 955n }); // profit 900 → 45
    expect(splitPayout(2_000n, 1_000n, 500)).toEqual({ fee: 50n, player: 1_950n });
    expect(splitPayout(2_000n, 1_000n, 0)).toEqual({ fee: 0n, player: 2_000n });
    expect(splitPayout(2_000n, 1_000n, 1_000)).toEqual({ fee: 100n, player: 1_900n });
  });

  it('rounds the fee down', () => {
    expect(splitPayout(1_199n, 1_000n, 500).fee).toBe(9n); // 199 × 5 % = 9.95
    expect(splitPayout(119n, 100n, 500).fee).toBe(0n); // 0.95
    expect(splitPayout(120n, 100n, 500).fee).toBe(1n);
  });

  it('conserves amounts and accepts numbers/BN', () => {
    for (let payout = 0; payout < 5_000_000; payout += 7_919 * 13) {
      for (const entry of [1, 999, 1_000_000, 2_500_000]) {
        for (const bps of [0, 137, 500, 1_000]) {
          const s = splitPayout(payout, entry, bps);
          expect(s.player + s.fee).toBe(BigInt(payout));
          expect(s.fee).toBe((BigInt(Math.max(0, payout - entry)) * BigInt(bps)) / 10_000n);
        }
      }
    }
    expect(splitPayout(new BN(2_000), 1_000, 500).fee).toBe(50n);
    // beyond 2^53 stays exact
    const big = splitPayout(2n ** 63n, 0n, 1_000);
    expect(big.player + big.fee).toBe(2n ** 63n);
    expect(big.fee).toBe(2n ** 63n / 10n);
  });

  it('refuses values the program cannot take', () => {
    expect(() => splitPayout(-1n, 0n, 500)).toThrow(RangeError);
    expect(() => splitPayout(2n ** 64n, 0n, 500)).toThrow(RangeError);
    expect(() => splitPayout(1n, 0n, -1)).toThrow(RangeError);
    expect(() => splitPayout(1n, 0n, 70_000)).toThrow(RangeError);
    expect(() => splitPayout(1n, 0n, 1.5)).toThrow(RangeError);
  });
});

describe('math', () => {
  it('levelFromXp = 1 + isqrt(xp / 50), integer exact', () => {
    const cases: [number | bigint, number][] = [
      [0, 1],
      [49, 1],
      [50, 2],
      [800, 5],
      [18_050, 20],
      [18_446_744_073_709_551_615n, 607_400_100],
    ];
    for (const [xp, level] of cases) expect(levelFromXp(xp)).toBe(level);
    expect(levelFromXp(new BN(50 * 99 * 99))).toBe(100);
  });

  it('mulBps is bigint and rounds down', () => {
    expect(mulBps(1_000n, 250)).toBe(25n);
    expect(mulBps(999, 1)).toBe(0n);
  });
});
