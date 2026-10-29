import { describe, expect, it } from 'vitest';
import { PriceKeeper, stepLimited } from '../src/chain/price-keeper';
import { FakeEvm, NFT, SERVER } from './fake-evm';

const WEI = 10n ** 18n;

function keeper(evm: FakeEvm | null, price: string | Error | (() => string | Error) = '40', opts: { usdCents?: number; nft?: string | null } = {}) {
  const logs: string[] = [];
  const k = new PriceKeeper({
    client: () => evm,
    nft: () => (opts.nft === undefined ? NFT : opts.nft),
    usdCents: opts.usdCents ?? 100,
    fetchPrice: async () => {
      const p = typeof price === 'function' ? price() : price;
      if (p instanceof Error) throw p;
      return { price: p, value: Number(p) };
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

  it('re-prices when off by more than 2 % on two consecutive readings, and logs it', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, '50'); // $1 = 0.02 HYPE now (20 % lower)
    // a single reading never moves the price
    expect(await k.tick()).toBe('unconfirmed');
    expect(evm.sent).toHaveLength(0);
    expect(await k.tick()).toBe('repriced');
    expect(evm.sent.map((c) => [c.functionName, c.args[0]])).toEqual([['setPrice', 2n * 10n ** 16n]]);
    expect(evm.mint.price).toBe(2n * 10n ** 16n);
    expect(logs.join()).toMatch(/price keeper: HYPE \$50 → price 0.025 HYPE → 0.02 HYPE/);
    expect(k.last).toBe('repriced');
  });

  it('moves at most 20 % per update and clamps the new price into the owner bounds', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, '5'); // $1 = 0.2 HYPE, above the 0.1 max
    expect(await k.tick()).toBe('unconfirmed');
    expect(await k.tick()).toBe('repriced');
    expect(evm.mint.price).toBe(3n * 10n ** 16n); // 0.025 × 1.2
    expect(logs.join()).toMatch(/limited to a 20 % step/);
    const prices: bigint[] = [];
    for (let i = 0; i < 20 && (await k.tick()) === 'repriced'; i++) prices.push(evm.mint.price);
    for (let i = 1; i < prices.length; i++) expect(prices[i] * 10_000n <= prices[i - 1] * 12_000n).toBe(true);
    expect(evm.mint.price).toBe(WEI / 10n);
    expect(logs.join()).toMatch(/clamped to the bounds/);
    // already at the bound: nothing more to do
    const sent = evm.sent.length;
    expect(await k.tick()).toBe('in-range');
    expect(evm.sent).toHaveLength(sent);
  });

  it('a feed outlier is ignored: readings that disagree by more than 3 % never move the price', async () => {
    const evm = keptEvm();
    const seq = ['400', '40', '4', '40.5', '4.1', '40.2'];
    let i = 0;
    const { k } = keeper(evm, () => seq[i++]);
    const out: string[] = [];
    for (let n = 0; n < seq.length; n++) out.push(await k.tick());
    // 400 alone, 4 alone, 4.1 after 40.5: never two agreeing off-target readings in a row
    expect(out).toEqual(['unconfirmed', 'in-range', 'unconfirmed', 'in-range', 'unconfirmed', 'in-range']);
    expect(evm.sent).toHaveLength(0);
    // a failed reading breaks the pair
    const seq2: (string | Error)[] = ['50', new Error('HTTP 502'), '50', '50'];
    let j = 0;
    const r = keeper(keptEvm(), () => seq2[j++]);
    expect([await r.k.tick(), await r.k.tick(), await r.k.tick(), await r.k.tick()]).toEqual(['unconfirmed', 'no-price', 'unconfirmed', 'repriced']);
  });

  it('stepLimited keeps a target within ±20 % of the current price', () => {
    expect(stepLimited(100n, 50n)).toBe(80n);
    expect(stepLimited(100n, 500n)).toBe(120n);
    expect(stepLimited(100n, 110n)).toBe(110n);
    expect(stepLimited(0n, 7n)).toBe(7n);
  });

  it('a feed outage or a failing send is logged, never thrown', async () => {
    const evm = keptEvm();
    const { k, logs } = keeper(evm, new Error('HTTP 502'));
    expect(await k.tick()).toBe('no-price');
    expect(logs.join()).toMatch(/HYPE\/USD unavailable/);
    const bad = keptEvm();
    bad.failures.push(new TypeError('fetch failed'));
    const r = keeper(bad, '80');
    expect(await r.k.tick()).toBe('unconfirmed');
    expect(await r.k.tick()).toBe('failed');
    expect(r.logs.join()).toMatch(/setPrice failed/);
  });
});
