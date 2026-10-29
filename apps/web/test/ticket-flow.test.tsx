import type { ArenaInfo, ContractCall, SessionInfo } from '@elymum/sdk';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { useUi } from '../src/store';
import { useChainData } from '../src/wallet/chain';
import { fakeConfig } from '../src/wallet/devFake';
import { resetWallets, useWallet } from '../src/wallet/store';
import { TicketFlow } from '../src/wallet/TicketFlow';
import type { TicketModel } from '../src/wallet/ticket';
import { ALICE, ONE, chainStatus, detail, fakeProvider } from './evm-helpers';

const ARENA = '0x00000000000000000000000000000000000a4e4a';
const TOKEN = '0x0000000000000000000000000000000000007e57';
const HASH = `0x${'ab'.repeat(32)}` as const;

const approveCall = { address: TOKEN, abi: [], functionName: 'approve', args: [ARENA, 1000n * ONE] } as unknown as ContractCall;
const joinCall = { address: ARENA, abi: [], functionName: 'join', args: [1] } as unknown as ContractCall;

const spies = vi.hoisted(() => ({
  planJoin: vi.fn(),
  getArenaConfig: vi.fn(),
  getSession: vi.fn(),
  sendWalletCall: vi.fn(),
}));
// the money path's network edges: the fresh chain reads and the wallet send
vi.mock('@elymum/sdk', async (orig) => ({
  ...(await orig<typeof import('@elymum/sdk')>()),
  planJoin: spies.planJoin,
  getArenaConfig: spies.getArenaConfig,
  getSession: spies.getSession,
}));
vi.mock('../src/wallet/chain', async (orig) => ({ ...(await orig<typeof import('../src/wallet/chain')>()), useReadClient: () => ({}) }));
vi.mock('../src/wallet/tx', async (orig) => ({ ...(await orig<typeof import('../src/wallet/tx')>()), sendWalletCall: spies.sendWalletCall }));

const CHAIN = chainStatus();
const PENNY: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * ONE, humans: 3, bots: 10, loot: 0, open: true };
const arena = (id: number, entryFee: bigint): ArenaInfo => ({
  id,
  entryFee,
  vault: 0n,
  owed: 0n,
  maxSessions: 300,
  openSessions: 0,
  enabled: true,
  exists: true,
  totalDeposited: 0n,
  totalPaidOut: 0n,
  totalBurned: 0n,
  lastSweepId: 0n,
});
const session = (o: Partial<SessionInfo> = {}): SessionInfo => ({ arenaId: 1, player: ALICE, id: 9n, entryFee: 1000n * ONE, openedAt: 1, feeBps: 500, finalized: false, owed: 0n, ...o });
const ui0 = useUi.getState();
const chain0 = useChainData.getState();
const config = () => ({ ...fakeConfig(CHAIN), address: ARENA as `0x${string}`, token: TOKEN as `0x${string}` });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeEach(() => {
  spies.planJoin.mockReset();
  spies.planJoin.mockImplementation(async () => ({ entryFee: 1000n * ONE, allowance: 0n, balance: 12_450n * ONE, approve: approveCall, join: joinCall, calls: [approveCall, joinCall] }));
  spies.getArenaConfig.mockReset();
  spies.getArenaConfig.mockImplementation(async () => config());
  spies.getSession.mockReset();
  spies.getSession.mockImplementation(async (_c: unknown, _a: unknown, id: number) => useChainData.getState().sessions[id] ?? session({ id: 0n }));
  spies.sendWalletCall.mockReset();
  spies.sendWalletCall.mockImplementation(async (_call: unknown, opts: { onPhase?: (p: string, h?: string) => void }) => {
    opts.onPhase?.('signing');
    opts.onPhase?.('confirming', HASH);
    return { ok: true, hash: HASH, receipt: { status: 'success', logs: [] } };
  });
  resetWallets();
  useWallet.setState({ status: 'connected', address: ALICE, chainId: 99801, current: detail(fakeProvider({ chainId: 99801, known: [99801] })) });
  useUi.setState({ settings: { ...ui0.settings, name: 'Daphne', skin: 4 }, chain: CHAIN });
  useChainData.setState({
    config: config(),
    sessions: {},
    tokenBalance: 12_450n * ONE,
    balance: 42n * 10n ** 16n,
    allowance: 0n,
    profile: null,
    pending: [],
    fake: false,
    arenas: [arena(1, 1000n * ONE), arena(3, 50_000n * ONE)],
  });
});
afterEach(() => {
  act(() => {
    useUi.setState(ui0, true);
    useChainData.setState(chain0, true);
    resetWallets();
  });
});

const open = (ticket: TicketModel, mode: 'buy' | 'refund' | 'collect' = 'buy') =>
  render(
    <Kb>
      <TicketFlow open mode={mode} ticket={ticket} onClose={() => {}} />
    </Kb>,
  );

describe('ticket confirm sheet', () => {
  it('shows the exact amount, the fee policy, the network fee and both calls before signing', () => {
    open(PENNY);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('1,000 $ELYMUM').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('5% · on profit only · fixed for this ticket')).toBeTruthy();
    expect(within(dialog).getByText(/paid in HYPE on Elysium Testnet · you have 0.42 HYPE/)).toBeTruthy();
    expect(within(dialog).getByText('12,450 → 11,450 $ELYMUM')).toBeTruthy();
    const steps = within(within(dialog).getByRole('region', { name: 'Your wallet signs' })).getAllByRole('listitem');
    // no allowance yet: an exact approval first, then the ticket
    expect(steps.map((s) => s.textContent)).toEqual(['1Allow the arena to take exactly 1,000 $ELYMUM', '2Buy the ticket · Asphodel Meadow']);
    expect((within(dialog).getByRole('button', { name: /Pay 1,000 \$ELYMUM/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('one call only when the allowance already covers the entry fee', () => {
    useChainData.setState({ allowance: 5000n * ONE });
    open(PENNY);
    const steps = within(screen.getByRole('region', { name: 'Your wallet signs' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['1Buy the ticket · Asphodel Meadow']);
  });

  it('cannot sign without a wallet', () => {
    act(() => resetWallets());
    open(PENNY);
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never offers to sign a price the arena does not confirm', () => {
    useChainData.setState({ arenas: [arena(1, 1200n * ONE)] });
    open(PENNY);
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cannot sign while the game token is not set on chain', () => {
    useUi.setState({ chain: { ...CHAIN, tokenReady: false, token: null, arenasEnabled: false } });
    useChainData.setState({ config: { ...config(), token: null } });
    const view = open(PENNY);
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    useChainData.setState({ config: config() });
    open({ ...PENNY, soon: true, open: false });
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns when the wallet has no HYPE for gas', () => {
    useChainData.setState({ balance: 0n });
    open(PENNY);
    expect(screen.getByText(/You have no HYPE on Elysium Testnet/)).toBeTruthy();
  });

  it('the collect sheet shows the payout and one refund call', () => {
    useChainData.setState({ sessions: { 1: session({ finalized: true, owed: 2150n * ONE }) } });
    open(PENNY, 'collect');
    expect(screen.getAllByText('2,150 $ELYMUM').length).toBeGreaterThan(0);
    const steps = within(screen.getByRole('region', { name: 'Your wallet signs' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([expect.stringContaining('Collect your payout')]);
    expect(screen.getByRole('button', { name: /Collect · 2,150 \$ELYMUM/ })).toBeTruthy();
  });
});

describe('ticket flow: two prompts, progress and races', () => {
  it('approve then join, each through the wallet, with "Step n of 2" progress', async () => {
    let release: () => void = () => {};
    spies.sendWalletCall.mockImplementationOnce(async (_c: unknown, opts: { onPhase?: (p: string) => void }) => {
      opts.onPhase?.('signing');
      await new Promise<void>((r) => (release = r));
      return { ok: true, hash: HASH, receipt: { status: 'success', logs: [] } };
    });
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(screen.getByTestId('tf-step').textContent).toBe('Step 1 of 2 · Allow the arena to take exactly 1,000 $ELYMUM');
    expect(screen.getByText('Approve the amount in your wallet')).toBeTruthy();
    await act(async () => release());
    await settle();
    expect(spies.sendWalletCall).toHaveBeenCalledTimes(2);
    expect(spies.sendWalletCall.mock.calls[0][0]).toBe(approveCall);
    expect(spies.sendWalletCall.mock.calls[1][0]).toBe(joinCall);
    // the server's chain rides along: the wallet is switched to it before each prompt
    expect(spies.sendWalletCall.mock.calls[0][1]).toMatchObject({ chain: CHAIN });
  });

  it('a double click (or two Enters) plans and sends once', async () => {
    useChainData.setState({ allowance: 5000n * ONE });
    spies.planJoin.mockImplementation(async () => ({ entryFee: 1000n * ONE, allowance: 5000n * ONE, balance: 12_450n * ONE, approve: null, join: joinCall, calls: [joinCall] }));
    open(PENNY);
    const pay = screen.getByRole('button', { name: /Pay 1,000 \$ELYMUM/ });
    act(() => {
      pay.click();
      pay.click();
      pay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      pay.click();
    });
    await settle();
    expect(spies.planJoin).toHaveBeenCalledTimes(1);
    expect(spies.sendWalletCall).toHaveBeenCalledTimes(1);
    expect(spies.planJoin.mock.calls[0][1]).toEqual({ arena: ARENA, arenaId: 1, player: ALICE, token: TOKEN });
  });

  it('a failed approval stops before the join, and the retry re-plans', async () => {
    spies.sendWalletCall.mockImplementationOnce(async () => ({ ok: false, hash: null, error: { kind: 'rejected', name: 'UserRejectedRequestError', args: [], code: 4001, message: 'declined' } }));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.sendWalletCall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toMatch(/You cancelled in your wallet/);
    act(() => screen.getByRole('button', { name: 'Try again' }).click());
    await settle();
    expect(spies.planJoin).toHaveBeenCalledTimes(2);
  });

  it('re-reads the config right before the wallet and refuses a changed fee rate', async () => {
    spies.getArenaConfig.mockImplementation(async () => ({ ...config(), feeBps: 1_000 }));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/The fee changed a moment ago/);
  });

  it('re-reads the arena and refuses a changed price, a full room or a short balance', async () => {
    spies.planJoin.mockImplementationOnce(async () => ({ entryFee: 1500n * ONE, allowance: 0n, balance: 0n, approve: approveCall, join: joinCall, calls: [] }));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/changed a moment ago/);
    spies.planJoin.mockImplementationOnce(async () => {
      throw new RangeError('arena #1 is full');
    });
    act(() => screen.getByRole('button', { name: 'Try again' }).click());
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/The room is full/);
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
  });

  it('never sells a ticket for an arena the server keeps closed', async () => {
    open(PENNY);
    act(() => useUi.setState({ blockedArenas: [1] }));
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/This room is under maintenance right now/)).toBeTruthy();
    act(() => screen.getByRole('button', { name: /^Pay / }).click());
    await settle();
    expect(spies.planJoin).not.toHaveBeenCalled();
  });

  it('collect is guarded and re-checks the session on chain', async () => {
    useChainData.setState({ sessions: { 1: session({ finalized: true, owed: 2150n * ONE }) } });
    open(PENNY, 'collect');
    const btn = screen.getByRole('button', { name: /Collect · 2,150/ });
    act(() => {
      btn.click();
      btn.click();
    });
    await settle();
    expect(spies.getSession).toHaveBeenCalledTimes(1);
    expect(spies.sendWalletCall).toHaveBeenCalledTimes(1);
    expect(spies.sendWalletCall.mock.calls[0][0]).toMatchObject({ address: ARENA, functionName: 'refund', args: [1] });
  });

  it('collect refuses when the on-chain session changed since the sheet opened', async () => {
    useChainData.setState({ sessions: { 1: session({ finalized: true, owed: 2150n * ONE }) } });
    spies.getSession.mockImplementation(async () => session({ finalized: true, owed: 1n }));
    open(PENNY, 'collect');
    act(() => screen.getByRole('button', { name: /Collect · 2,150/ }).click());
    await settle();
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/This ticket changed a moment ago/);
  });

  it('a refund before 24 h is refused before the wallet opens', async () => {
    const fresh = session({ openedAt: Math.floor(Date.now() / 1000) - 60 });
    useChainData.setState({ sessions: { 1: fresh } });
    open(PENNY, 'refund');
    act(() => screen.getByRole('button', { name: /Refund · 1,000/ }).click());
    await settle();
    expect(spies.sendWalletCall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Refunds open 24 hours/);
  });

  it('focus never starts on the pay button', async () => {
    open(PENNY);
    await settle();
    const pay = screen.getByRole('button', { name: /^Pay / });
    expect(document.activeElement).not.toBe(pay);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('offers "Resume" instead of paying again when the ticket turns out to be open', () => {
    useChainData.setState({ sessions: { 1: session() } });
    open(PENNY);
    expect(screen.getByRole('button', { name: /Resume/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
  });
});
