import { describe, expect, it } from 'vitest';
import { PriceKeeper } from '../src/chain/price-keeper';
import { FakeEvm, NFT, SERVER } from './fake-evm';

const WEI = 10n ** 18n;

function keeper(evm: FakeEvm | null, price: string | Error = '40', opts: { usdCents?: number; nft?: string | null } = {}) {
  const logs: string[] = [];
  const k = new PriceKeeper({
    client: () => evm,
    nft: () => (opts.nft === undefined ? NFT : opts.nft),
    usdCents: opts.usdCents ?? 100,
    fetchPrice: async () => {
      if (price instanceof Error) throw price;
      return { price, value: Number(price) };
    },
    log: (m) => logs.push(m),
    receiptTimeoutMs: 10,
  });
  return { k, logs };
}

function keptEvm(): FakeEvm {
  const evm = new FakeEvm();
  evm.mint.keeper = SERVER;
  evm.mint.minPrice = WEI / 1000n; // 0.001 HYPE
  evm.mint.maxPrice = WEI / 10n; // 0.1 HYPE
  evm.mint.price = 25n * 10n ** 15n; // $1 at $40
  return evm;
}

describe('price keeper ($1 in HYPE)', () => {
  it('does nothing without a chain or an NFT', async () => {
    expect(await keeper(null).k.tick()).toBe('off');
    expect(await keeper(new FakeEvm(), '40', { nft: null }).k.tick()).toBe('off');
  });

  it('stays idle unless the server key is the price keeper and the bounds are set', async () => {
    const evm = new FakeEvm();
    const { k, logs } = keeper(evm);
    expect(await k.tick()).toBe('not-keeper');
    expect(logs.join()).toMatch(/not the NFT price keeper/);
    evm.mint.keeper = SERVER;
    expect(await k.tick()).toBe('no-bounds');
    expect(evm.sent).toHaveLength(0);
  });

  it('leaves a price within 2 % alone', async () => {
    const evm = keptEvm();
    expect(await keeper(evm, '40.5').k.tick()).toBe('in-range'); // 1.2 % off
    expect(evm.sent).toHaveLength(0);
  });

  it('re-prices when off by more than 2 %, and logs it', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, '50'); // $1 = 0.02 HYPE now (20 % lower)
    expect(await k.tick()).toBe('repriced');
    expect(evm.sent.map((c) => [c.functionName, c.args[0]])).toEqual([['setPrice', 2n * 10n ** 16n]]);
    expect(evm.mint.price).toBe(2n * 10n ** 16n);
    expect(logs.join()).toMatch(/price keeper: HYPE \$50 → price 0.025 HYPE → 0.02 HYPE/);
    expect(k.last).toBe('repriced');
  });

  it('clamps the new price into the owner bounds', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, '5'); // $1 = 0.2 HYPE, above the 0.1 max
    expect(await k.tick()).toBe('repriced');
    expect(evm.mint.price).toBe(WEI / 10n);
    expect(logs.join()).toMatch(/clamped to the bounds/);
    // already at the bound: nothing more to do
    expect(await k.tick()).toBe('in-range');
    expect(evm.sent).toHaveLength(1);
  });

  it('a feed outage or a failing send is logged, never thrown', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, new Error('HTTP 502'));
    expect(await k.tick()).toBe('no-price');
    expect(logs.join()).toMatch(/HYPE\/USD unavailable/);
    const bad = keptEvm();
    bad.failures.push(new TypeError('fetch failed'));
    const r = keeper(bad, '80');
    expect(await r.k.tick()).toBe('failed');
    expect(r.logs.join()).toMatch(/setPrice failed/);
  });
});
