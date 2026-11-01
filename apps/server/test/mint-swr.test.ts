import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIRST_READ_WAIT_MS, HOLDERS_INDEX_TTL_MS, HOLDERS_RETRY_MS, MintService } from '../src/site/mint';
import { SiteStore } from '../src/site/store';
import { FakeEvm, NFT } from './fake-evm';
import { testSigner } from './signers';

function service(evm: FakeEvm, clock: { now: number }, stateDir: string | null = null) {
  const logs: string[] = [];
  const mint = new MintService({
    store: new SiteStore(null),
    client: () => evm,
    nft: () => ({ address: NFT, txHash: null }),
    chainId: () => 31337,
    stateDir,
    usdCents: 100,
    fetchPrice: async () => ({ price: '40.0', value: 40 }),
    logChunkBlocks: 100,
    log: (m) => logs.push(m),
    now: () => clock.now,
  });
  return { mint, logs };
}

const timed = async <T>(p: Promise<T>) => {
  const t0 = Date.now();
  const value = await p;
  return { value, ms: Date.now() - t0 };
};

describe('mint page state while the RPC is rate-limited (stale-while-revalidate)', () => {
  it('answers from the cache at once when the RPC hangs or answers 429, and refreshes in the background', async () => {
    const evm = new FakeEvm();
    evm.mintNft(testSigner().address, 3);
    const clock = { now: 1_800_000_000_000 };
    const { mint, logs } = service(evm, clock);
    expect((await mint.publicState('public')).contract?.totalSupply).toBe(3);
    // the RPC hangs now: a stale state is still answered immediately
    const realMintState = evm.mintState.bind(evm);
    evm.mintState = () => new Promise(() => {});
    clock.now += 60_000;
    const a = await timed(mint.publicState('public'));
    expect(a.ms).toBeLessThan(200);
    expect(a.value.contract?.totalSupply).toBe(3);
    // and when it answers 429, the last good state is served (logged), never null
    evm.mintState = realMintState;
    evm.limited.set('mintState', Infinity);
    (mint as unknown as { stateFetch: unknown }).stateFetch = null;
    clock.now += 60_000;
    expect((await mint.publicState('public')).contract?.totalSupply).toBe(3);
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.join('\n')).toMatch(/mintState of .* failed .* serving the last good state/);
    // the RPC is back: the background refresh picks the new supply up
    evm.limited.delete('mintState');
    evm.mintNft(testSigner().address, 2);
    clock.now += 60_000;
    await mint.publicState('public');
    await new Promise((r) => setTimeout(r, 10));
    expect((await mint.publicState('public')).contract?.totalSupply).toBe(5);
  });

  it('after a restart the persisted state and holder index answer at once, even with the RPC refusing everything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-mint-swr-'));
    const evm = new FakeEvm();
    evm.mintNft(testSigner().address, 2);
    evm.mintNft(testSigner().address, 1);
    const clock = { now: 1_800_000_000_000 };
    const first = service(evm, clock, dir);
    const s1 = await first.mint.publicState('public');
    expect(s1).toMatchObject({ holders: 2, contract: { totalSupply: 3 } });
    first.mint.flush();
    evm.limited.set('mintState', Infinity).set('transferLogs', Infinity);
    const again = service(evm, clock, dir);
    const b = await timed(again.mint.publicState('public'));
    expect(b.ms).toBeLessThan(FIRST_READ_WAIT_MS);
    expect(b.value).toMatchObject({ holders: 2, contract: { totalSupply: 3 } });
  });

  it('the holder index backs off after a rate-limited scan instead of retrying on every page view', async () => {
    const evm = new FakeEvm();
    evm.mintNft(testSigner().address, 1);
    const clock = { now: 1_800_000_000_000 };
    const { mint, logs } = service(evm, clock);
    expect(await mint.holdersCount()).toBe(1);
    evm.mintNft(testSigner().address, 1);
    evm.limited.set('transferLogs', Infinity);
    clock.now += HOLDERS_INDEX_TTL_MS;
    expect(await mint.holdersCount()).toBe(1); // answered from the index, the scan runs behind
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.filter((l) => /holder index failed/.test(l))).toHaveLength(1);
    // page views during the backoff do not touch the RPC
    for (let i = 0; i < 5; i++) {
      clock.now += 1_000;
      await mint.holdersCount();
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.filter((l) => /holder index failed/.test(l))).toHaveLength(1);
    evm.limited.delete('transferLogs');
    clock.now += HOLDERS_RETRY_MS;
    await mint.holdersCount();
    await new Promise((r) => setTimeout(r, 10));
    expect(await mint.holdersCount()).toBe(2);
  });
});
