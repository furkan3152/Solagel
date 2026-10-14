import { describe, expect, it } from 'vitest';
import { TOKEN_SYMBOL_DEFAULT, formatToken, parseToken, toSafeAmount } from '../src';

describe('TOKEN_SYMBOL_DEFAULT', () => {
  it('is $SLANA', () => {
    expect(TOKEN_SYMBOL_DEFAULT).toBe('$SLANA');
  });
});

describe('toSafeAmount', () => {
  it('returns safe integers as numbers', () => {
    expect(toSafeAmount(0n)).toBe(0);
    expect(toSafeAmount(123_456_789n)).toBe(123_456_789);
    expect(toSafeAmount(42)).toBe(42);
    expect(toSafeAmount(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(toSafeAmount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    // a pump.fun style supply (1e9 tokens, 6 decimals) is nowhere near the limit
    expect(toSafeAmount(1_000_000_000n * 1_000_000n)).toBe(1e15);
  });

  it('throws RangeError above MAX_SAFE_INTEGER', () => {
    expect(() => toSafeAmount(2n ** 53n)).toThrow(RangeError);
    expect(() => toSafeAmount(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(() => toSafeAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => toSafeAmount(2n ** 64n - 1n)).toThrow(RangeError);
    expect(() => toSafeAmount(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('throws RangeError below 0', () => {
    expect(() => toSafeAmount(-1n)).toThrow(RangeError);
    expect(() => toSafeAmount(-1)).toThrow(RangeError);
    expect(() => toSafeAmount(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects numbers that are not whole base units', () => {
    expect(() => toSafeAmount(1.5)).toThrow(RangeError);
    expect(() => toSafeAmount(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatToken', () => {
  it('uses locale separators and strips trailing zeros', () => {
    expect(formatToken(1_000_000_000n, 6, 'tr')).toBe('1.000');
    expect(formatToken(1_234_500_000, 6, 'tr')).toBe('1.234,5');
    expect(formatToken(1_234_500_000, 6, 'en')).toBe('1,234.5');
    expect(formatToken(2_000_000, 6, 'tr')).toBe('2');
    expect(formatToken(1_500_000, 6, 'en')).toBe('1.5');
    expect(formatToken(0, 6, 'en')).toBe('0');
    expect(formatToken(0n, 6, 'tr')).toBe('0');
  });

  it('accepts numbers and bigints alike, exactly even beyond 2^53', () => {
    expect(formatToken(1_234_500_000n, 6, 'tr')).toBe(formatToken(1_234_500_000, 6, 'tr'));
    expect(formatToken(123_456_789_012_345_678_901_234n, 6, 'en')).toBe('123,456,789,012,345,678.9');
    expect(formatToken(123_456_789_012_345_678_901_234n, 6, 'en', { maxFrac: 6 })).toBe('123,456,789,012,345,678.901234');
  });

  it('groups thousands in whole-token amounts', () => {
    expect(formatToken(12_450_000_000, 6, 'tr')).toBe('12.450');
    expect(formatToken(12_450_000_000, 6, 'en')).toBe('12,450');
    expect(formatToken(1_234_567_000_000, 6, 'en')).toBe('1,234,567');
    expect(formatToken(999_000_000, 6, 'en')).toBe('999');
  });

  it('rounds half up to maxFrac (default 2) without float drift', () => {
    expect(formatToken(1_234_567, 6, 'en')).toBe('1.23');
    expect(formatToken(1_005_000, 6, 'en')).toBe('1.01'); // 1.005 would print 1.00 through toFixed
    expect(formatToken(1_004_999, 6, 'en')).toBe('1');
    expect(formatToken(999_999, 6, 'en')).toBe('1');
    expect(formatToken(1, 6, 'en')).toBe('0');
  });

  it('honours maxFrac, capped by the token decimals', () => {
    expect(formatToken(1_234_567, 6, 'en', { maxFrac: 4 })).toBe('1.2346');
    expect(formatToken(1_234_567, 6, 'tr', { maxFrac: 6 })).toBe('1,234567');
    expect(formatToken(1_234_567, 6, 'en', { maxFrac: 0 })).toBe('1');
    expect(formatToken(1, 6, 'en', { maxFrac: 6 })).toBe('0.000001');
    expect(formatToken(1_500, 3, 'en', { maxFrac: 9 })).toBe('1.5');
  });

  it('handles other decimals', () => {
    expect(formatToken(1_234_567, 0, 'en')).toBe('1,234,567');
    expect(formatToken(1_500_000_000, 9, 'en')).toBe('1.5');
    expect(formatToken(1_000_000_000_000_000_000n, 9, 'tr')).toBe('1.000.000.000');
  });

  it('formats negative amounts (value deltas)', () => {
    expect(formatToken(-1_234_500_000, 6, 'en')).toBe('-1,234.5');
    expect(formatToken(-500_000n, 6, 'tr')).toBe('-0,5');
    // a delta that rounds to zero prints without a sign
    expect(formatToken(-1, 6, 'en')).toBe('0');
    expect(formatToken(-4_000n, 6, 'tr')).toBe('0');
    expect(formatToken(-1, 6, 'en', { compact: true })).toBe('0');
  });

  it('rounds fractional numbers to whole base units and rejects non-finite ones', () => {
    expect(formatToken(1_234_500_000.4, 6, 'en')).toBe('1,234.5');
    expect(() => formatToken(Number.NaN, 6, 'en')).toThrow(RangeError);
    expect(() => formatToken(Number.POSITIVE_INFINITY, 6, 'en')).toThrow(RangeError);
    expect(() => formatToken(1, -1, 'en')).toThrow(RangeError);
    expect(() => formatToken(1, 1.5, 'en')).toThrow(RangeError);
  });

  describe('compact', () => {
    it('en uses K and M without a space', () => {
      expect(formatToken(12_400_000_000, 6, 'en', { compact: true })).toBe('12.4K');
      expect(formatToken(1_000_000_000n, 6, 'en', { compact: true })).toBe('1K');
      expect(formatToken(250_000_000_000, 6, 'en', { compact: true })).toBe('250K');
      expect(formatToken(1_500_000_000_000, 6, 'en', { compact: true })).toBe('1.5M');
      expect(formatToken(12_345_000_000, 6, 'en', { compact: true })).toBe('12.35K');
    });

    it('tr uses B (bin) and Mn (milyon) after a space', () => {
      expect(formatToken(12_400_000_000, 6, 'tr', { compact: true })).toBe('12,4 B');
      expect(formatToken(250_000_000_000, 6, 'tr', { compact: true })).toBe('250 B');
      expect(formatToken(1_500_000_000_000, 6, 'tr', { compact: true })).toBe('1,5 Mn');
      expect(formatToken(3_000_000_000_000n, 6, 'tr', { compact: true })).toBe('3 Mn');
    });

    it('leaves amounts below one thousand tokens uncompacted', () => {
      expect(formatToken(950_500_000, 6, 'en', { compact: true })).toBe('950.5');
      expect(formatToken(950_500_000, 6, 'tr', { compact: true })).toBe('950,5');
      expect(formatToken(0, 6, 'en', { compact: true })).toBe('0');
    });

    it('moves up a tier when rounding reaches 1000', () => {
      expect(formatToken(999_999_000_000, 6, 'en', { compact: true })).toBe('1M');
      expect(formatToken(999_999_000_000, 6, 'tr', { compact: true })).toBe('1 Mn');
      expect(formatToken(999_999_500, 6, 'en', { compact: true })).toBe('1K');
    });

    it('stays in the largest tier for huge amounts and keeps the sign', () => {
      expect(formatToken(1_000_000_000_000_000, 6, 'en', { compact: true })).toBe('1,000M');
      expect(formatToken(1_000_000_000_000_000, 6, 'tr', { compact: true })).toBe('1.000 Mn');
      expect(formatToken(-12_400_000_000, 6, 'en', { compact: true })).toBe('-12.4K');
    });

    it('honours maxFrac', () => {
      expect(formatToken(12_345_000_000, 6, 'en', { compact: true, maxFrac: 1 })).toBe('12.3K');
      expect(formatToken(12_345_000_000, 6, 'en', { compact: true, maxFrac: 0 })).toBe('12K');
    });
  });
});

describe('parseToken', () => {
  it('parses locale-formatted amounts into base units', () => {
    expect(parseToken('1.234,5', 6, 'tr')).toBe(1_234_500_000n);
    expect(parseToken('1,234.5', 6, 'en')).toBe(1_234_500_000n);
    expect(parseToken('12,5', 6, 'tr')).toBe(12_500_000n);
    expect(parseToken('12.5', 6, 'en')).toBe(12_500_000n);
  });

  it('parses plain and partial numbers', () => {
    expect(parseToken('12', 6, 'en')).toBe(12_000_000n);
    expect(parseToken('1000', 6, 'tr')).toBe(1_000_000_000n);
    expect(parseToken('0.000001', 6, 'en')).toBe(1n);
    expect(parseToken('.5', 6, 'en')).toBe(500_000n);
    expect(parseToken('5.', 6, 'en')).toBe(5_000_000n);
    expect(parseToken('  7 ', 6, 'en')).toBe(7_000_000n);
    expect(parseToken('007', 6, 'en')).toBe(7_000_000n);
    expect(parseToken('1,234', 0, 'en')).toBe(1234n);
    expect(parseToken('1.5', 9, 'en')).toBe(1_500_000_000n);
  });

  it('accepts extra fraction digits only when they are zeros', () => {
    expect(parseToken('0.1000000', 6, 'en')).toBe(100_000n);
    expect(() => parseToken('0.0000001', 6, 'en')).toThrow(RangeError);
    expect(() => parseToken('1,5', 0, 'tr')).toThrow(RangeError);
  });

  it('rejects malformed text instead of guessing', () => {
    for (const bad of ['', '  ', '.', 'abc', '1.2.3', '-5', '+5', '1e6', '12 000', '$1', '1,23,4', '1,2345', ',123']) {
      expect(() => parseToken(bad, 6, 'en'), `en ${JSON.stringify(bad)}`).toThrow(SyntaxError);
    }
    // in tr "." is the group separator, so "1.5" is a malformed group, not one and a half
    for (const bad of ['1.5', '1.23', '12.3456', '1,2,3', '1.234,5.6']) {
      expect(() => parseToken(bad, 6, 'tr'), `tr ${JSON.stringify(bad)}`).toThrow(SyntaxError);
    }
    expect(() => parseToken('1', -1, 'en')).toThrow(RangeError);
  });

  it('round-trips formatToken at full precision', () => {
    const raws = [0n, 1n, 999_999n, 1_000_000n, 1_234_567n, 1_234_500_000n, 987_654_321_098_765n, 10n ** 18n + 7n];
    for (const lang of ['tr', 'en'] as const) {
      for (const decimals of [0, 2, 6, 9]) {
        for (const raw of raws) {
          const text = formatToken(raw, decimals, lang, { maxFrac: decimals });
          expect(parseToken(text, decimals, lang), `${lang} d=${decimals} ${text}`).toBe(raw);
        }
      }
    }
  });
});
