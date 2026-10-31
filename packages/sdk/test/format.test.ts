import { describe, expect, it } from 'vitest';
import {
  checksumAddress,
  formatBps,
  formatHypeAmount,
  formatTokenAmount,
  formatTokenWithSymbol,
  formatUsdCents,
  isZeroAddress,
  parseHypeAmount,
  parseTokenAmount,
  sameAddress,
  shortAddress,
  shortHash,
} from '../src/format';

describe('format', () => {
  it('formats 18-decimal token amounts exactly', () => {
    expect(formatTokenAmount(1_234_500_000_000_000_000_000n, 18)).toBe('1,234.5');
    expect(formatTokenAmount(1n, 18)).toBe('0');
    expect(formatTokenAmount(1_000_000_000_000n, 18)).toBe('0.000001');
    expect(formatTokenAmount(12_400n * 10n ** 18n, 18, { compact: true })).toBe('12.4K');
    expect(formatTokenWithSymbol(10n ** 18n, 18, '$ELYMUM')).toBe('1 $ELYMUM');
  });

  it('parses token and HYPE amounts', () => {
    expect(parseTokenAmount('1_000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseTokenAmount('0.5', 6)).toBe(500_000n);
    expect(() => parseTokenAmount('1,5', 18)).toThrow();
    expect(parseHypeAmount('0.03')).toBe(3n * 10n ** 16n);
    expect(parseHypeAmount('0.03 HYPE')).toBe(3n * 10n ** 16n);
  });

  it('formats HYPE, bps and cents', () => {
    expect(formatHypeAmount(31_234_567_000_000_000n)).toBe('0.031235 HYPE');
    expect(formatHypeAmount(31_234_567_000_000_000n, 4)).toBe('0.0312 HYPE');
    expect(formatBps(500)).toBe('5.00 %');
    expect(formatUsdCents(100)).toBe('$1.00');
    expect(formatUsdCents(123456)).toBe('$1,234.56');
  });

  it('handles addresses', () => {
    const a = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
    expect(checksumAddress(a)).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(checksumAddress('nope')).toBeNull();
    expect(sameAddress(a, a.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(sameAddress(a, null)).toBe(false);
    expect(shortAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39F…2266');
    expect(shortHash(`0x${'ab'.repeat(32)}`)).toBe('0xababab…ababab');
    expect(isZeroAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(isZeroAddress(a)).toBe(false);
  });
});
