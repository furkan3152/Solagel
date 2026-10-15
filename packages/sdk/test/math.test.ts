import BN from 'bn.js';
import { describe, expect, it } from 'vitest';
import { levelFromXp, mulBps, prizeAmount, splitPayout, splitSessionPayout } from '../src';

const cfg = (feeBps: number, treasuryBps: number, burnBps: number, passFeeBps = 200) => ({ feeBps, passFeeBps, treasuryBps, burnBps });
const tuple = (s: ReturnType<typeof splitPayout>) => [s.fee, s.treasury, s.season, s.burn, s.player];

describe('splitPayout mirrors logic::split_payout', () => {
  it('fee on profit only (program vectors)', () => {
    expect(splitPayout(100n, 100n, false, cfg(500, 5_000, 2_000))).toEqual({ fee: 0n, treasury: 0n, season: 0n, burn: 0n, player: 100n });
    expect(splitPayout(50n, 100n, false, cfg(500, 5_000, 2_000)).player).toBe(50n);
    expect(tuple(splitPayout(0n, 100n, false, cfg(1_000, 5_000, 2_000)))).toEqual([0n, 0n, 0n, 0n, 0n]);
    expect(tuple(splitPayout(1_000n, 100n, false, cfg(500, 5_000, 2_000)))).toEqual([45n, 22n, 14n, 9n, 955n]);
    expect(tuple(splitPayout(2_000n, 1_000n, false, cfg(500, 5_000, 2_000)))).toEqual([50n, 25n, 15n, 10n, 1_950n]);
  });

  it('a Pass session pays passFeeBps', () => {
    const c = cfg(500, 5_000, 2_000, 200);
    expect(splitPayout(2_000n, 1_000n, true, c).fee).toBe(20n);
    expect(tuple(splitPayout(2_000n, 1_000n, true, c))).toEqual([20n, 10n, 6n, 4n, 1_980n]);
  });

  it('remainder goes to the season (program vectors)', () => {
    expect(tuple(splitPayout(1_199n, 1_000n, false, cfg(500, 5_000, 2_000)))).toEqual([9n, 4n, 4n, 1n, 1_190n]);
    const one = splitPayout(120n, 100n, false, cfg(500, 5_000, 2_000));
    expect([one.fee, one.treasury, one.burn, one.season]).toEqual([1n, 0n, 0n, 1n]);
    const t = splitPayout(2_000n, 1_000n, false, cfg(1_000, 10_000, 0));
    expect([t.treasury, t.burn, t.season]).toEqual([100n, 0n, 0n]);
    const b = splitPayout(2_000n, 1_000n, false, cfg(1_000, 0, 10_000));
    expect([b.treasury, b.burn, b.season]).toEqual([0n, 100n, 0n]);
    // the program fails with MathOverflow for a split above 100 %
    expect(() => splitPayout(2_000n, 1_000n, false, cfg(1_000, 10_000, 10_000))).toThrow(RangeError);
  });

  it('conserves amounts and accepts numbers/BN', () => {
    for (let payout = 0; payout < 5_000_000; payout += 7_919 * 13) {
      for (const entry of [1, 999, 1_000_000, 2_500_000]) {
        for (const [f, t, b] of [
          [0, 5_000, 2_000],
          [500, 5_000, 2_000],
          [1_000, 3_333, 3_333],
          [137, 10_000, 0],
          [200, 0, 0],
        ]) {
          const s = splitPayout(payout, entry, false, cfg(f, t, b));
          expect(s.player + s.fee).toBe(BigInt(payout));
          expect(s.treasury + s.season + s.burn).toBe(s.fee);
        }
      }
    }
    expect(splitPayout(new BN(2_000), 1_000, false, cfg(500, 5_000, 2_000)).fee).toBe(50n);
    // beyond 2^53 stays exact
    const big = splitPayout(2n ** 63n, 0n, false, cfg(1_000, 5_000, 2_000));
    expect(big.player + big.fee).toBe(2n ** 63n);
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

  it('mulBps and prizes are bigint', () => {
    expect(mulBps(1_000n, 250)).toBe(25n);
    expect(prizeAmount(1_000_000n, 0)).toBe(300_000n);
    expect(prizeAmount(1_000_000, 9)).toBe(20_000n);
    expect(prizeAmount(1_000_000n, 10)).toBe(0n);
  });
});

describe('splitSessionPayout uses the fee fixed at join', () => {
  it('ignores the config fee, keeps the config shares', () => {
    const now = { feeBps: 1_000, passFeeBps: 1_000, treasuryBps: 5_000, burnBps: 2_000 };
    // joined at 5 %: profit 1000 → fee 50 even though the config now says 10 %
    expect(splitSessionPayout(2_000n, { entryFee: 1_000n, feeBps: 500 }, now)).toEqual(splitPayout(2_000n, 1_000n, false, { ...now, feeBps: 500 }));
    expect(splitSessionPayout(2_000n, { entryFee: 1_000n, feeBps: 500 }, now).fee).toBe(50n);
    expect(splitSessionPayout(2_000n, { entryFee: 1_000n, feeBps: 200 }, now)).toMatchObject({ fee: 20n, treasury: 10n, season: 6n, burn: 4n, player: 1_980n });
  });
});
