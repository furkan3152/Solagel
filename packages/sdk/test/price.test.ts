import { describe, expect, it, vi } from 'vitest';
import {
  PRICE_GRANULARITY_WEI,
  checkHypeUsd,
  clampPrice,
  fetchHypeUsd,
  needsReprice,
  parseDecimal,
  priceDeviationBps,
  usdCentsToWei,
  weiToUsdCents,
  type FetchLike,
} from '../src/price';

describe('usdCentsToWei', () => {
  it('computes $1 exactly at round prices', () => {
    expect(usdCentsToWei(100, 40)).toBe(25_000_000_000_000_000n); // 0.025 HYPE
    expect(usdCentsToWei(100, '50')).toBe(20_000_000_000_000_000n);
    expect(usdCentsToWei(250, 25)).toBe(100_000_000_000_000_000n);
  });

  it('rounds up to 1e12 wei and never below the target', () => {
    const wei = usdCentsToWei(100, '38.123');
    expect(wei % PRICE_GRANULARITY_WEI).toBe(0n);
    // exact value 1/38.123 HYPE = 0.0262308842...
    expect(wei).toBe(26_231_000_000_000_000n);
    expect(wei * 38_123n).toBeGreaterThanOrEqual(10n ** 18n * 1_000n);
    expect((wei - PRICE_GRANULARITY_WEI) * 38_123n).toBeLessThan(10n ** 18n * 1_000n);
  });

  it('uses the exact decimal text (no float drift)', () => {
    expect(usdCentsToWei(100, '0.3')).toBe(usdCentsToWei(100, 0.3));
    expect(parseDecimal('3.8e1')).toEqual({ num: 38n, scale: 0 });
    expect(parseDecimal('38.25')).toEqual({ num: 3825n, scale: 2 });
    expect(parseDecimal(1e-7)).toEqual({ num: 1n, scale: 7 });
    expect(() => parseDecimal('-1')).toThrow(RangeError);
    expect(() => parseDecimal('abc')).toThrow(RangeError);
  });

  it('refuses insane inputs', () => {
    expect(() => usdCentsToWei(100, 0)).toThrow(RangeError);
    expect(() => usdCentsToWei(100, 'NaN')).toThrow(RangeError);
    expect(() => usdCentsToWei(100, 1e9)).toThrow(RangeError);
    expect(() => usdCentsToWei(0, 40)).toThrow(RangeError);
    expect(() => usdCentsToWei(1.5, 40)).toThrow(RangeError);
    expect(checkHypeUsd('41.5')).toBe(41.5);
  });

  it('converts back for display', () => {
    expect(weiToUsdCents(25_000_000_000_000_000n, 40)).toBe(100);
    expect(weiToUsdCents(usdCentsToWei(100, '38.123'), '38.123')).toBe(100);
  });

  it('deviation, reprice threshold and clamping', () => {
    expect(priceDeviationBps(102n, 100n)).toBe(200);
    expect(needsReprice(102n, 100n)).toBe(false);
    expect(needsReprice(103n, 100n)).toBe(true);
    expect(needsReprice(97n, 100n)).toBe(true);
    expect(clampPrice(5n, 10n, 20n)).toBe(10n);
    expect(clampPrice(25n, 10n, 20n)).toBe(20n);
    expect(clampPrice(25n, 0n, 0n)).toBe(25n);
  });
});

describe('fetchHypeUsd', () => {
  const ok = (body: unknown): FetchLike => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));

  it('posts allMids and reads HYPE', async () => {
    const f = ok({ BTC: '65000.0', HYPE: '38.123' });
    const r = await fetchHypeUsd({ fetch: f, url: 'https://example.test/info' });
    expect(r).toEqual({ price: '38.123', value: 38.123 });
    const [url, init] = (f as unknown as { mock: { calls: [string, { method: string; body: string }][] } }).mock.calls[0];
    expect(url).toBe('https://example.test/info');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ type: 'allMids' });
  });

  it('fails on HTTP errors, a missing key and insane values', async () => {
    await expect(fetchHypeUsd({ fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }) })).rejects.toThrow(/502/);
    await expect(fetchHypeUsd({ fetch: ok({ BTC: '1' }) })).rejects.toThrow(/missing/);
    await expect(fetchHypeUsd({ fetch: ok({ HYPE: '0' }) })).rejects.toThrow(RangeError);
    await expect(fetchHypeUsd({ fetch: ok({ HYPE: 'lots' }) })).rejects.toThrow(RangeError);
  });
});
