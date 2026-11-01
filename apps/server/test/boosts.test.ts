import { BOOST_RULES, BURN_ADDRESS, CellFlag, PlayerFlag, RULES, SHOP_DEFAULTS, TICK_MS, packPriceRaw, shockRange, type ServerMessage } from '@elymum/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChainBusyError, type TokenReceipt } from '../src/chain/types';
import { World, type WorldConfig } from '../src/game/world';
import { Room } from '../src/rooms/room';
import { BoostInventory } from '../src/shop/inventory';
import { ShopFail, ShopService, type UseContext } from '../src/shop/service';
import { ShopSettingsError, ShopSettingsStore, applyShopSettings } from '../src/shop/settings';
import { verifyPurchase } from '../src/shop/verify';
import { ArenaChain, MID_ROUND, fakeConn, roomDeps } from './helpers';

const cfg = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  width: 4000,
  height: 4000,
  foodTarget: 0,
  virusTarget: 0,
  maxPowerUps: 0,
  powerUps: false,
  coinRain: false,
  seed: 7,
  ...over,
});
const run = (w: World, ms: number) => {
  for (let i = 0; i < Math.ceil(ms / TICK_MS); i++) w.tick(TICK_MS);
};

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x0000000000000000000000000000000000000707';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const ONE = 10n ** 18n;

/* ------------------------------------------------------------------ */
/* World effects                                                       */
/* ------------------------------------------------------------------ */

describe('boosts: world effects', () => {
  it('magnet pulls food (not loot, not coins) for 8 s and shows the magnet flag', () => {
    const w = new World(cfg());
    const p = w.addPlayer({ spawnShield: false, name: 'a', skin: 0, x: 1000, y: 1000, mass: 100 });
    const other = w.addPlayer({ spawnShield: false, name: 'b', skin: 0, x: 1180, y: 1000, mass: 30 });
    const f = w.spawnFood(1150, 1000, 0);
    w.restoreLoot([{ x: 1000, y: 1160, value: 5 }]);
    expect(w.useBoost(p.id, 'magnet')).toBe(true);
    const before = Math.hypot(f.x - 1000, f.y - 1000);
    w.tick(TICK_MS);
    expect(Math.hypot(f.x - p.cells[0].x, f.y - p.cells[0].y)).toBeLessThan(before);
    expect(p.cells[0].flags & CellFlag.Magnet).toBeTruthy();
    expect(w.loot()[0]).toMatchObject({ x: 1000, y: 1160 });
    expect(other.cells[0].x).toBeGreaterThan(1150);
    run(w, BOOST_RULES.magnet.durationMs + 100);
    expect(p.cells[0].flags & CellFlag.Magnet).toBe(0);
  });

  it('speed burst is faster for 3 s, then normal', () => {
    const fast = new World(cfg());
    const slow = new World(cfg());
    const a = fast.addPlayer({ spawnShield: false, name: 'a', skin: 0, x: 500, y: 500, mass: 50 });
    const b = slow.addPlayer({ spawnShield: false, name: 'b', skin: 0, x: 500, y: 500, mass: 50 });
    fast.setTarget(a.id, 3500, 500);
    slow.setTarget(b.id, 3500, 500);
    fast.useBoost(a.id, 'speed');
    run(fast, 1000);
    run(slow, 1000);
    expect(a.cells[0].x - 500).toBeGreaterThan((b.cells[0].x - 500) * 1.3);
    expect(a.cells[0].flags & CellFlag.Pump).toBeTruthy();
    run(fast, BOOST_RULES.speed.durationMs);
    expect(a.cells[0].flags & CellFlag.Pump).toBe(0);
  });

  it('shockwave pushes smaller and similar coins and food away, not bigger coins; flag shows briefly', () => {
    const w = new World(cfg());
    const p = w.addPlayer({ spawnShield: false, name: 'me', skin: 0, x: 2000, y: 2000, mass: 100 });
    const small = w.addPlayer({ spawnShield: false, name: 's', skin: 0, x: 2150, y: 2000, mass: 30 });
    const similar = w.addPlayer({ spawnShield: false, name: 'm', skin: 0, x: 2000, y: 1820, mass: 110 });
    const big = w.addPlayer({ spawnShield: false, name: 'b', skin: 0, x: 1700, y: 2000, mass: 400 });
    const far = w.addPlayer({ spawnShield: false, name: 'f', skin: 0, x: 3600, y: 3600, mass: 20 });
    const food = w.spawnFood(2050, 2050, 0);
    for (const q of [p, small, similar, big, far]) w.setTarget(q.id, q.cells[0].x, q.cells[0].y);
    const s0 = small.cells[0].x;
    const m0 = similar.cells[0].y;
    const b0 = { x: big.cells[0].x, y: big.cells[0].y };
    const fd0 = Math.hypot(food.x - 2000, food.y - 2000);
    expect(w.useBoost(p.id, 'shock')).toBe(true);
    w.tick(TICK_MS);
    expect(p.cells[0].flags & CellFlag.Shock).toBeTruthy();
    expect(Math.hypot(food.x - 2000, food.y - 2000)).toBeGreaterThan(fd0 + 50);
    // launched straight away from me (a split-like boost; they steer back afterwards)
    expect(small.cells[0].vx).toBeGreaterThan(300);
    expect(similar.cells[0].vy).toBeLessThan(-300);
    expect(big.cells[0].vx).toBe(0);
    run(w, 200);
    expect(small.cells[0].x - s0).toBeGreaterThan(60);
    expect(m0 - similar.cells[0].y).toBeGreaterThan(40);
    // the big coin is not pushed (it may walk toward its own target only)
    expect(Math.hypot(big.cells[0].x - b0.x, big.cells[0].y - b0.y)).toBeLessThan(20);
    expect(far.cells[0].x).toBeCloseTo(3600, 0);
    run(w, BOOST_RULES.shock.fxMs);
    expect(p.cells[0].flags & CellFlag.Shock).toBe(0);
  });

  it('the shockwave never feeds a kill: pushed coins are not eaten (by the user or a third coin) during the grace', () => {
    const w = new World(cfg());
    const me = w.addPlayer({ spawnShield: false, name: 'me', skin: 0, x: 2000, y: 2000, mass: 300 });
    const prey = w.addPlayer({ spawnShield: false, name: 'prey', skin: 0, x: 2200, y: 2000, mass: 60 });
    // a third, much bigger coin sits right where the push sends the prey
    const shark = w.addPlayer({ spawnShield: false, name: 'shark', skin: 0, x: 2420, y: 2000, mass: 900 });
    for (const q of [me, prey, shark]) w.setTarget(q.id, q.cells[0].x, q.cells[0].y);
    w.useBoost(me.id, 'shock');
    w.tick(TICK_MS);
    expect(prey.cells[0].pushedUntil).toBeGreaterThan(w.now);
    run(w, BOOST_RULES.shock.graceMs - 200);
    expect(prey.alive).toBe(true);
    // the user chasing the prey cannot eat it through the push either
    w.setTarget(me.id, prey.cells[0].x, prey.cells[0].y);
    w.tick(TICK_MS);
    expect(prey.alive).toBe(true);
    expect(me.totalMass()).toBeLessThan(310);
  });

  it('a pushed coin cannot eat during the grace either', () => {
    const w = new World(cfg());
    const me = w.addPlayer({ spawnShield: false, name: 'me', skin: 0, x: 2000, y: 2000, mass: 200 });
    const pushed = w.addPlayer({ spawnShield: false, name: 'p', skin: 0, x: 2100, y: 2000, mass: 180 });
    const crumb = w.addPlayer({ spawnShield: false, name: 'c', skin: 0, x: 2340, y: 2000, mass: 20 });
    for (const q of [me, pushed, crumb]) w.setTarget(q.id, q.cells[0].x, q.cells[0].y);
    w.useBoost(me.id, 'shock');
    run(w, 600);
    expect(crumb.alive).toBe(true);
  });

  it('shock range grows with the radius', () => {
    expect(shockRange(100)).toBeGreaterThan(shockRange(20));
    expect(shockRange(0)).toBe(BOOST_RULES.shock.rangeBase);
  });

  it('useBoost refuses a dead or unknown player', () => {
    const w = new World(cfg());
    expect(w.useBoost(99, 'magnet')).toBe(false);
    const p = w.addPlayer({ name: 'x', skin: 0, x: 100, y: 100 });
    w.removePlayer(p.id);
    expect(w.useBoost(p.id, 'shock')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Purchase verification                                               */
/* ------------------------------------------------------------------ */

const receipt = (over: Partial<TokenReceipt> & { transfers?: TokenReceipt['transfers'] } = {}): TokenReceipt => ({
  status: 'success',
  blockNumber: 10n,
  transfers: [{ token: TOKEN, from: WALLET, to: BURN_ADDRESS, value: 300n * ONE }],
  ...over,
});

describe('boosts: verifyPurchase', () => {
  const exp = { token: TOKEN, from: WALLET, to: BURN_ADDRESS, amounts: [300n * ONE] };
  it('accepts the exact payment (any address case)', () => {
    expect(verifyPurchase(receipt(), { ...exp, from: WALLET.toUpperCase().replace('0X', '0x'), to: BURN_ADDRESS.toLowerCase() })).toEqual({ ok: true, paid: 300n * ONE });
  });
  it('refuses pending, reverted, empty, other token, wrong recipient, wrong sender, wrong amount', () => {
    expect(verifyPurchase(null, exp)).toEqual({ ok: false, code: 'tx_pending' });
    expect(verifyPurchase(receipt({ status: 'reverted' }), exp)).toEqual({ ok: false, code: 'tx_failed' });
    expect(verifyPurchase(receipt({ transfers: [] }), exp)).toEqual({ ok: false, code: 'no_transfer' });
    expect(verifyPurchase(receipt({ transfers: [{ token: OTHER, from: WALLET, to: BURN_ADDRESS, value: 300n * ONE }] }), exp)).toEqual({ ok: false, code: 'wrong_token' });
    expect(verifyPurchase(receipt({ transfers: [{ token: TOKEN, from: WALLET, to: OTHER, value: 300n * ONE }] }), exp)).toEqual({ ok: false, code: 'wrong_recipient' });
    expect(verifyPurchase(receipt({ transfers: [{ token: TOKEN, from: OTHER, to: BURN_ADDRESS, value: 300n * ONE }] }), exp)).toEqual({ ok: false, code: 'wrong_sender' });
    expect(verifyPurchase(receipt({ transfers: [{ token: TOKEN, from: WALLET, to: BURN_ADDRESS, value: 299n * ONE }] }), exp)).toEqual({ ok: false, code: 'wrong_amount' });
    expect(verifyPurchase(receipt({ transfers: [{ token: TOKEN, from: WALLET, to: BURN_ADDRESS, value: 301n * ONE }] }), exp)).toEqual({ ok: false, code: 'wrong_amount' });
  });
  it('finds the matching log among others (a router moving other tokens first)', () => {
    const r = receipt({
      transfers: [
        { token: OTHER, from: WALLET, to: OTHER, value: 1n },
        { token: TOKEN, from: WALLET, to: BURN_ADDRESS, value: 300n * ONE },
      ],
    });
    expect(verifyPurchase(r, exp).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Shop service: buying                                                */
/* ------------------------------------------------------------------ */

class ShopChain extends ArenaChain {
  receipts = new Map<string, TokenReceipt>();
  busy = false;
  reads = 0;
  constructor() {
    super([]);
  }
  async tokenReceipt(h: string): Promise<TokenReceipt | null> {
    this.reads++;
    if (this.busy) throw new ChainBusyError('test');
    return this.receipts.get(h) ?? null;
  }
}

function shopFixture(opts: { holder?: boolean; dir?: string | null; settings?: Record<string, unknown> } = {}) {
  const chain = new ShopChain();
  const settings = new ShopSettingsStore(opts.dir ?? null);
  if (opts.settings) settings.update(opts.settings);
  const inventory = new BoostInventory(opts.dir ? join(opts.dir, 'boosts.json') : null);
  let now = 1_000_000;
  const holders = new Set<string>(opts.holder ? [WALLET.toLowerCase()] : []);
  const shop = new ShopService({
    settings,
    inventory,
    chain,
    owner: () => OTHER,
    holder: async (w) => holders.has(w.toLowerCase()),
    now: () => now,
    receiptRetryMs: [0, 1],
  });
  return { chain, settings, inventory, shop, holders, tick: (ms: number) => (now += ms) };
}

const pay = (chain: ShopChain, h: string, value: bigint, over: Partial<TokenReceipt['transfers'][number]> = {}) =>
  chain.receipts.set(h, { status: 'success', blockNumber: 1n, transfers: [{ token: TOKEN, from: WALLET, to: BURN_ADDRESS, value, ...over }] });

async function buyFails(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ShopFail) return err.code;
    throw err;
  }
  return 'ok';
}

describe('boosts: buying', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('credits a pack for an exact payment to the burn address', async () => {
    const { chain, shop } = shopFixture();
    pay(chain, hash(1), 300n * ONE);
    const r = await shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) });
    expect(r).toMatchObject({ ok: true, kind: 'magnet', added: 3, charges: { magnet: 3, shock: 0, speed: 0 } });
  });

  it('refuses a duplicate hash (also in another case), a forged one, wrong amount and wrong sender', async () => {
    const { chain, shop, inventory } = shopFixture();
    pay(chain, hash(1), 300n * ONE);
    await shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) }))).toBe('tx_used');
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(1).toUpperCase().replace('0X', '0x') }))).toBe('tx_used');
    // forged: no such transaction on chain
    expect(await buyFails(shop.buy(WALLET, { kind: 'speed', txHash: hash(2) }))).toBe('tx_pending');
    pay(chain, hash(3), 299n * ONE);
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(3) }))).toBe('wrong_amount');
    // the shock pack costs more: a magnet price is the wrong amount for it
    pay(chain, hash(4), 300n * ONE);
    expect(await buyFails(shop.buy(WALLET, { kind: 'shock', txHash: hash(4) }))).toBe('wrong_amount');
    // someone else's payment cannot be claimed
    pay(chain, hash(5), 300n * ONE, { from: OTHER });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(5) }))).toBe('wrong_sender');
    pay(chain, hash(6), 300n * ONE, { to: OTHER });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(6) }))).toBe('wrong_recipient');
    pay(chain, hash(7), 300n * ONE, { token: OTHER });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(7) }))).toBe('wrong_token');
    chain.receipts.set(hash(8), { status: 'reverted', blockNumber: 1n, transfers: [] });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(8) }))).toBe('tx_failed');
    expect(inventory.get(WALLET).magnet).toBe(3);
    // a refused payment is not burned as "used": once it is right (it never will be on chain) it could count
    expect(inventory.isUsed(hash(3))).toBe(false);
  });

  it('two requests for the same hash at once credit it once', async () => {
    const { chain, shop, inventory } = shopFixture();
    pay(chain, hash(1), 300n * ONE);
    const [a, b] = await Promise.allSettled([shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) }), shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) })]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(inventory.get(WALLET).magnet).toBe(3);
  });

  it('bad requests, a closed shop, a disabled kind and a busy chain', async () => {
    const { chain, shop, settings } = shopFixture();
    expect(await buyFails(shop.buy(WALLET, { kind: 'laser', txHash: hash(1) }))).toBe('bad_request');
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: '0x12' }))).toBe('bad_request');
    chain.busy = true;
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) }))).toBe('chain_busy');
    chain.busy = false;
    settings.update({ kinds: { shock: false } });
    expect(await buyFails(shop.buy(WALLET, { kind: 'shock', txHash: hash(1) }))).toBe('kind_disabled');
    settings.update({ enabled: false });
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) }))).toBe('shop_closed');
  });

  it('holders pay 30 % less; a non-holder cannot pay the holder price', async () => {
    const { chain, shop, holders } = shopFixture({ holder: true });
    const view = await shop.view(WALLET);
    expect(view.holder).toBe(true);
    expect(view.packs.find((p) => p.kind === 'magnet')).toMatchObject({ priceRaw: (210n * ONE).toString(), fullPriceRaw: (300n * ONE).toString(), charges: 3 });
    expect(view.arenaUsesPerRound).toBe(3);
    pay(chain, hash(1), 210n * ONE);
    expect((await shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) })).charges.magnet).toBe(3);
    // a holder who pays the full price is still served
    pay(chain, hash(2), 300n * ONE);
    expect((await shop.buy(WALLET, { kind: 'magnet', txHash: hash(2) })).charges.magnet).toBe(6);
    holders.clear();
    pay(chain, hash(3), 210n * ONE);
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(3) }))).toBe('wrong_amount');
  });

  it('the treasury sink pays the owner wallet (or the admin-set treasury)', async () => {
    const { chain, shop, settings } = shopFixture({ settings: { sink: 'treasury' } });
    expect(shop.sink()).toBe(OTHER);
    pay(chain, hash(1), 300n * ONE);
    expect(await buyFails(shop.buy(WALLET, { kind: 'magnet', txHash: hash(1) }))).toBe('wrong_recipient');
    pay(chain, hash(2), 300n * ONE, { to: OTHER });
    expect((await shop.buy(WALLET, { kind: 'magnet', txHash: hash(2) })).ok).toBe(true);
    settings.update({ treasury: '0x3333333333333333333333333333333333333333' });
    expect(shop.sink()).toBe('0x3333333333333333333333333333333333333333');
  });

  it('charges and used hashes survive a restart (per-chain file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boosts-'));
    dirs.push(dir);
    const a = shopFixture({ dir });
    pay(a.chain, hash(9), 450n * ONE);
    await a.shop.buy(WALLET, { kind: 'shock', txHash: hash(9) });
    const b = shopFixture({ dir });
    expect(b.inventory.get(WALLET).shock).toBe(3);
    pay(b.chain, hash(9), 450n * ONE);
    expect(await buyFails(b.shop.buy(WALLET, { kind: 'shock', txHash: hash(9) }))).toBe('tx_used');
  });

  it('the default prices are a fraction of the cheapest arena ticket', () => {
    expect(packPriceRaw(SHOP_DEFAULTS.prices.magnet, 18, 0)).toBe(300n * ONE);
    expect(packPriceRaw(SHOP_DEFAULTS.prices.shock, 18, SHOP_DEFAULTS.holderDiscountPct)).toBe(315n * ONE);
    expect(SHOP_DEFAULTS.sink).toBe('burn');
  });

  it('admin settings are validated', () => {
    expect(() => applyShopSettings(SHOP_DEFAULTS, { prices: { magnet: '-1' } })).toThrow(ShopSettingsError);
    expect(() => applyShopSettings(SHOP_DEFAULTS, { prices: { magnet: '0' } })).toThrow(ShopSettingsError);
    expect(() => applyShopSettings(SHOP_DEFAULTS, { sink: 'moon' })).toThrow(ShopSettingsError);
    expect(() => applyShopSettings(SHOP_DEFAULTS, { treasury: 'nope' })).toThrow(ShopSettingsError);
    expect(() => applyShopSettings(SHOP_DEFAULTS, { arenaUsesPerRound: 99 })).toThrow(ShopSettingsError);
    expect(() => applyShopSettings(SHOP_DEFAULTS, { surprise: 1 })).toThrow(ShopSettingsError);
    expect(applyShopSettings(SHOP_DEFAULTS, { prices: { speed: '12.5' }, arenaUsesPerRound: 1, kinds: { magnet: false } })).toMatchObject({
      prices: { speed: '12.5', magnet: '300' },
      arenaUsesPerRound: 1,
      kinds: { magnet: false, shock: true },
    });
  });
});

/* ------------------------------------------------------------------ */
/* Shop service: using (limits)                                        */
/* ------------------------------------------------------------------ */

describe('boosts: use limits', () => {
  const ctx = (over: Partial<UseContext> = {}): UseContext => ({ wallet: WALLET, isBot: false, arena: false, round: null, holder: false, ...over });
  async function stocked(holder = false) {
    const f = shopFixture({ holder, settings: { packSize: 10 } });
    for (const [i, kind, price] of [
      [1, 'magnet', 300n],
      [2, 'shock', 450n],
      [3, 'speed', 300n],
    ] as const) {
      pay(f.chain, hash(i), price * ONE);
      await f.shop.buy(WALLET, { kind, txHash: hash(i) });
    }
    return f;
  }

  it('practice: a charge per use, a cooldown per power-up, no round cap', async () => {
    const { shop, tick } = await stocked();
    const ok = () => true;
    expect(shop.use(ctx(), 'magnet', ok)).toEqual({ ok: true });
    expect(shop.use(ctx(), 'magnet', ok)).toEqual({ ok: false, reason: 'cooldown' });
    // another power-up has its own cooldown
    expect(shop.use(ctx(), 'speed', ok)).toEqual({ ok: true });
    expect(shop.use(ctx(), 'shock', ok)).toEqual({ ok: true });
    tick(BOOST_RULES.magnet.cooldownMs);
    expect(shop.use(ctx(), 'magnet', ok)).toEqual({ ok: true });
    tick(BOOST_RULES.magnet.cooldownMs);
    expect(shop.use(ctx(), 'magnet', ok)).toEqual({ ok: true });
    const st = shop.state(ctx());
    expect(st.charges.magnet).toBe(7);
    expect(st.arena).toBeUndefined();
    expect(st.cooldownMs.magnet).toBe(BOOST_RULES.magnet.cooldownMs);
  });

  it('paid arenas: at most 2 uses per round, 3 for holders; a new round resets', async () => {
    const { shop, tick } = await stocked();
    const ok = () => true;
    const a = ctx({ arena: true, round: 5 });
    expect(shop.use(a, 'magnet', ok).ok).toBe(true);
    expect(shop.use(a, 'shock', ok).ok).toBe(true);
    expect(shop.use(a, 'speed', ok)).toEqual({ ok: false, reason: 'round_limit' });
    expect(shop.state(a).arena).toEqual({ left: 0, max: 2 });
    // the holder's extra use
    expect(shop.use({ ...a, holder: true }, 'speed', ok).ok).toBe(true);
    expect(shop.use({ ...a, holder: true }, 'speed', ok)).toEqual({ ok: false, reason: 'cooldown' });
    tick(60_000);
    expect(shop.use({ ...a, holder: true }, 'speed', ok)).toEqual({ ok: false, reason: 'round_limit' });
    expect(shop.use({ ...a, round: 6 }, 'speed', ok).ok).toBe(true);
  });

  it('the admin limit applies; guests, bots, empty and disabled power-ups are refused; a dead player keeps the charge', async () => {
    const { shop, settings, inventory } = await stocked();
    settings.update({ arenaUsesPerRound: 1, holderExtraArenaUses: 0 });
    expect(shop.use(ctx({ arena: true, round: 1, holder: true }), 'magnet', () => true).ok).toBe(true);
    expect(shop.use(ctx({ arena: true, round: 1, holder: true }), 'shock', () => true)).toEqual({ ok: false, reason: 'round_limit' });
    expect(shop.use(ctx({ wallet: null }), 'shock', () => true)).toEqual({ ok: false, reason: 'guest' });
    expect(shop.use(ctx({ isBot: true }), 'shock', () => true)).toEqual({ ok: false, reason: 'bot' });
    expect(shop.use(ctx({ wallet: OTHER }), 'shock', () => true)).toEqual({ ok: false, reason: 'no_charges' });
    const before = inventory.get(WALLET).shock;
    expect(shop.use(ctx(), 'shock', () => false)).toEqual({ ok: false, reason: 'dead' });
    expect(inventory.get(WALLET).shock).toBe(before);
    settings.update({ kinds: { shock: false } });
    expect(shop.use(ctx(), 'shock', () => true)).toEqual({ ok: false, reason: 'disabled' });
    expect(shop.state(ctx()).disabled).toEqual(['shock']);
  });
});

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

describe('boosts: rooms', () => {
  async function roomWith(mode: 'practice' | 'arena') {
    const f = shopFixture();
    pay(f.chain, hash(1), 450n * ONE);
    await f.shop.buy(WALLET, { kind: 'shock', txHash: hash(1) });
    const room = new Room(
      { id: `${mode}-1`, mode, name: 'Test', maxPlayers: 10, bots: null, ...(mode === 'arena' ? { stake: { arenaId: 1, buyIn: 1000 } } : {}) },
      { ...roomDeps(f.chain), shop: f.shop },
    );
    return { ...f, room };
  }
  const last = (msgs: ServerMessage[], t: string) => [...msgs].reverse().find((m) => m.t === t);

  it('a signed-in player gets the state on join and can fire a shockwave; guests cannot', async () => {
    const { room } = await roomWith('practice');
    const conn = fakeConn(WALLET);
    room.join(conn, { name: 'me', skin: 0, flags: PlayerFlag.Verified });
    expect(last(conn.msgs, 'boosts')).toMatchObject({ state: { usable: true, signedIn: true, charges: { shock: 3 } } });
    room.boost(conn, 'shock');
    expect(last(conn.msgs, 'boost')).toEqual({ t: 'boost', kind: 'shock', ok: true, ms: 0 });
    expect(last(conn.msgs, 'boosts')).toMatchObject({ state: { charges: { shock: 2 } } });
    room.tick(TICK_MS);
    expect(conn.player!.cells[0].flags & CellFlag.Shock).toBeTruthy();
    room.boost(conn, 'shock');
    expect(last(conn.msgs, 'boost')).toMatchObject({ ok: false, reason: 'cooldown' });
    room.boost(conn, 'laser');

    const guest = fakeConn(null);
    room.join(guest, { name: 'guest', skin: 0, flags: 0 });
    expect(last(guest.msgs, 'boosts')).toMatchObject({ state: { usable: false, signedIn: false } });
    room.boost(guest, 'shock');
    expect(last(guest.msgs, 'boost')).toMatchObject({ ok: false, reason: 'guest' });
  });

  it('arena rooms report the round allowance', async () => {
    const { room } = await roomWith('arena');
    const conn = fakeConn(WALLET);
    room.join(conn, { name: 'me', skin: 0, flags: PlayerFlag.Verified | PlayerFlag.Holder });
    expect(last(conn.msgs, 'boosts')).toMatchObject({ state: { arena: { left: 3, max: 3 } } });
    room.boost(conn, 'shock');
    expect(last(conn.msgs, 'boosts')).toMatchObject({ state: { arena: { left: 2, max: 3 } } });
    expect(MID_ROUND).toBeGreaterThan(0);
    expect(RULES.roundMs).toBeGreaterThan(0);
  });
});
