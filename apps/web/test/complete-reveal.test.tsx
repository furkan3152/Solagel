import type { PassStatus } from '@slana/shared';
import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { useChainData } from '../src/solana/chain';
import { captureFeeLamports, revealStage } from '../src/solana/pass';
import { useUi } from '../src/store';
import { CompleteReveal } from '../src/ui/pass/CompleteReveal';

const spies = vi.hoisted(() => ({
  slot: 0,
  config: null as unknown,
  sendTx: vi.fn(async () => ({ ok: true as const, signature: 'sig' })),
  capture: vi.fn(async (_signer: unknown) => ({ keys: [], programId: null, data: Buffer.alloc(8) })),
  client: null as unknown,
}));
spies.client = {
  programId: null,
  connection: { getSlot: async () => spies.slot },
  fetchConfig: async () => spies.config,
  ix: { capturePassEntropy: (signer: unknown) => spies.capture(signer) },
};
vi.mock('../src/solana/chain', async (orig) => ({
  ...(await orig<typeof import('../src/solana/chain')>()),
  useSlanaClient: () => spies.client,
  refreshChain: () => {},
}));
vi.mock('../src/solana/tx', async (orig) => ({ ...(await orig<typeof import('../src/solana/tx')>()), sendTx: spies.sendTx }));

const base: PassStatus = { collection: 'C', supply: 3333, minted: 3333, perWallet: 1, mintOpen: false, mintStartTs: 0, revealed: false, seed: null };
const waiting: PassStatus = { ...base, seedRevealed: true, entropyTargetSlot: 1_150 };

describe('revealStage (R23)', () => {
  it('sealed → waiting → completable → revealed', () => {
    expect(revealStage(null, 5)).toEqual({ kind: 'sealed' });
    expect(revealStage(base, 5_000)).toEqual({ kind: 'sealed' });
    expect(revealStage(waiting, null)).toEqual({ kind: 'waiting', targetSlot: 1_150, slotsLeft: null });
    expect(revealStage(waiting, 1_150)).toEqual({ kind: 'waiting', targetSlot: 1_150, slotsLeft: 1 });
    expect(revealStage(waiting, 1_151)).toEqual({ kind: 'completable', targetSlot: 1_150 });
    expect(revealStage({ ...waiting, revealed: true, seed: 'ab'.repeat(32) }, 1_151)).toEqual({ kind: 'revealed' });
  });

  it('discloses only the network fee', () => {
    expect(captureFeeLamports()).toBe(5_000 + 1_200);
  });
});

const ui0 = useUi.getState();
const chain0 = useChainData.getState();
let walletOn = true;
const owner = Keypair.generate().publicKey;
const wallet = () => ({ publicKey: walletOn ? owner : null, connected: walletOn, wallets: [] }) as unknown as WalletContextState;
const show = (status: PassStatus) =>
  render(
    <WalletContext.Provider value={wallet()}>
      <Kb>
        <CompleteReveal status={status} />
      </Kb>
    </WalletContext.Provider>,
  );
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeEach(() => {
  walletOn = true;
  spies.sendTx.mockClear();
  spies.capture.mockClear();
  spies.config = { passRevealed: false, passSeedRevealed: true, passEntropyTargetSlot: 1_150 };
  useChainData.setState({ fake: false });
});
afterEach(() => {
  act(() => {
    useUi.setState(ui0, true);
    useChainData.setState(chain0, true);
  });
});

describe('CompleteReveal (R23: anybody can complete the reveal)', () => {
  it('waits before the target slot, with no button', async () => {
    spies.slot = 1_100;
    show(waiting);
    await settle();
    expect(screen.getByText('Waiting for the reveal to complete')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/about 21 s left/);
    expect(screen.queryByRole('button', { name: 'Complete the reveal' })).toBeNull();
  });

  it('after the target any connected wallet sends exactly one capture, fee disclosed', async () => {
    spies.slot = 1_151;
    show(waiting);
    await settle();
    expect(screen.getByText(/costs only the network fee \(≈◎0\.0000062\)/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Complete the reveal' });
    act(() => {
      btn.click();
      btn.click();
    });
    await settle();
    expect(spies.capture).toHaveBeenCalledTimes(1);
    expect((spies.capture.mock.calls[0] as unknown[])[0]).toBe(owner.toBase58());
    expect(spies.sendTx).toHaveBeenCalledTimes(1);
  });

  it('the fresh re-check never signs when the reveal already completed', async () => {
    spies.slot = 1_151;
    spies.config = { passRevealed: true, passSeedRevealed: true, passEntropyTargetSlot: 1_150 };
    show(waiting);
    await settle();
    act(() => screen.getByRole('button', { name: 'Complete the reveal' }).click());
    await settle();
    expect(spies.capture).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
  });

  it('asks for a wallet when none is connected, and hides itself outside the waiting state', async () => {
    walletOn = false;
    spies.slot = 1_151;
    const { unmount } = show(waiting);
    await settle();
    expect(screen.getByText(/Connect a wallet to complete the reveal, or wait/)).toBeTruthy();
    unmount();
    const r = show(base);
    await settle();
    expect(r.container.textContent).toBe('');
  });
});
