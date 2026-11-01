import type { CustomRoomQuote, CustomRoomView } from '@elymum/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customRoomsPatch } from '../src/admin/CustomRoomsCard';
import { Kb } from '../src/design';
import { RoomApiError, loadPendingPayment, roomLink, savePendingPayment } from '../src/rooms/api';
import { RoomCreator, hypeText } from '../src/rooms/RoomCreator';
import { useUi } from '../src/store';
import { resetWallets, useWallet } from '../src/wallet/store';
import { ALICE, chainStatus, detail, fakeProvider } from './evm-helpers';

const HASH = `0x${'ab'.repeat(32)}`;
const TREASURY = '0x3333333333333333333333333333333333333333';
const PRICE = 5n * 10n ** 16n;

const spies = vi.hoisted(() => ({ quote: vi.fn(), create: vi.fn(), pay: vi.fn(), play: vi.fn() }));
vi.mock('../src/rooms/api', async (orig) => {
  const real = await orig<typeof import('../src/rooms/api')>();
  return { ...real, roomsApi: { ...real.roomsApi, quote: spies.quote, create: spies.create, mine: async () => [] } };
});
vi.mock('../src/rooms/pay', () => ({ payRoomFee: spies.pay }));
vi.mock('../src/game/instance', () => ({ engine: () => ({ play: spies.play }) }));

const quote = (o: Partial<CustomRoomQuote> = {}): CustomRoomQuote => ({
  enabled: true,
  priceWei: PRICE.toString(),
  youPayWei: PRICE.toString(),
  treasury: TREASURY,
  holderPerk: 'discount',
  holderDiscountPct: 50,
  holder: false,
  freeAvailable: false,
  live: 1,
  maxLive: 6,
  mine: 0,
  maxPerWallet: 2,
  chainId: 99801,
  ...o,
});
const roomView = (o: Partial<CustomRoomView> = {}): CustomRoomView => ({
  code: 'AB2CD',
  name: 'Friday Pond',
  maxPlayers: 10,
  players: 0,
  best: [],
  paidWith: 'paid',
  txHash: HASH,
  durationMin: 30,
  mapSize: 'M',
  bots: 6,
  difficulty: 'mixed',
  food: 'normal',
  powerUps: true,
  creator: ALICE,
  createdAt: 1,
  endsAt: 1 + 30 * 60_000,
  ...o,
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function signIn() {
  useWallet.setState({ status: 'connected', address: ALICE, chainId: 99801, current: detail(fakeProvider({ chainId: 99801, known: [99801] })) });
  useUi.setState({ auth: { address: ALICE, token: 'tok', profile: null } });
}

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
  spies.quote.mockResolvedValue(quote());
  spies.create.mockResolvedValue({ room: roomView(), invite: 'http://localhost/play?room=AB2CD' });
  spies.pay.mockImplementation(async (_c: unknown, _to: unknown, _wei: bigint, onPhase: (p: string, h?: string) => void) => {
    onPhase('signing');
    onPhase('confirming', HASH);
    return { ok: true, hash: HASH };
  });
  resetWallets();
  useUi.setState({ chain: chainStatus(), auth: null });
  savePendingPayment(null);
});
afterEach(() => savePendingPayment(null));

const open = async () => {
  render(
    <Kb>
      <RoomCreator open onClose={() => {}} />
    </Kb>,
  );
  await settle();
};

describe('the room creator', () => {
  it('asks a guest to connect a wallet: guests cannot create', async () => {
    await open();
    expect(screen.getByText('Connect a wallet to create')).toBeTruthy();
    expect(screen.getByText(/Guests can join any room with its code/)).toBeTruthy();
    expect(spies.quote).toHaveBeenCalledWith(null);
  });

  it('picks the rules, shows the payment step, pays once and ends on the invite code and link', async () => {
    signIn();
    await open();
    expect(spies.quote).toHaveBeenCalledWith('tok');
    expect(screen.getByTestId('cr-price').textContent).toMatch(/0\.05/);
    // a name is required
    fireEvent.click(screen.getByTestId('cr-continue'));
    expect(screen.getByText(/Give the room a name/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Friday Pond' } });
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    fireEvent.click(screen.getByTestId('cr-continue'));
    await settle();
    const payment = screen.getByTestId('cr-payment');
    expect(payment.textContent).toMatch(/60 min/);
    expect(payment.textContent).toMatch(/none, pure fun/);
    expect(payment.textContent).toMatch(/0\.05 HYPE/);
    fireEvent.click(screen.getByTestId('cr-pay'));
    fireEvent.click(screen.getByTestId('cr-pay')); // a double click never pays twice
    await settle();
    expect(spies.pay).toHaveBeenCalledTimes(1);
    expect(spies.pay.mock.calls[0][1]).toBe(TREASURY);
    expect(spies.pay.mock.calls[0][2]).toBe(PRICE);
    expect(spies.create).toHaveBeenCalledWith('tok', expect.objectContaining({ name: 'Friday Pond', durationMin: 60, mapSize: 'L', difficulty: 'hard' }), HASH);
    expect(screen.getByTestId('cr-code').textContent).toBe('AB2CD');
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toMatch(/\/play\?room=AB2CD$/);
    expect(loadPendingPayment(ALICE)).toBeNull();
    fireEvent.click(screen.getByTestId('cr-enter'));
    expect(spies.play).toHaveBeenCalledWith('private:AB2CD');
  });

  it('a payment that went through but opened no room is kept and reused, never paid twice', async () => {
    signIn();
    spies.create.mockRejectedValueOnce(new RoomApiError(503, 'slots_busy', 'All room slots are busy right now.', undefined, true));
    await open();
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Retry room' } });
    fireEvent.click(screen.getByTestId('cr-continue'));
    await settle();
    fireEvent.click(screen.getByTestId('cr-pay'));
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/All room slots are busy.*Your payment is kept/);
    expect(loadPendingPayment(ALICE)?.hash).toBe(HASH);
    expect(screen.getByTestId('cr-pay').textContent).toMatch(/Open with my payment/);
    fireEvent.click(screen.getByTestId('cr-pay'));
    await settle();
    expect(spies.pay).toHaveBeenCalledTimes(1);
    expect(spies.create).toHaveBeenLastCalledWith('tok', expect.anything(), HASH);
    expect(screen.getByTestId('cr-code')).toBeTruthy();
  });

  it('a holder with a free room opens it without a payment', async () => {
    signIn();
    spies.quote.mockResolvedValue(quote({ holder: true, holderPerk: 'free_daily', freeAvailable: true, youPayWei: '0' }));
    await open();
    expect(screen.getByTestId('cr-price').textContent).toMatch(/Free/);
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Holder room' } });
    fireEvent.click(screen.getByTestId('cr-continue'));
    await settle();
    fireEvent.click(screen.getByTestId('cr-pay'));
    await settle();
    expect(spies.pay).not.toHaveBeenCalled();
    expect(spies.create).toHaveBeenCalledWith('tok', expect.anything(), null);
  });

  it('says so when every room slot is busy', async () => {
    signIn();
    spies.quote.mockResolvedValue(quote({ live: 6, maxLive: 6 }));
    await open();
    const btn = screen.getByTestId('cr-continue') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/All room slots are busy/);
    expect(btn.disabled).toBe(true);
  });
});

describe('room helpers', () => {
  it('formats HYPE with as few decimals as needed and builds share links', () => {
    expect(hypeText(PRICE)).toBe('0.05');
    expect(hypeText(PRICE / 2n)).toBe('0.025');
    expect(hypeText(10n ** 18n)).toBe('1.00');
    expect(roomLink('AB2CD', 'https://elymum.io/')).toBe('https://elymum.io/play?room=AB2CD');
  });

  it('the admin card sends only the changed settings', () => {
    const s = { enabled: true, priceHype: '0.05', treasury: null, holderPerk: 'discount' as const, holderDiscountPct: 50, maxLive: 6, maxPerWallet: 2 };
    expect(customRoomsPatch(s, { ...s })).toEqual({});
    expect(customRoomsPatch(s, { ...s, priceHype: '0.1', maxLive: 4 })).toEqual({ priceHype: '0.1', maxLive: 4 });
  });

  it('a kept payment belongs to its wallet and expires', () => {
    savePendingPayment({ hash: HASH, wallet: ALICE, wei: '1', at: Date.now() });
    expect(loadPendingPayment(ALICE.toLowerCase())?.hash).toBe(HASH);
    expect(loadPendingPayment('0x2222222222222222222222222222222222222222')).toBeNull();
    savePendingPayment({ hash: HASH, wallet: ALICE, wei: '1', at: Date.now() - 3 * 3600_000 });
    expect(loadPendingPayment(ALICE)).toBeNull();
  });
});
