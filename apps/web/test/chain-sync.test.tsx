import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChainData, useChainSync } from '../src/solana/chain';
import { DEV_FAKE_PROGRAM_ID } from '../src/solana/devFakeLoader';
import { useUi } from '../src/store';

const ui0 = useUi.getState();
const chain0 = useChainData.getState();
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  act(() => {
    useUi.setState(ui0, true);
    useChainData.setState(chain0, true);
  });
});

function Sync() {
  useChainSync();
  return null;
}
const walletOf = (publicKey: PublicKey) => ({ publicKey, connected: true, wallets: [] }) as unknown as WalletContextState;
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const flush = () => act(async () => new Promise((r) => setTimeout(r, 20)));

describe('useChainSync', () => {
  it("a slow refresh for wallet A that resolves after switching to wallet B does not change B's state", async () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    let releaseA: () => void = () => {};
    const slowA = new Promise<void>((r) => (releaseA = r));
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/api/pending?wallet=${a.toBase58()}`)) return slowA.then(() => json({ pending: [{ key: 'SessionOfA', arenaId: 1, payout: 1 }] }));
      if (url.includes('/api/pending')) return json({ pending: [{ key: 'SessionOfB', arenaId: 2, payout: 2 }] });
      return json({});
    }) as typeof fetch;
    act(() =>
      useUi.setState({
        chain: {
          enabled: true,
          cluster: 'devnet',
          programId: DEV_FAKE_PROGRAM_ID,
          rpcUrl: null,
          arenasEnabled: true,
          tokenReady: true,
          token: { mint: 'DevFakeMint', symbol: '$SLANA', decimals: 6 },
          feeBps: 500,
        },
      }),
    );

    const view = render(
      <WalletContext.Provider value={walletOf(a)}>
        <Sync />
      </WalletContext.Provider>,
    );
    await flush();
    view.rerender(
      <WalletContext.Provider value={walletOf(b)}>
        <Sync />
      </WalletContext.Provider>,
    );
    await flush();
    expect(useChainData.getState().pending.map((p) => p.key)).toEqual(['SessionOfB']);

    // A's reads finally land
    releaseA();
    await flush();
    expect(useChainData.getState().pending.map((p) => p.key)).toEqual(['SessionOfB']);
    view.unmount();
  });
});
