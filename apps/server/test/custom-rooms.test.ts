import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CUSTOM_DEFAULTS, CUSTOM_MAP_WIDTH, CUSTOM_PAYMENT_MAX_AGE_MS, type CustomRoomConfig, type ServerMessage } from '@elymum/shared';
import { parseEther } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app';
import { PaymentChainBusy, UsedPayments, checkPayment, devFakePaymentReader, type NativeTransfer, type PaymentReader } from '../src/chain/payment';
import { NullChain } from '../src/chain/types';
import { loadConfig } from '../src/config';
import { Limiter } from '../src/net/limiter';
import { CustomRoomFail, CustomRoomService, customWorld } from '../src/rooms/custom';
import { RoomManager } from '../src/rooms/manager';
import { ArenaChain, arena, fakeConn, roomDeps } from './helpers';
import { testSigner } from './signers';

const TREASURY = '0x1111111111111111111111111111111111111111';
const PRICE = parseEther('0.05');
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const cfgOf = (extra: Partial<CustomRoomConfig> = {}): CustomRoomConfig => ({ ...CUSTOM_DEFAULTS, name: 'Friday Pond', ...extra });

/** A chain of native transfers keyed by hash; `busy` makes every read fail like a rate-limited RPC. */
class FakeTransfers implements PaymentReader {
  readonly txs = new Map<string, NativeTransfer>();
  reads = 0;
  busy = false;
  constructor(private readonly clock: { t: number }) {}
  pay(n: number, from: string, extra: Partial<NativeTransfer> = {}): string {
    const h = hash(n);
    this.txs.set(h, { hash: h, from, to: TREASURY, value: PRICE, status: 'success', blockNumber: 10n, timestamp: this.clock.t - 5_000, ...extra });
    return h;
  }
  async transfer(h: string): Promise<NativeTransfer | null> {
    this.reads++;
    if (this.busy) throw new PaymentChainBusy();
    return this.txs.get(h.toLowerCase()) ?? null;
  }
}

function setup(o: { dir?: string | null; holder?: boolean; clock?: { t: number }; reader?: FakeTransfers } = {}) {
  const clock = o.clock ?? { t: 1_800_000_000_000 };
  const chain = new NullChain();
  const rooms = new RoomManager(loadConfig({ BOT_TARGET: '0', BOT_MIN: '0', BOT_MAX: '0' } as NodeJS.ProcessEnv), roomDeps(chain), chain);
  const reader = o.reader ?? new FakeTransfers(clock);
  const dir = o.dir === undefined ? mkdtempSync(join(tmpdir(), 'elymum-custom-')) : o.dir;
  const used = new UsedPayments(dir ? join(dir, 'chains', '99801', 'room-payments.json') : null);
  const svc = new CustomRoomService({
    rooms,
    dataDir: dir,
    used,
    reader: () => reader,
    chainId: () => 99801,
    isHolder: async () => o.holder ?? false,
    ownerWallet: TREASURY,
    now: () => clock.t,
  });
  return { svc, rooms, reader, clock, dir, used };
}

const fail = async (p: Promise<unknown>): Promise<CustomRoomFail> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof CustomRoomFail) return err;
    throw err;
  }
  throw new Error('expected a CustomRoomFail');
};

describe('room payment verification', () => {
  const clock = { t: 1_800_000_000_000 };
  const alice = testSigner().address;
  const check = (reader: PaymentReader, used: UsedPayments, h: string, from = alice) =>
    checkPayment(reader, used, { hash: h, from, to: TREASURY, minWei: PRICE, now: clock.t });

  it('accepts a recent transfer from the signed-in wallet to the treasury of at least the price', async () => {
    const r = new FakeTransfers(clock);
    const res = await check(r, new UsedPayments(null), r.pay(1, alice, { value: PRICE + 1n }));
    expect(res.ok).toBe(true);
  });

  it('refuses forged, wrong-sender, wrong-receiver, underpaid, reverted, stale and used payments', async () => {
    const r = new FakeTransfers(clock);
    const used = new UsedPayments(null);
    const bob = testSigner().address;
    // forged: no such transaction on chain (or not mined yet)
    expect(await check(r, used, hash(404))).toMatchObject({ ok: false, code: 'payment_pending' });
    expect(await check(r, used, 'not-a-hash')).toMatchObject({ ok: false, code: 'payment_invalid' });
    // somebody else's payment cannot be claimed
    expect(await check(r, used, r.pay(2, bob))).toMatchObject({ ok: false, code: 'payment_invalid', message: expect.stringMatching(/another wallet/) });
    expect(await check(r, used, r.pay(3, alice, { to: bob }))).toMatchObject({ ok: false, code: 'payment_invalid', message: expect.stringMatching(/treasury/) });
    expect(await check(r, used, r.pay(4, alice, { to: null }))).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(await check(r, used, r.pay(5, alice, { value: PRICE - 1n }))).toMatchObject({ ok: false, code: 'payment_low' });
    expect(await check(r, used, r.pay(6, alice, { status: 'reverted' }))).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(await check(r, used, r.pay(7, alice, { timestamp: clock.t - CUSTOM_PAYMENT_MAX_AGE_MS - 1 }))).toMatchObject({ ok: false, code: 'payment_stale' });
    const h = r.pay(8, alice);
    used.markUsed(h, { at: clock.t, wallet: alice, code: 'AAAAA' });
    const reads = r.reads;
    // a used hash is refused without even reading the chain
    expect(await check(r, used, h.toUpperCase().replace('0X', '0x'))).toMatchObject({ ok: false, code: 'payment_used' });
    expect(r.reads).toBe(reads);
  });

  it('case-insensitive addresses match; the fake chain only answers its own hashes', async () => {
    const r = new FakeTransfers(clock);
    expect((await check(r, new UsedPayments(null), r.pay(9, alice.toLowerCase()), alice.toUpperCase().replace('0X', '0x'))).ok).toBe(true);
    const fake = devFakePaymentReader(() => clock.t);
    expect(await fake.transfer(hash(1), { from: alice, to: TREASURY, minWei: PRICE })).toBeNull();
    const fh = `0xde7fa4e0${'0'.repeat(48)}12345678`;
    expect(await check(fake, new UsedPayments(null), fh)).toMatchObject({ ok: true });
  });

  it('persists used hashes and refuses an unreadable file instead of forgetting them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-pay-'));
    const file = join(dir, 'room-payments.json');
    const a = new UsedPayments(file);
    a.markUsed(hash(1), { at: 1, wallet: alice, code: 'ABCDE' });
    expect(new UsedPayments(file).has(hash(1))).toBe(true);
    expect(a.claim(hash(2))).toBe(true);
    expect(a.claim(hash(2))).toBe(false); // in flight
    a.release(hash(2));
    expect(a.claim(hash(2))).toBe(true);
    writeFileSync(file, '{oops');
    expect(() => new UsedPayments(file)).toThrow(/unreadable/);
  });
});

describe('custom rooms: create, caps, perks', () => {
  it('a paid room opens with its own rules and invite code; the same payment cannot open a second room', async () => {
    const { svc, rooms, reader } = setup();
    const alice = testSigner().address;
    const h = reader.pay(1, alice);
    const view = await svc.create(alice, { config: cfgOf({ mapSize: 'S', bots: 4, difficulty: 'hard', maxPlayers: 6, powerUps: false }), txHash: h });
    expect(view.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect(view).toMatchObject({ name: 'Friday Pond', paidWith: 'paid', txHash: h, maxPlayers: 6, creator: alice, durationMin: 30 });
    expect(view.endsAt - view.createdAt).toBe(30 * 60_000);
    const room = rooms.privateRoom(view.code)!;
    expect(room.opts.custom?.creator).toBe(alice);
    expect(room.world.cfg.width).toBe(CUSTOM_MAP_WIDTH.S);
    expect(room.world.cfg.powerUps).toBe(false);
    expect(room.opts.maxPlayers).toBe(6);
    expect(room.info().custom).toMatchObject({ mapSize: 'S', bots: 4, difficulty: 'hard' });
    // its bots are its own: an admin bot change leaves them alone
    room.tick(33);
    expect(room.bots?.bots.size).toBe(4);
    rooms.applyBotSettings();
    room.tick(33);
    expect(room.bots?.bots.size).toBe(4);
    // not listed publicly (invite only)
    expect(rooms.list().some((r) => r.code === view.code)).toBe(false);
    // duplicate payment
    const dup = await fail(svc.create(alice, { config: cfgOf(), txHash: h }));
    expect(dup.code).toBe('payment_used');
  });

  it('refuses a missing, underpaid or foreign payment, and a bad config, without opening a room', async () => {
    const { svc, rooms, reader } = setup();
    const alice = testSigner().address;
    const bob = testSigner().address;
    expect((await fail(svc.create(alice, { config: cfgOf() }))).code).toBe('payment_required');
    expect((await fail(svc.create(alice, { config: cfgOf(), txHash: reader.pay(2, alice, { value: PRICE / 2n }) }))).code).toBe('payment_low');
    expect((await fail(svc.create(alice, { config: cfgOf(), txHash: reader.pay(3, bob) }))).code).toBe('payment_invalid');
    expect((await fail(svc.create(alice, { config: cfgOf(), txHash: hash(99) }))).code).toBe('payment_pending');
    const bad = await fail(svc.create(alice, { config: cfgOf({ bots: 13 }), txHash: reader.pay(4, alice) }));
    expect(bad).toMatchObject({ code: 'bad_request', field: 'bots' });
    expect(svc.live).toBe(0);
    expect(rooms.customRooms()).toHaveLength(0);
    // a refused hash was never marked used: it still works once valid
    expect((await svc.create(alice, { config: cfgOf(), txHash: hash(4) })).paidWith).toBe('paid');
  });

  it('the network being busy keeps the payment safe and unused', async () => {
    const { svc, reader } = setup();
    const alice = testSigner().address;
    const h = reader.pay(1, alice);
    reader.busy = true;
    expect((await fail(svc.create(alice, { config: cfgOf(), txHash: h }))).code).toBe('chain_busy');
    reader.busy = false;
    expect((await svc.create(alice, { config: cfgOf(), txHash: h })).txHash).toBe(h);
  });

  it('caps: a global cap of live rooms and a per-wallet cap, with a friendly message', async () => {
    const { svc, reader } = setup();
    svc.updateSettings({ maxLive: 3, maxPerWallet: 2 });
    const [a, b, c] = [testSigner().address, testSigner().address, testSigner().address];
    await svc.create(a, { config: cfgOf(), txHash: reader.pay(1, a) });
    await svc.create(a, { config: cfgOf(), txHash: reader.pay(2, a) });
    const wl = await fail(svc.create(a, { config: cfgOf(), txHash: reader.pay(3, a) }));
    expect(wl.code).toBe('wallet_limit');
    await svc.create(b, { config: cfgOf(), txHash: reader.pay(4, b) });
    const busy = await fail(svc.create(c, { config: cfgOf(), txHash: reader.pay(5, c) }));
    expect(busy).toMatchObject({ code: 'slots_busy', status: 503 });
    expect(busy.message).toMatch(/All room slots are busy/);
    // checked before the payment is read: nothing was spent on the RPC
    expect((await svc.quote(c)).live).toBe(3);
  });

  it('slots that fill up while a payment is checked: the payment is kept unused for a retry', async () => {
    const { svc, reader } = setup();
    svc.updateSettings({ maxLive: 1 });
    const [a, b] = [testSigner().address, testSigner().address];
    const ha = reader.pay(1, a);
    const hb = reader.pay(2, b);
    // both pass the first cap check; a's create finishes first
    const pa = svc.create(a, { config: cfgOf(), txHash: ha });
    const pb = svc.create(b, { config: cfgOf(), txHash: hb });
    await pa;
    const err = await fail(pb);
    expect(err).toMatchObject({ code: 'slots_busy', paid: true });
    svc.close(svc.mine(a)[0].code, { wallet: a, admin: false });
    expect((await svc.create(b, { config: cfgOf(), txHash: hb })).txHash).toBe(hb);
  });

  it('holder perks: a discount, or one free room a day', async () => {
    const { svc, reader, clock } = setup({ holder: true });
    const a = testSigner().address;
    let q = await svc.quote(a);
    expect(q).toMatchObject({ holder: true, holderPerk: 'discount', holderDiscountPct: 50, youPayWei: (PRICE / 2n).toString(), treasury: TREASURY });
    // half the price is enough for a holder
    expect((await svc.create(a, { config: cfgOf(), txHash: reader.pay(1, a, { value: PRICE / 2n }) })).paidWith).toBe('paid');

    svc.updateSettings({ holderPerk: 'free_daily', maxPerWallet: 5 });
    q = await svc.quote(a);
    expect(q).toMatchObject({ freeAvailable: true, youPayWei: '0' });
    expect((await svc.create(a, { config: cfgOf() })).paidWith).toBe('free');
    // the free room of the day is used: the next one is paid in full
    q = await svc.quote(a);
    expect(q).toMatchObject({ freeAvailable: false, youPayWei: PRICE.toString() });
    expect((await fail(svc.create(a, { config: cfgOf() }))).code).toBe('payment_required');
    clock.t += 24 * 3600_000;
    expect((await svc.create(a, { config: cfgOf() })).paidWith).toBe('free');
  });

  it('closed creation, no treasury, guests and admin settings validation', async () => {
    const { svc } = setup();
    const a = testSigner().address;
    expect(await svc.quote(null)).toMatchObject({ holder: false, mine: 0, enabled: true });
    svc.updateSettings({ enabled: false });
    expect((await fail(svc.create(a, { config: cfgOf() }))).code).toBe('rooms_closed');
    expect(() => svc.updateSettings({ priceHype: 'free' })).toThrow(CustomRoomFail);
    expect(() => svc.updateSettings({ treasury: 'nope' })).toThrow(/treasury/);
    expect(() => svc.updateSettings({ maxLive: 1000 })).toThrow(/maxLive/);
    expect(() => svc.updateSettings({ surprise: 1 })).toThrow(/unknown field/);
    const s = svc.updateSettings({ enabled: true, priceHype: '0.1', treasury: TREASURY.replace('0x1', '0x2'), holderPerk: 'none' });
    expect(s).toMatchObject({ priceHype: '0.1', holderPerk: 'none' });
    expect(svc.treasury()).toBe('0x2111111111111111111111111111111111111111');
    svc.updateSettings({ treasury: null });
    expect(svc.treasury()).toBe(TREASURY);
  });
});

describe('custom rooms: lifecycle', () => {
  it('expires at its end time: players and spectators hear room_closed, a late joiner too', async () => {
    const { svc, rooms, reader, clock } = setup();
    const a = testSigner().address;
    const view = await svc.create(a, { config: cfgOf({ durationMin: 15, bots: 0 }), txHash: reader.pay(1, a) });
    const room = rooms.privateRoom(view.code)!;
    const player = fakeConn(null, '10.0.0.1');
    const watcher = fakeConn(null, '10.0.0.2');
    room.join(player, { name: 'Guest', skin: 1, flags: 0 });
    room.spectate(watcher);
    clock.t = view.endsAt - 30_000;
    svc.sweep(clock.t);
    // the "1 minute left" line
    expect(player.msgs.some((m) => m.t === 'chat' && m.system && /1 minute left/.test(m.text))).toBe(true);
    expect(rooms.privateRoom(view.code)).toBe(room);
    clock.t = view.endsAt;
    svc.sweep(clock.t);
    expect(rooms.privateRoom(view.code)).toBeNull();
    expect(svc.get(view.code)).toBeNull();
    for (const c of [player, watcher]) {
      const last = c.msgs.at(-1) as Extract<ServerMessage, { t: 'error' }>;
      expect(last).toMatchObject({ t: 'error', code: 'room_closed' });
      expect(c.room).toBeNull();
      expect(c.player).toBeNull();
    }
    expect(rooms.customClosedLately(view.code)).toBe(true);
    // the code is not handed out again while remembered
    for (let i = 0; i < 200; i++) expect(rooms.newPrivateCode()).not.toBe(view.code);
  });

  it('the creator (or an admin) closes early; nobody else can', async () => {
    const { svc, rooms, reader } = setup();
    const [a, b] = [testSigner().address, testSigner().address];
    const v1 = await svc.create(a, { config: cfgOf(), txHash: reader.pay(1, a) });
    expect(() => svc.close(v1.code, { wallet: b, admin: false })).toThrow(/Only the room creator/);
    svc.close(v1.code, { wallet: a.toLowerCase(), admin: false });
    expect(rooms.privateRoom(v1.code)).toBeNull();
    const v2 = await svc.create(a, { config: cfgOf(), txHash: reader.pay(2, a) });
    svc.close(v2.code, { wallet: b, admin: true });
    expect(svc.live).toBe(0);
    expect(() => svc.close(v2.code, { wallet: a, admin: false })).toThrow(/No open room/);
  });

  it('keeps its own leaderboard (best games) and stays off the global one', async () => {
    const { svc, rooms, reader } = setup();
    const a = testSigner().address;
    const view = await svc.create(a, { config: cfgOf({ bots: 0 }), txHash: reader.pay(1, a) });
    const room = rooms.privateRoom(view.code)!;
    const submitted: unknown[] = [];
    (room as unknown as { deps: { leaderboards: { submit: (e: unknown) => void } } }).deps.leaderboards.submit = (e) => submitted.push(e);
    const c = fakeConn(null);
    const p = room.join(c, { name: 'Bubbles', skin: 2, flags: 0 });
    p.stats.maxMass = 420;
    room.leave(c, 'left');
    expect(svc.get(view.code)!.best[0]).toMatchObject({ name: 'Bubbles', score: 420 });
    expect(submitted).toHaveLength(0);
  });

  it('survives a restart for its remaining time; an expired one is dropped; used payments stay used', async () => {
    const clock = { t: 1_800_000_000_000 };
    const first = setup({ clock });
    const a = testSigner().address;
    const h = first.reader.pay(1, a);
    const keep = await first.svc.create(a, { config: cfgOf({ durationMin: 60, name: 'Long one', mapSize: 'L' }), txHash: h });
    const gone = await first.svc.create(a, { config: cfgOf({ durationMin: 15 }), txHash: first.reader.pay(2, a) });
    first.svc.onGame(first.rooms.privateRoom(keep.code)!, { name: 'Pip', score: 300, kills: 1 });
    first.svc.flush();
    expect(existsSync(join(first.dir!, 'site', 'custom-rooms.json'))).toBe(true);
    first.rooms.shutdown();

    // the server was down for 20 minutes
    clock.t += 20 * 60_000;
    const second = setup({ clock, dir: first.dir, reader: first.reader });
    expect(second.svc.restore()).toBe(1);
    const back = second.rooms.privateRoom(keep.code)!;
    expect(back.opts.custom?.endsAt).toBe(keep.endsAt);
    expect(back.world.cfg.width).toBe(CUSTOM_MAP_WIDTH.L);
    expect(back.opts.name).toBe('Long one');
    expect(second.svc.get(keep.code)!.best[0]).toMatchObject({ name: 'Pip' });
    expect(second.rooms.privateRoom(gone.code)).toBeNull();
    expect((await fail(second.svc.create(a, { config: cfgOf(), txHash: h }))).code).toBe('payment_used');
    const stored = JSON.parse(readFileSync(join(first.dir!, 'site', 'custom-rooms.json'), 'utf8'));
    expect(stored.rooms.map((r: { code: string }) => r.code)).toEqual([keep.code]);
  });

  it('worlds scale with the map size and food choice', () => {
    const s = customWorld(cfgOf({ mapSize: 'S' }));
    const l = customWorld(cfgOf({ mapSize: 'L' }));
    const lHigh = customWorld(cfgOf({ mapSize: 'L', food: 'high' }));
    expect(s.width).toBeLessThan(l.width);
    expect(s.foodTarget).toBeLessThan(l.foodTarget);
    expect(lHigh.foodTarget).toBeGreaterThan(l.foodTarget);
    expect(customWorld(cfgOf({ powerUps: false })).maxPowerUps).toBe(0);
  });
});

describe('custom rooms over HTTP and WebSocket', () => {
  let app: App | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function boot(reader: PaymentReader, admin: string) {
    const dir = mkdtempSync(join(tmpdir(), 'elymum-custom-http-'));
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, BOT_TARGET: '0', BOT_MIN: '0', BOT_MAX: '0', ADMIN_WALLETS: admin, TRUST_PROXY: '0', GAME_ACCESS: 'public' } as NodeJS.ProcessEnv);
    app = await createApp(cfg, {
      chain: new ArenaChain([arena(1, 1000)]),
      log: () => {},
      persist: true,
      paymentReader: reader,
      siteLimits: { writeIp: new Limiter(10_000, 60_000), writeWallet: new Limiter(10_000, 60_000), login: new Limiter(10_000, 60_000) },
      apiLimiter: new Limiter(10_000, 60_000),
    });
    const port = await app.listen();
    const call = async (method: string, path: string, opts: { wallet?: string; body?: unknown } = {}) => {
      const headers: Record<string, string> = {};
      if (opts.wallet) headers.Authorization = `Bearer ${app!.auth.issueToken(opts.wallet)}`;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    return { port, call, dir };
  }

  it('guests cannot create; a wallet pays and gets an invite; anyone joins with the code; admin lists and closes', async () => {
    const admin = testSigner().address;
    const clock = { t: Date.now() };
    const reader = new FakeTransfers(clock);
    const { port, call } = await boot(
      {
        transfer: async (h, e) => {
          const t = await reader.transfer(h);
          return t ? { ...t, to: e.to } : null;
        },
      },
      admin,
    );
    const alice = testSigner().address;
    expect((await call('GET', '/api/rooms/custom/quote')).body).toMatchObject({ enabled: true, priceWei: PRICE.toString(), treasury: admin, chainId: 31337 });
    expect((await call('POST', '/api/rooms/custom', { body: { config: cfgOf() } })).status).toBe(401);
    const unpaid = await call('POST', '/api/rooms/custom', { wallet: alice, body: { config: cfgOf() } });
    expect(unpaid).toMatchObject({ status: 402, body: { error: 'payment_required' } });
    const made = await call('POST', '/api/rooms/custom', { wallet: alice, body: { config: cfgOf({ bots: 2 }), txHash: reader.pay(1, alice) } });
    expect(made.status).toBe(201);
    const code: string = made.body.room.code;
    expect(made.body.invite).toMatch(new RegExp(`/play\\?room=${code}$`));
    expect((await call('GET', `/api/rooms/custom/${code}`)).body.room).toMatchObject({ code, name: 'Friday Pond' });
    expect((await call('GET', `/api/rooms/custom/${code.toLowerCase()}`)).status).toBe(200);
    expect((await call('GET', '/api/rooms/custom/mine', { wallet: alice })).body.rooms).toHaveLength(1);
    expect((await call('GET', '/api/rooms/custom/ZZZZZ')).status).toBe(404);

    // a guest joins by code over the socket
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs: ServerMessage[] = [];
    ws.on('message', (d, bin) => {
      if (!bin) msgs.push(JSON.parse(String(d)));
    });
    await new Promise<void>((r) => ws.once('open', () => r()));
    const waitFor = async (pred: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const m = msgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('message never came');
    };
    ws.send(JSON.stringify({ t: 'hello', v: 7 }));
    await waitFor((m) => m.t === 'welcome');
    ws.send(JSON.stringify({ t: 'join', room: `private:${code}`, name: 'Guest', skin: 1 }));
    const joined = (await waitFor((m) => m.t === 'joined')) as Extract<ServerMessage, { t: 'joined' }>;
    expect(joined.room.custom).toMatchObject({ creator: alice, bots: 2 });
    expect(joined.room.code).toBe(code);

    // admin view and close
    const bob = testSigner().address;
    expect((await call('GET', '/api/admin/custom-rooms', { wallet: bob })).status).toBe(403);
    const list = await call('GET', '/api/admin/custom-rooms', { wallet: admin });
    expect(list.body.rooms.map((r: { code: string }) => r.code)).toEqual([code]);
    expect(list.body.settings).toMatchObject({ priceHype: '0.05', maxLive: 6, maxPerWallet: 2 });
    expect((await call('PUT', '/api/admin/custom-rooms', { wallet: admin, body: { maxLive: 0 } })).body.settings.maxLive).toBe(0);
    expect((await call('DELETE', `/api/rooms/custom/${code}`, { wallet: bob })).status).toBe(403);
    expect((await call('DELETE', `/api/admin/custom-rooms/${code}`, { wallet: admin })).body.rooms).toEqual([]);
    await waitFor((m) => m.t === 'error' && m.code === 'room_closed');
    msgs.length = 0;
    ws.send(JSON.stringify({ t: 'join', room: `private:${code}`, name: 'Guest', skin: 1 }));
    expect(await waitFor((m) => m.t === 'error')).toMatchObject({ code: 'room_closed' });
    const busy = await call('POST', '/api/rooms/custom', { wallet: alice, body: { config: cfgOf(), txHash: reader.pay(2, alice) } });
    expect(busy).toMatchObject({ status: 503, body: { error: 'slots_busy' } });
    ws.close();
  });
});
