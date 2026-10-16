import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { useChainData } from '../src/solana/chain';
import { fakeConfig } from '../src/solana/devFake';
import { TicketFlow } from '../src/solana/TicketFlow';
import type { TicketModel } from '../src/solana/ticket';
import { useUi } from '../src/store';

const spies = vi.hoisted(() => ({
  buildTicketTx: vi.fn(async () => ({ steps: ['join'], ixs: [] })),
  buildCloseTx: vi.fn(async () => ({ steps: ['ata', 'collect'], ixs: [] })),
  fetchSession: vi.fn(),
  sendTx: vi.fn(async () => ({ ok: true as const, signature: 'sig' })),
  fetchArena: vi.fn(),
  fetchConfig: vi.fn(),
  client: null as unknown,
}));
spies.client = {
  ix: {},
  programId: null,
  fetchArena: (id: number) => spies.fetchArena(id),
  fetchConfig: () => spies.fetchConfig(),
  fetchSession: (id: number, owner: string) => spies.fetchSession(id, owner),
  rentExemptMinimum: async (b: number) => (b + 128) * 6960,
};
// the money path's network edges: the arena re-read, the build and the wallet send
vi.mock('../src/solana/chain', async (orig) => ({
  ...(await orig<typeof import('../src/solana/chain')>()),
  useSlanaClient: () => spies.client,
}));
vi.mock('../src/solana/ticket', async (orig) => ({ ...(await orig<typeof import('../src/solana/ticket')>()), buildTicketTx: spies.buildTicketTx, buildCloseTx: spies.buildCloseTx }));
vi.mock('../src/solana/tx', async (orig) => ({ ...(await orig<typeof import('../src/solana/tx')>()), sendTx: spies.sendTx }));

const M = 1_000_000n;
const CHAIN = {
  enabled: true,
  cluster: 'devnet',
  programId: null,
  rpcUrl: null,
  arenasEnabled: true,
  tokenReady: true,
  token: { mint: 'M', symbol: '$SLANA', decimals: 6 },
  feeBps: 500,
};
const PENNY: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, humans: 3, bots: 10, loot: 0, open: true };
const arena = (id: number, entryFee: bigint) => ({
  id,
  address: `A${id}`,
  entryFee,
  maxSessions: 300,
  openSessions: 0,
  enabled: true,
  vault: `V${id}`,
  pot: 0n,
});
/** A finalized session (R24) of arena 1 with `owed` to collect. */
const finalized = (owed: bigint) => ({
  address: 'S1',
  id: 9,
  player: 'P',
  arena: 'A1',
  arenaId: 1,
  entryFee: 1000n * M,
  openedAt: 1,
  settleFee: 20_000,
  feeBps: 500,
  finalized: true,
  owed,
});
const ui0 = useUi.getState();
const chain0 = useChainData.getState();

beforeEach(() => {
  walletOn = true;
  spies.buildTicketTx.mockClear();
  spies.buildCloseTx.mockClear();
  spies.fetchSession.mockReset();
  spies.fetchSession.mockImplementation(async (id: number) => useChainData.getState().sessions[id] ?? null);
  spies.sendTx.mockClear();
  spies.fetchArena.mockReset();
  spies.fetchArena.mockImplementation(async (id: number) => (id === 1 ? arena(1, 1000n * M) : arena(3, 50_000n * M)));
  spies.fetchConfig.mockReset();
  spies.fetchConfig.mockImplementation(async () => useChainData.getState().config);
  useUi.setState({ settings: { ...ui0.settings, name: 'Daphne', skin: 4 }, chain: CHAIN });
  useChainData.setState({
    config: { ...fakeConfig(CHAIN), settleFeeLamports: 50_000 },
    sessions: {},
    tokenBalance: 12_450n * M,
    balance: 420_000_000,
    ataExists: true,
    profile: null,
    pending: [],
    arenas: [arena(1, 1000n * M), arena(3, 50_000n * M)],
  });
});
afterEach(() => {
  act(() => {
    useUi.setState(ui0, true);
    useChainData.setState(chain0, true);
  });
});

let walletOn = true;
const wallet = () => ({ publicKey: walletOn ? Keypair.generate().publicKey : null, connected: walletOn, wallets: [] }) as unknown as WalletContextState;
const open = (ticket: TicketModel, mode: 'buy' | 'refund' | 'collect' = 'buy') =>
  render(
    <WalletContext.Provider value={wallet()}>
      <Kb>
        <TicketFlow open mode={mode} ticket={ticket} onClose={() => {}} />
      </Kb>
    </WalletContext.Provider>,
  );

describe('ticket confirm sheet', () => {
  it('shows the exact amount, the fee policy, the deposit and every instruction before signing', () => {
    open(PENNY);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('1,000 $SLANA').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('5% · on profit only · fixed for this ticket')).toBeTruthy();
    expect(within(dialog).getByText('0.00005 SOL')).toBeTruthy();
    expect(within(dialog).getByText('12,450 → 11,450 $SLANA')).toBeTruthy();
    const steps = within(within(dialog).getByRole('region', { name: 'This transaction' })).getAllByRole('listitem');
    // no profile yet: it is created in the same transaction
    expect(steps.map((s) => s.textContent)).toEqual(['1Create your on-chain profile · Daphne', '2Buy the ticket · Penny Pond']);
    expect((within(dialog).getByRole('button', { name: /Pay 1,000 \$SLANA/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cannot sign without a wallet', () => {
    walletOn = false;
    open(PENNY);
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never offers to sign a price the arena account does not confirm', () => {
    useChainData.setState({ arenas: [arena(1, 1200n * M)] });
    open(PENNY);
    // the sheet shows the ticket's price, but the chain disagrees: no signing
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's fee rate and signs it as the bound (fee to the operator's wallet, on profit only)", async () => {
    useUi.setState({ chain: { ...CHAIN, feeBps: 450 } });
    useChainData.setState({ config: { ...useChainData.getState().config!, feeBps: 450 } });
    open(PENNY);
    expect(screen.getByText('4.5% · on profit only · fixed for this ticket')).toBeTruthy();
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(spies.buildTicketTx.mock.calls[0]).toEqual([expect.anything(), expect.objectContaining({ maxFeeBps: 450 })]);
  });

  it('cannot sign while the game token is not set on chain', () => {
    useUi.setState({ chain: { ...CHAIN, tokenReady: false, token: null, arenasEnabled: false } });
    useChainData.setState({ config: fakeConfig({ ...CHAIN, tokenReady: false, token: null }) });
    const view = open(PENNY);
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    // and an "Opening soon" ticket never can
    useChainData.setState({ config: fakeConfig(CHAIN) });
    open({ ...PENNY, soon: true, open: false });
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('R24: the collect sheet shows the payout, the SOL it moves, and signs the account creation + collect', () => {
    useChainData.setState({ ataExists: false, sessions: { 1: finalized(2150n * M) } });
    open(PENNY, 'collect');
    expect(screen.getAllByText('2,150 $SLANA').length).toBeGreaterThan(0);
    const steps = within(screen.getByRole('region', { name: 'This transaction' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([expect.stringContaining('Open your token account if it is missing'), expect.stringContaining('Collect your payout')]);
    expect(screen.getByText(/network fee and token account rent if needed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Collect · 2,150 \$SLANA/ })).toBeTruthy();
  });

  it('discloses the SOL the transaction moves and what comes back', () => {
    open(PENNY);
    expect(screen.getByText('SOL in this transaction')).toBeTruthy();
    expect(screen.getByText(/≈ [\d.]+ SOL \([\d.]+ comes back\)/)).toBeTruthy();
  });
});

describe('ticket flow races', () => {
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

  it('a double click (or two Enters) builds and sends exactly one transaction', async () => {
    open(PENNY);
    const pay = screen.getByRole('button', { name: /Pay 1,000 \$SLANA/ });
    act(() => {
      pay.click();
      pay.click();
      pay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      pay.click();
    });
    await settle();
    expect(spies.fetchArena).toHaveBeenCalledTimes(1);
    expect(spies.buildTicketTx).toHaveBeenCalledTimes(1);
    expect(spies.sendTx).toHaveBeenCalledTimes(1);
    // the join carries the fee shown on the frozen review as its on-chain bound
    expect(spies.buildTicketTx.mock.calls[0]).toEqual([expect.anything(), expect.objectContaining({ maxFeeBps: 500, maxEntryFee: 1000n * M, maxSettleFee: 50_000 })]);
  });

  it('R24: collect is guarded and re-checks the session on chain', async () => {
    useChainData.setState({ sessions: { 1: finalized(2150n * M) } });
    open(PENNY, 'collect');
    const btn = screen.getByRole('button', { name: /Collect · 2,150/ });
    act(() => {
      btn.click();
      btn.click();
    });
    await settle();
    expect(spies.fetchSession).toHaveBeenCalledTimes(1);
    expect(spies.buildCloseTx).toHaveBeenCalledTimes(1);
    expect(spies.buildCloseTx.mock.calls[0]).toEqual([expect.anything(), expect.objectContaining({ arenaId: 1, finalized: true })]);
    expect(spies.sendTx).toHaveBeenCalledTimes(1);
  });

  it('R24: collect refuses when the on-chain session changed since the sheet opened', async () => {
    useChainData.setState({ sessions: { 1: finalized(2150n * M) } });
    spies.fetchSession.mockImplementation(async () => ({ ...finalized(1n), id: 9 }));
    open(PENNY, 'collect');
    act(() => screen.getByRole('button', { name: /Collect · 2,150/ }).click());
    await settle();
    expect(spies.buildCloseTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/This ticket changed a moment ago/);
  });

  it('focus never starts on the pay button', async () => {
    open(PENNY);
    await settle();
    const pay = screen.getByRole('button', { name: /^Pay / });
    expect(document.activeElement).not.toBe(pay);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('re-reads the config right before building and refuses a changed fee rate (it is fixed into the ticket)', async () => {
    spies.fetchConfig.mockImplementation(async () => ({ ...useChainData.getState().config!, feeBps: 1_000 }));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.fetchConfig).toHaveBeenCalledTimes(1);
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/The fee or the deposit changed a moment ago/);
  });

  it('R20: never builds a ticket for an arena the server keeps closed', async () => {
    open(PENNY);
    const pay = screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement;
    expect(pay.disabled).toBe(false);
    // the server reports the arena blocked while the sheet is open
    act(() => useUi.setState({ blockedArenas: [1] }));
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/This room is under maintenance right now/)).toBeTruthy();
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
  });

  it('R20: the fresh re-check refuses an arena blocked while the chain was being read', async () => {
    spies.fetchArena.mockImplementation(async () => {
      useUi.setState({ blockedArenas: [1] });
      return arena(1, 1000n * M);
    });
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/under maintenance/);
  });

  it('re-reads the arena right before building and refuses a changed price', async () => {
    spies.fetchArena.mockImplementation(async () => arena(1, 1500n * M));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/changed a moment ago/);
  });

  it('offers "Resume" instead of paying again when the ticket turns out to be open', () => {
    useChainData.setState({
      sessions: {
        1: { address: 'S', id: 1, player: 'P', arena: 'A1', arenaId: 1, entryFee: 1000n * M, openedAt: 1, settleFee: 20_000, feeBps: 500, finalized: false, owed: 0n },
      },
    });
    open(PENNY);
    expect(screen.getByRole('button', { name: /Resume/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
  });
});
