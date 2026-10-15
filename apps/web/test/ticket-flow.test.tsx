import { WalletContext, type WalletContextState } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kb } from '../src/design';
import { useChainData } from '../src/solana/chain';
import { fakeConfig } from '../src/solana/devFake';
import { TicketFlow } from '../src/solana/TicketFlow';
import { PASS_POWER, type TicketModel } from '../src/solana/ticket';
import { useUi } from '../src/store';

const spies = vi.hoisted(() => ({
  buildTicketTx: vi.fn(async () => ({ steps: ['join'], ixs: [] })),
  sendTx: vi.fn(async () => ({ ok: true as const, signature: 'sig' })),
  fetchArena: vi.fn(),
  fetchConfig: vi.fn(),
  client: null as unknown,
}));
spies.client = { ix: {}, programId: null, fetchArena: (id: number) => spies.fetchArena(id), fetchConfig: () => spies.fetchConfig(), rentExemptMinimum: async (b: number) => (b + 128) * 6960 };
// the money path's network edges: the arena re-read, the build and the wallet send
vi.mock('../src/solana/chain', async (orig) => ({
  ...(await orig<typeof import('../src/solana/chain')>()),
  useSlanaClient: () => spies.client,
}));
vi.mock('../src/solana/ticket', async (orig) => ({ ...(await orig<typeof import('../src/solana/ticket')>()), buildTicketTx: spies.buildTicketTx }));
vi.mock('../src/solana/tx', async (orig) => ({ ...(await orig<typeof import('../src/solana/tx')>()), sendTx: spies.sendTx }));

const M = 1_000_000n;
const CHAIN = {
  enabled: true,
  cluster: 'devnet',
  programId: null,
  rpcUrl: null,
  arenasEnabled: true,
  currentSeason: 1,
  token: { mint: 'M', symbol: '$SLANA', decimals: 6 },
  pass: null,
};
const PENNY: TicketModel = { key: 'arena:1', arenaId: 1, entryFee: 1000n * M, requiresPass: false, humans: 3, bots: 10, loot: 0, open: true };
const GOLD: TicketModel = { key: 'arena:3', arenaId: 3, entryFee: 50_000n * M, requiresPass: true, humans: 3, bots: 10, loot: 0, open: true };
const arena = (id: number, entryFee: bigint, requiresPass: boolean) => ({
  id,
  address: `A${id}`,
  entryFee,
  requiresPass,
  maxSessions: 300,
  openSessions: 0,
  enabled: true,
  vault: `V${id}`,
  pot: 0n,
});
const ui0 = useUi.getState();
const chain0 = useChainData.getState();

beforeEach(() => {
  walletOn = true;
  spies.buildTicketTx.mockClear();
  spies.sendTx.mockClear();
  spies.fetchArena.mockReset();
  spies.fetchArena.mockImplementation(async (id: number) => (id === 1 ? arena(1, 1000n * M, false) : arena(3, 50_000n * M, true)));
  spies.fetchConfig.mockReset();
  spies.fetchConfig.mockImplementation(async () => useChainData.getState().config);
  useUi.setState({ settings: { ...ui0.settings, lang: 'tr', name: 'Defne', skin: 4 }, chain: CHAIN });
  useChainData.setState({
    config: { ...fakeConfig(CHAIN), settleFeeLamports: 50_000 },
    sessions: {},
    tokenBalance: 12_450n * M,
    balance: 420_000_000,
    ataExists: true,
    profile: null,
    passes: [],
    lockedPasses: [],
    pending: [],
    arenas: [arena(1, 1000n * M, false), arena(3, 50_000n * M, true)],
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
const open = (ticket: TicketModel, mode: 'buy' | 'refund' | 'ata' = 'buy') =>
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
    expect(within(dialog).getAllByText('1.000 $SLANA').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('%5 · yalnızca kârdan · bu bilet için sabit')).toBeTruthy();
    expect(within(dialog).getByText('0,00005 SOL')).toBeTruthy();
    expect(within(dialog).getByText('12.450 → 11.450 $SLANA')).toBeTruthy();
    const steps = within(within(dialog).getByRole('region', { name: 'Bu işlemde' })).getAllByRole('listitem');
    // no profile yet: it is created in the same transaction
    expect(steps.map((s) => s.textContent)).toEqual(['1Zincir üstü profilini oluştur · Defne', '2Bileti kes · Kuruş Gölü']);
    expect((within(dialog).getByRole('button', { name: /Bileti kes · 1\.000 \$SLANA/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cannot sign without a wallet', () => {
    walletOn = false;
    open(PENNY);
    expect((screen.getByRole('button', { name: /Bileti kes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('never offers to sign a price the arena account does not confirm', () => {
    useChainData.setState({ arenas: [arena(1, 1200n * M, false)] });
    open(PENNY);
    // the sheet shows the ticket's price, but the chain disagrees: no signing
    expect((screen.getByRole('button', { name: /Bileti kes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('R8: a Pass is opt-in in an open arena and switches the fee to the Pass rate', () => {
    useChainData.setState({ passes: [{ asset: 'A1', number: 412 }], profile: null });
    open(PENNY);
    const sw = screen.getByRole('switch', { name: /Pass’imle gir/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    act(() => sw.click());
    expect(screen.getByText('%2 · yalnızca kârdan · bu bilet için sabit')).toBeTruthy();
    expect(screen.getByText(/Bileti Pass No\. 0412 ile kes · Kuruş Gölü/)).toBeTruthy();
    // the Pass line discloses every perk, the faster cash-out included
    expect(screen.getByText(new RegExp(`^No\\. 0412 · %2 kesinti, \\+%\\d+ başlangıç, ${PASS_POWER.cashoutS} sn cash-out$`))).toBeTruthy();
  });

  it('R8: a Pass room requires a Pass; locked Passes are explained and the ticket cannot be cut', () => {
    useChainData.setState({ passes: [{ asset: 'A1', number: 7 }], lockedPasses: ['A1'], tokenBalance: 60_000n * M });
    open(GOLD);
    expect(screen.getByText('Bu oda Pass ister')).toBeTruthy();
    expect(screen.getByText(/Pass’lerin başka biletlere kilitli/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Bileti kes · 50\.000 \$SLANA/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('R10: the token-account sheet shows what is owed and signs only the account creation', () => {
    useChainData.setState({ ataExists: false, pending: [{ key: 'S', arenaId: 1, payout: 2150 * 1_000_000, needsTokenAccount: true }] });
    open(PENNY, 'ata');
    expect(screen.getByText('2.150 $SLANA')).toBeTruthy();
    const steps = within(screen.getByRole('region', { name: 'Bu işlemde' })).getAllByRole('listitem');
    expect(steps).toHaveLength(1);
    expect(steps[0].textContent).toContain('Token hesabını aç');
  });

  it('the ATA sheet only counts payouts that wait for the token account', () => {
    useChainData.setState({
      ataExists: false,
      pending: [
        { key: 'S', arenaId: 1, payout: 2150 * 1_000_000, needsTokenAccount: true },
        { key: 'T', arenaId: 2, payout: 999 * 1_000_000, needsTokenAccount: false },
      ],
    });
    open(PENNY, 'ata');
    expect(screen.getByText('2.150 $SLANA')).toBeTruthy();
  });

  it('discloses the SOL the transaction moves and what comes back', () => {
    open(PENNY);
    expect(screen.getByText('SOL bu işlemde')).toBeTruthy();
    expect(screen.getByText(/≈ [\d,]+ SOL \([\d,]+ iade edilir\)/)).toBeTruthy();
  });
});

describe('ticket flow races', () => {
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

  it('a double click (or two Enters) builds and sends exactly one transaction', async () => {
    open(PENNY);
    const pay = screen.getByRole('button', { name: /Bileti kes · 1\.000 \$SLANA/ });
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
  });

  it('focus never starts on the pay button', async () => {
    open(PENNY);
    await settle();
    const pay = screen.getByRole('button', { name: /Bileti kes/ });
    expect(document.activeElement).not.toBe(pay);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('re-reads the config right before building and refuses a changed fee rate (it is fixed into the ticket)', async () => {
    spies.fetchConfig.mockImplementation(async () => ({ ...useChainData.getState().config!, feeBps: 1_000 }));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /Bileti kes/ }).click());
    await settle();
    expect(spies.fetchConfig).toHaveBeenCalledTimes(1);
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Kesinti ya da depozito az önce değişti/);
  });

  it('re-reads the arena right before building and refuses a changed price', async () => {
    spies.fetchArena.mockImplementation(async () => arena(1, 1500n * M, false));
    open(PENNY);
    act(() => screen.getByRole('button', { name: /Bileti kes/ }).click());
    await settle();
    expect(spies.buildTicketTx).not.toHaveBeenCalled();
    expect(spies.sendTx).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/az önce değişti/);
  });

  it('offers "Devam et" instead of paying again when the ticket turns out to be open', () => {
    useChainData.setState({
      sessions: {
        1: { address: 'S', id: 1, player: 'P', arena: 'A1', arenaId: 1, entryFee: 1000n * M, openedAt: 1, hasPass: false, passAsset: null, settleFee: 20_000, feeBps: 500 },
      },
    });
    open(PENNY);
    expect(screen.getByRole('button', { name: /Devam et/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bileti kes/ })).toBeNull();
  });
});
