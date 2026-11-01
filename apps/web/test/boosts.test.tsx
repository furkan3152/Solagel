import { BOOST_RULES, CellFlag, EntityKind, SHOP_DEFAULTS, type BoostState, type ShopView, type SnapshotData } from '@elymum/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shopPatch } from '../src/admin/ShopCard';
import { Kb } from '../src/design';
import { setEngine } from '../src/game/instance';
import type { GameEngine } from '../src/game/engine';
import { Input, boostForCode, type InputActions } from '../src/game/input';
import { ClientWorld } from '../src/game/state';
import { useUi } from '../src/store';
import { BoostBar, cooldownFrac, shownKinds } from '../src/ui/game/BoostBar';
import { ShopSheet, priceText } from '../src/ui/shop/ShopSheet';
import { ShopError, claimPack, totalCharges } from '../src/wallet/shop';
import { chainStatus } from './evm-helpers';

const initial = useUi.getState();
const ONE = 10n ** 18n;
const state = (over: Partial<BoostState> = {}): BoostState => ({
  usable: true,
  signedIn: true,
  charges: { magnet: 2, shock: 0, speed: 1 },
  cooldownMs: { magnet: 0, shock: 0, speed: 0 },
  ...over,
});

afterEach(() => {
  act(() => useUi.setState(initial, true));
  setEngine(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('boost keys', () => {
  it('R, F and G fire the three power-ups and nothing else does', () => {
    expect(boostForCode('KeyR')).toBe('magnet');
    expect(boostForCode('KeyF')).toBe('shock');
    expect(boostForCode('KeyG')).toBe('speed');
    for (const c of ['KeyE', 'Space', 'KeyQ', 'Digit1', 'KeyW', 'Enter']) expect(boostForCode(c)).toBeNull();
  });

  it('the input routes the keys (no repeats, not while typing)', () => {
    const actions: InputActions = { split: vi.fn(), eject: vi.fn(), emote: vi.fn(), openChat: vi.fn(), escape: vi.fn(), spectateNext: vi.fn(), steering: () => true, boost: vi.fn() };
    const input = new Input(document.createElement('div'), actions, () => {}, () => {});
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3' }));
    expect(actions.boost).toHaveBeenCalledTimes(2);
    expect(actions.boost).toHaveBeenNthCalledWith(1, 'shock');
    expect(actions.boost).toHaveBeenNthCalledWith(2, 'magnet');
    expect(actions.emote).toHaveBeenCalledWith(2);
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', bubbles: true }));
    expect(actions.boost).toHaveBeenCalledTimes(2);
    field.remove();
    input.destroy();
  });
});

describe('boost HUD helpers', () => {
  it('cooldown ring fraction and the kinds shown', () => {
    expect(cooldownFrac(0, 1000, 'magnet')).toBe(0);
    expect(cooldownFrac(1000 + BOOST_RULES.magnet.cooldownMs / 2, 1000, 'magnet')).toBeCloseTo(0.5);
    expect(cooldownFrac(1e12, 0, 'shock')).toBe(1);
    const ready = { magnet: 0, shock: 5000, speed: 0 };
    expect(shownKinds({ magnet: 1, shock: 0, speed: 0 }, ready, 1000)).toEqual(['magnet', 'shock']);
    expect(shownKinds({ magnet: 1, shock: 0, speed: 3 }, ready, 9000, ['speed'])).toEqual(['magnet']);
    expect(totalCharges({ magnet: 1, shock: 2, speed: 3 })).toBe(6);
    expect(totalCharges(null)).toBe(0);
  });
});

describe('BoostBar', () => {
  beforeEach(() => {
    useUi.setState({ chain: chainStatus(), screen: 'playing' });
  });

  it('shows a button per owned power-up with its key and count; a press asks the engine', () => {
    const boost = vi.fn();
    setEngine({ boost } as unknown as GameEngine);
    act(() => useUi.setState({ boosts: state(), boostReady: { magnet: 0, shock: 0, speed: 0 } }));
    render(
      <Kb>
        <BoostBar />
      </Kb>,
    );
    const magnet = screen.getByRole('button', { name: /Magnet \(R\) · 2 left/ });
    expect(screen.getByRole('button', { name: /Speed burst \(G\) · 1 left/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Shockwave/ })).toBeNull();
    fireEvent.pointerDown(magnet);
    expect(boost).toHaveBeenCalledWith('magnet');
    // the shop button opens the sheet
    fireEvent.click(screen.getByRole('button', { name: /Open the power-up shop/ }));
    expect(useUi.getState().modal).toBe('shop');
  });

  it('arena rooms print the round allowance; guests see nothing', () => {
    act(() => useUi.setState({ boosts: state({ arena: { left: 1, max: 2 } }) }));
    const { unmount } = render(<BoostBar />);
    expect(screen.getByText('1/2 this round')).toBeTruthy();
    unmount();
    act(() => useUi.setState({ boosts: state({ signedIn: false, usable: false }) }));
    const { container } = render(<BoostBar />);
    expect(container.innerHTML).toBe('');
  });

  it('a recharging power-up is marked', () => {
    act(() => useUi.setState({ boosts: state(), boostReady: { magnet: Date.now() + 10_000, shock: 0, speed: 0 } }));
    render(<BoostBar />);
    expect(screen.getByRole('button', { name: /Magnet/ }).className).toContain('is-cooling');
  });
});

const VIEW: ShopView = {
  open: true,
  token: { address: '0x0000000000000000000000000000000000000707', symbol: 'tELYMUM', decimals: 18 },
  sink: '0x000000000000000000000000000000000000dEaD',
  sinkKind: 'burn',
  packs: [
    { kind: 'magnet', charges: 3, priceRaw: (210n * ONE).toString(), fullPriceRaw: (300n * ONE).toString(), enabled: true },
    { kind: 'shock', charges: 3, priceRaw: (315n * ONE).toString(), fullPriceRaw: (450n * ONE).toString(), enabled: true },
    { kind: 'speed', charges: 3, priceRaw: (210n * ONE).toString(), fullPriceRaw: (300n * ONE).toString(), enabled: false },
  ],
  holder: true,
  holderDiscountPct: 30,
  arenaUsesPerRound: 3,
  holderExtraArenaUses: 1,
  charges: { magnet: 4, shock: 0, speed: 0 },
};

describe('ShopSheet', () => {
  it('lists the packs with holder prices, owned charges and the burn note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(VIEW), { status: 200 })));
    act(() => useUi.setState({ chain: chainStatus(), modal: 'shop', auth: { address: '0x1111111111111111111111111111111111111111', token: 'tok', profile: null } }));
    render(
      <Kb>
        <ShopSheet />
      </Kb>,
    );
    await waitFor(() => expect(screen.getByTestId('shop-buy-magnet')).toBeTruthy());
    expect(screen.getByTestId('shop-buy-magnet').textContent).toContain('Buy 3 for 210 tELYMUM');
    expect(screen.getAllByText('300 tELYMUM')).toHaveLength(2);
    expect(screen.getByText(/You have 4/)).toBeTruthy();
    expect(screen.getByText(/30% off and \+1 arena use per round/)).toBeTruthy();
    expect(screen.getByText(/Payments are burned/)).toBeTruthy();
    expect((screen.getByTestId('shop-buy-speed') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks guests to sign in and disables buying', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...VIEW, holder: false, charges: undefined }), { status: 200 })));
    act(() => useUi.setState({ chain: chainStatus(), modal: 'shop', auth: null }));
    render(
      <Kb>
        <ShopSheet />
      </Kb>,
    );
    await waitFor(() => expect(screen.getByTestId('shop-buy-magnet')).toBeTruthy());
    expect((screen.getByTestId('shop-buy-magnet') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Sign in with wallet/ }));
    expect(useUi.getState().modal).toBe('wallet');
  });

  it('price text', () => {
    expect(priceText((12_500_000n * 10n ** 12n).toString(), VIEW)).toBe('12.5 tELYMUM');
  });
});

describe('claimPack', () => {
  it('retries while the receipt is not visible, then returns the charges', async () => {
    const replies = [
      new Response(JSON.stringify({ error: 'tx_pending', message: 'not yet' }), { status: 409 }),
      new Response(JSON.stringify({ ok: true, kind: 'shock', added: 3, charges: { magnet: 0, shock: 3, speed: 0 } }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => replies.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    const r = await claimPack('tok', 'shock', `0x${'1'.repeat(64)}`, { retryMs: [0, 1, 1] });
    expect(r.charges.shock).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ kind: 'shock', txHash: `0x${'1'.repeat(64)}` });
  });

  it('stops at a final refusal and keeps the hash for the player', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'wrong_amount', message: 'That payment does not match the pack price.' }), { status: 400 })));
    const err = await claimPack('tok', 'magnet', `0x${'2'.repeat(64)}`, { retryMs: [0, 1] }).catch((e) => e);
    expect(err).toBeInstanceOf(ShopError);
    expect(err).toMatchObject({ code: 'wrong_amount', txHash: `0x${'2'.repeat(64)}` });
  });
});

describe('shockwave ring state', () => {
  const snap = (flags: number): SnapshotData => ({
    tick: 1,
    view: { x: 0, y: 0, h: 1200 },
    players: [{ id: 3, skin: 0, flags: 0, name: 'a' }],
    upserts: [{ id: 9, kind: EntityKind.Cell, x: 100, y: 100, r: 40, playerId: 3, flags }],
    removals: [],
  });
  it('starts the ring on the rising edge of the flag only', () => {
    const w = new ClientWorld();
    w.apply(snap(0), 10);
    expect(w.entities.get(9)!.shockAt).toBe(0);
    w.apply(snap(CellFlag.Shock), 50);
    expect(w.entities.get(9)!.shockAt).toBe(50);
    w.apply(snap(CellFlag.Shock | CellFlag.Magnet), 80);
    expect(w.entities.get(9)!.shockAt).toBe(50);
    w.apply(snap(0), 120);
    w.apply(snap(CellFlag.Shock), 400);
    expect(w.entities.get(9)!.shockAt).toBe(400);
  });
});

describe('admin shop patch', () => {
  it('sends only what changed', () => {
    const a = structuredClone(SHOP_DEFAULTS);
    const b = structuredClone(SHOP_DEFAULTS);
    expect(shopPatch(a, b)).toEqual({});
    b.prices.shock = '500';
    b.kinds.speed = false;
    b.sink = 'treasury';
    b.arenaUsesPerRound = 1;
    expect(shopPatch(a, b)).toEqual({ prices: { shock: '500' }, kinds: { speed: false }, sink: 'treasury', arenaUsesPerRound: 1 });
  });
});
